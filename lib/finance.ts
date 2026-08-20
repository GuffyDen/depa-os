import type { AuthUser } from "./auth";
import { confirmAttachmentUpload, FileError } from "./files";
import { first, query, transaction } from "./postgres";
import { categoryRequiresReceipt, financeCategoryLabel } from "./finance-categories";
import { INCOME_PURPOSES, parseAmountKopecks, projectLedgerTotals, transferPreview, validateAllocations, validateExpense, type ExpenseKind, type FinanceOperationType } from "./finance-rules";

const FINANCE_ACCESS = "FINANCE_ACCESS";

type CashboxRow = {
  id: string;
  owner_user_id: string | null;
  owner_employee_id: string | null;
  owner_name: string | null;
  name: string;
  status: "ACTIVE" | "INACTIVE";
  balance_kopecks: string | number;
  created_at: string | number;
  deactivated_at: string | number | null;
};

type TransactionRow = {
  id: string;
  type: FinanceOperationType;
  expense_type: ExpenseKind | null;
  amount_kopecks: string | number;
  transaction_date: string | number;
  cashbox_id: string;
  cashbox_name: string;
  destination_cashbox_id: string | null;
  destination_cashbox_name: string | null;
  original_transaction_id: string | null;
  project_id: string | null;
  project_name: string | null;
  client_id: string | null;
  category: string;
  source: string | null;
  purpose: string | null;
  title: string;
  comment: string | null;
  show_to_client: string | number;
  author_user_id: string;
  author_name: string;
  created_at: string | number;
  attachment_count: string | number;
  attachment_id: string | null;
  allocations_json: unknown;
};

type ProjectEconomicsRow = {
  project_id: string;
  income_kopecks: string | number;
  expense_kopecks: string | number;
  refund_kopecks: string | number;
  materials_income_kopecks: string | number;
  materials_expense_kopecks: string | number;
  works_income_kopecks: string | number;
  works_expense_kopecks: string | number;
  additional_works_income_kopecks: string | number;
  other_income_kopecks: string | number;
};

type ReconciliationRow = { id: string; name: string; stored_balance_kopecks: string | number; calculated_balance_kopecks: string | number };

export class FinanceError extends Error {
  constructor(message: string, public status = 400, public details?: Record<string, unknown>) { super(message); }
}

function nowSeconds() { return Math.floor(Date.now() / 1000); }
function number(value: string | number | null | undefined) { return Number(value ?? 0); }
function cleanText(value: unknown, max = 500) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function parseAllocationsJson(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = item as { id?: unknown; projectId?: unknown; projectName?: unknown; amountKopecks?: unknown; purpose?: unknown };
    return { id: String(row.id ?? ""), projectId: String(row.projectId ?? ""), projectName: String(row.projectName ?? ""), amountKopecks: number(row.amountKopecks as string | number), purpose: String(row.purpose ?? "MATERIALS") };
  });
}

function personalCashboxName(user: Pick<AuthUser, "id" | "name">) {
  if (user.id === "user_owner_denis") return "Касса Дениса";
  if (user.id === "user_owner_pavel") return "Касса Паши";
  const firstName = user.name.trim().split(/\s+/)[0] || "сотрудника";
  if (firstName.endsWith("й")) return `Касса ${firstName.slice(0, -1)}я`;
  if (firstName.endsWith("а")) return `Касса ${firstName.slice(0, -1)}ы`;
  if (firstName.endsWith("я")) return `Касса ${firstName.slice(0, -1)}и`;
  return `Касса ${firstName}а`;
}

export async function ensurePersonalCashboxes() {
  const timestamp = nowSeconds();
  await transaction([
    {
      text: `INSERT INTO cashboxes (id, owner_user_id, name, type, owner_employee_id, currency, status, balance_kopecks, is_active, created_at, updated_at)
        SELECT 'cashbox_' || id, id,
          CASE id WHEN 'user_owner_denis' THEN 'Касса Дениса' WHEN 'user_owner_pavel' THEN 'Касса Паши' ELSE 'Касса ' || split_part(display_name, ' ', 1) END,
          'PERSONAL', employee_id, 'RUB', 'ACTIVE', 0, 1, $1, $2
        FROM users WHERE role = 'OWNER' AND status = 'ACTIVE'
        ON CONFLICT (owner_user_id) DO UPDATE SET name = EXCLUDED.name, owner_employee_id = EXCLUDED.owner_employee_id, type = 'PERSONAL', status = 'ACTIVE', is_active = 1, updated_at = EXCLUDED.updated_at
        WHERE cashboxes.name IS DISTINCT FROM EXCLUDED.name OR cashboxes.owner_employee_id IS DISTINCT FROM EXCLUDED.owner_employee_id OR cashboxes.type <> 'PERSONAL' OR cashboxes.status <> 'ACTIVE' OR cashboxes.is_active <> 1`,
      params: [timestamp, timestamp],
    },
    { text: "UPDATE cashboxes SET status = 'INACTIVE', is_active = 0, updated_at = $1 WHERE (owner_user_id IS NULL OR lower(name) LIKE '%общ%') AND (status <> 'INACTIVE' OR is_active <> 0)", params: [timestamp] },
  ]);
}

async function permissionAllowed(userId: string, permission: string) {
  const row = await first<{ allowed: string | number }>("SELECT allowed FROM user_permissions WHERE user_id = $1 AND permission = $2 AND scope = 'COMPANY' LIMIT 1", [userId, permission]);
  return Boolean(number(row?.allowed));
}

async function assertFinanceAccess(actor: AuthUser) {
  if (actor.role === "OWNER") return;
  if (!(await permissionAllowed(actor.id, FINANCE_ACCESS))) throw new FinanceError("Нет доступа к финансовым операциям.", 403);
}

async function cashboxForActor(actor: AuthUser, id: string, requireActive = true) {
  const row = await first<CashboxRow>("SELECT c.*, u.display_name AS owner_name FROM cashboxes c LEFT JOIN users u ON u.id = c.owner_user_id WHERE c.id = $1 LIMIT 1", [id]);
  if (!row || (requireActive && row.status !== "ACTIVE")) throw new FinanceError("Касса не найдена или неактивна.", 404);
  if (actor.role !== "OWNER" && row.owner_user_id !== actor.id) throw new FinanceError("Можно работать только со своей кассой.", 403);
  return row;
}

async function projectForActor(actor: AuthUser, id: string) {
  const row = actor.role === "OWNER"
    ? await first<{ id: string; client_id: string }>("SELECT id, client_id FROM projects WHERE id = $1 AND status <> 'ARCHIVED' LIMIT 1", [id])
    : await first<{ id: string; client_id: string }>("SELECT p.id, p.client_id FROM projects p JOIN user_project_access a ON a.project_id = p.id WHERE p.id = $1 AND a.user_id = $2 AND p.status <> 'ARCHIVED' LIMIT 1", [id, actor.id]);
  if (!row) throw new FinanceError("Объект не найден или недоступен.", 403);
  return row;
}

function serializeCashbox(row: CashboxRow, transactions: TransactionRow[]) {
  const todayStart = Math.floor((Date.now() + 10 * 3600_000) / 86_400_000) * 86_400 - 10 * 3600;
  const today = transactions.filter((item) => number(item.transaction_date) >= todayStart);
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    ownerName: row.owner_name,
    name: row.name,
    status: row.status,
    balanceKopecks: number(row.balance_kopecks),
    createdAt: number(row.created_at),
    deactivatedAt: row.deactivated_at ? number(row.deactivated_at) : null,
    todayIncomeKopecks: today.filter((item) => item.cashbox_id === row.id && item.type === "INCOME").reduce((sum, item) => sum + number(item.amount_kopecks), 0),
    todayExpenseKopecks: today.filter((item) => item.cashbox_id === row.id && item.type === "EXPENSE").reduce((sum, item) => sum + number(item.amount_kopecks), 0),
    transferredOutKopecks: today.filter((item) => item.cashbox_id === row.id && item.type === "TRANSFER").reduce((sum, item) => sum + number(item.amount_kopecks), 0),
    transferredInKopecks: today.filter((item) => item.destination_cashbox_id === row.id && item.type === "TRANSFER").reduce((sum, item) => sum + number(item.amount_kopecks), 0),
  };
}

function serializeTransaction(row: TransactionRow) {
  return {
    id: row.id, type: row.type, expenseType: row.expense_type, amountKopecks: number(row.amount_kopecks), transactionDate: number(row.transaction_date),
    cashboxId: row.cashbox_id, cashboxName: row.cashbox_name, destinationCashboxId: row.destination_cashbox_id, destinationCashboxName: row.destination_cashbox_name,
    originalTransactionId: row.original_transaction_id, projectId: row.project_id, projectName: row.project_name, clientId: row.client_id,
    category: row.category, source: row.source, purpose: row.purpose, title: row.title, comment: row.comment, showToClient: Boolean(number(row.show_to_client)),
    authorUserId: row.author_user_id, authorName: row.author_name, createdAt: number(row.created_at), attachmentCount: number(row.attachment_count), attachmentId: row.attachment_id,
    allocations: parseAllocationsJson(row.allocations_json),
  };
}

async function reconciliationRows() {
  return query<ReconciliationRow>(`SELECT c.id,c.name,c.balance_kopecks AS stored_balance_kopecks,
    COALESCE((to_jsonb(c)->>'opening_balance_kopecks')::integer,0) + COALESCE(SUM(CASE
      WHEN ft.type IN ('INCOME','REFUND') AND ft.cashbox_id=c.id THEN ft.amount_kopecks
      WHEN ft.type='EXPENSE' AND ft.cashbox_id=c.id THEN -ft.amount_kopecks
      WHEN ft.type='TRANSFER' AND ft.cashbox_id=c.id THEN -ft.amount_kopecks
      WHEN ft.type='TRANSFER' AND ft.destination_cashbox_id=c.id THEN ft.amount_kopecks
      ELSE 0 END),0) AS calculated_balance_kopecks
    FROM cashboxes c LEFT JOIN financial_transactions ft ON ft.cashbox_id=c.id OR ft.destination_cashbox_id=c.id
    GROUP BY c.id,c.name,c.balance_kopecks,to_jsonb(c) ORDER BY c.name`);
}

export async function reconcileCashboxes(actor: AuthUser, recalculate = false) {
  if (actor.role !== "OWNER") throw new FinanceError("Только Owner может проверять целостность касс.", 403);
  const rows = await reconciliationRows();
  const mismatches = rows.filter((row) => number(row.stored_balance_kopecks) !== number(row.calculated_balance_kopecks));
  if (mismatches.length) console.error("FINANCE_RECONCILIATION_MISMATCH", mismatches);
  if (recalculate && mismatches.length) {
    const timestamp = nowSeconds();
    await transaction(mismatches.flatMap((row) => [
      { text: "UPDATE cashboxes SET balance_kopecks=$1,updated_at=$2 WHERE id=$3", params: [number(row.calculated_balance_kopecks), timestamp, row.id] },
      { text: "INSERT INTO audit_logs (id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES ($1,$2,'CASHBOX_BALANCE_RECALCULATED','Cashbox',$3,$4,$5)", params: [crypto.randomUUID(), actor.id, row.id, timestamp, JSON.stringify({ beforeKopecks: number(row.stored_balance_kopecks), afterKopecks: number(row.calculated_balance_kopecks) })] },
    ]));
  }
  return { ok: mismatches.length === 0, cashboxes: rows.map((row) => ({ id: row.id, name: row.name, storedBalanceKopecks: number(row.stored_balance_kopecks), calculatedBalanceKopecks: number(row.calculated_balance_kopecks), matches: number(row.stored_balance_kopecks) === number(row.calculated_balance_kopecks) })) };
}

export async function getFinanceOverview(actor: AuthUser) {
  await ensurePersonalCashboxes();
  await assertFinanceAccess(actor);
  const boxCondition = actor.role === "OWNER" ? "" : "WHERE c.owner_user_id = $1";
  const params = actor.role === "OWNER" ? [] : [actor.id];
  const transactionCondition = actor.role === "OWNER" ? "" : "WHERE source_box.owner_user_id = $1 OR destination_box.owner_user_id = $1";
  const summaryCondition = actor.role === "OWNER" ? "" : "WHERE EXISTS (SELECT 1 FROM cashboxes sc WHERE sc.id=ft.cashbox_id AND sc.owner_user_id=$1) OR EXISTS (SELECT 1 FROM cashboxes dc WHERE dc.id=ft.destination_cashbox_id AND dc.owner_user_id=$1)";
  const ledgerSql = `WITH ledger AS (
      SELECT ft.project_id,ft.type,ft.amount_kopecks,ft.category,ft.purpose
      FROM financial_transactions ft
      WHERE ft.project_id IS NOT NULL AND ft.type<>'EXPENSE'
      UNION ALL
      SELECT ft.project_id,ft.type,ft.amount_kopecks,ft.category,ft.purpose
      FROM financial_transactions ft
      WHERE ft.type='EXPENSE' AND ft.project_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM transaction_allocations ta WHERE ta.transaction_id=ft.id)
      UNION ALL
      SELECT ta.project_id,ft.type,ta.amount_kopecks,ft.category,ta.purpose
      FROM transaction_allocations ta JOIN financial_transactions ft ON ft.id=ta.transaction_id WHERE ft.type='EXPENSE'
    ) SELECT project_id,
      COALESCE(SUM(CASE WHEN type='INCOME' THEN amount_kopecks ELSE 0 END),0) AS income_kopecks,
      COALESCE(SUM(CASE WHEN type='EXPENSE' THEN amount_kopecks ELSE 0 END),0) AS expense_kopecks,
      COALESCE(SUM(CASE WHEN type='REFUND' THEN amount_kopecks ELSE 0 END),0) AS refund_kopecks,
      COALESCE(SUM(CASE WHEN type='INCOME' AND purpose='MATERIALS' THEN amount_kopecks ELSE 0 END),0) AS materials_income_kopecks,
      COALESCE(SUM(CASE WHEN type='EXPENSE' AND category='MATERIALS' THEN amount_kopecks ELSE 0 END),0) AS materials_expense_kopecks,
      COALESCE(SUM(CASE WHEN type='INCOME' AND purpose='WORKS' THEN amount_kopecks ELSE 0 END),0) AS works_income_kopecks,
      COALESCE(SUM(CASE WHEN type='EXPENSE' AND category='CONTRACTOR_WORK' THEN amount_kopecks ELSE 0 END),0) AS works_expense_kopecks,
      COALESCE(SUM(CASE WHEN type='INCOME' AND purpose='ADDITIONAL_WORKS' THEN amount_kopecks ELSE 0 END),0) AS additional_works_income_kopecks,
      COALESCE(SUM(CASE WHEN type='INCOME' AND purpose='OTHER' THEN amount_kopecks ELSE 0 END),0) AS other_income_kopecks
    FROM ledger`;
  const [boxes, transactions, projects, clients, projectEconomics, reconciliation, summaryRows] = await Promise.all([
    query<CashboxRow>(`SELECT c.*, u.display_name AS owner_name FROM cashboxes c LEFT JOIN users u ON u.id = c.owner_user_id ${boxCondition} ORDER BY c.status ASC, c.created_at ASC`, params),
    query<TransactionRow>(`SELECT ft.*, source_box.name AS cashbox_name, destination_box.name AS destination_cashbox_name, p.name AS project_name, u.display_name AS author_name,
      (SELECT COUNT(*) FROM attachments a WHERE a.transaction_id = ft.id AND a.upload_status='LINKED' AND a.deleted_at IS NULL) AS attachment_count,
      (SELECT a.id FROM attachments a WHERE a.transaction_id = ft.id AND a.upload_status='LINKED' AND a.deleted_at IS NULL ORDER BY a.created_at LIMIT 1) AS attachment_id,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',ta.id,'projectId',ta.project_id,'projectName',ap.name,'amountKopecks',ta.amount_kopecks,'purpose',ta.purpose) ORDER BY ap.name) FROM transaction_allocations ta JOIN projects ap ON ap.id=ta.project_id WHERE ta.transaction_id=ft.id),'[]'::jsonb) AS allocations_json
      FROM financial_transactions ft JOIN cashboxes source_box ON source_box.id = ft.cashbox_id LEFT JOIN cashboxes destination_box ON destination_box.id = ft.destination_cashbox_id LEFT JOIN projects p ON p.id = ft.project_id JOIN users u ON u.id = ft.author_user_id ${transactionCondition} ORDER BY ft.transaction_date DESC, ft.created_at DESC LIMIT 200`, params),
    actor.role === "OWNER"
      ? query<{ id: string; name: string; client_id: string }>("SELECT id, name, client_id FROM projects WHERE status <> 'ARCHIVED' ORDER BY name")
      : query<{ id: string; name: string; client_id: string }>("SELECT p.id, p.name, p.client_id FROM projects p JOIN user_project_access a ON a.project_id = p.id WHERE a.user_id = $1 AND p.status <> 'ARCHIVED' ORDER BY p.name", [actor.id]),
    actor.role === "OWNER"
      ? query<{ id: string; name: string }>("SELECT id, name FROM clients WHERE status = 'ACTIVE' ORDER BY name")
      : query<{ id: string; name: string }>("SELECT DISTINCT c.id, c.name FROM clients c JOIN projects p ON p.client_id = c.id JOIN user_project_access a ON a.project_id = p.id WHERE a.user_id = $1 AND c.status = 'ACTIVE' ORDER BY c.name", [actor.id]),
    actor.role === "OWNER"
      ? query<ProjectEconomicsRow>(`${ledgerSql} GROUP BY project_id`)
      : query<ProjectEconomicsRow>(`${ledgerSql} WHERE EXISTS (SELECT 1 FROM user_project_access a WHERE a.project_id=ledger.project_id AND a.user_id=$1) GROUP BY project_id`, [actor.id]),
    reconciliationRows(),
    query<{ today_income_kopecks: string | number; today_expense_kopecks: string | number; today_transfer_kopecks: string | number; month_project_expense_kopecks: string | number; month_admin_expense_kopecks: string | number }>(`SELECT
      COALESCE(SUM(CASE WHEN type='INCOME' AND transaction_date >= EXTRACT(EPOCH FROM date_trunc('day',now() AT TIME ZONE 'Asia/Vladivostok') AT TIME ZONE 'Asia/Vladivostok') THEN amount_kopecks ELSE 0 END),0) AS today_income_kopecks,
      COALESCE(SUM(CASE WHEN type='EXPENSE' AND transaction_date >= EXTRACT(EPOCH FROM date_trunc('day',now() AT TIME ZONE 'Asia/Vladivostok') AT TIME ZONE 'Asia/Vladivostok') THEN amount_kopecks ELSE 0 END),0) AS today_expense_kopecks,
      COALESCE(SUM(CASE WHEN type='TRANSFER' AND transaction_date >= EXTRACT(EPOCH FROM date_trunc('day',now() AT TIME ZONE 'Asia/Vladivostok') AT TIME ZONE 'Asia/Vladivostok') THEN amount_kopecks ELSE 0 END),0) AS today_transfer_kopecks,
      COALESCE(SUM(CASE WHEN type='EXPENSE' AND expense_type='PROJECT' AND transaction_date >= EXTRACT(EPOCH FROM date_trunc('month',now() AT TIME ZONE 'Asia/Vladivostok') AT TIME ZONE 'Asia/Vladivostok') THEN amount_kopecks ELSE 0 END),0) AS month_project_expense_kopecks,
      COALESCE(SUM(CASE WHEN type='EXPENSE' AND expense_type='ADMIN' AND transaction_date >= EXTRACT(EPOCH FROM date_trunc('month',now() AT TIME ZONE 'Asia/Vladivostok') AT TIME ZONE 'Asia/Vladivostok') THEN amount_kopecks ELSE 0 END),0) AS month_admin_expense_kopecks
      FROM financial_transactions ft ${summaryCondition}`, params),
  ]);
  const serializedTransactions = transactions.map(serializeTransaction);
  const economicsByProject = new Map(projectEconomics.map((item) => [item.project_id, item]));
  const serializedProjects = projects.map((project) => {
    const economics = economicsByProject.get(project.id);
    const incomeKopecks = number(economics?.income_kopecks);
    const expenseKopecks = number(economics?.expense_kopecks);
    const refundKopecks = number(economics?.refund_kopecks);
    const materialsIncomeKopecks = number(economics?.materials_income_kopecks);
    const materialsExpenseKopecks = number(economics?.materials_expense_kopecks);
    const worksIncomeKopecks = number(economics?.works_income_kopecks);
    const worksExpenseKopecks = number(economics?.works_expense_kopecks);
    return { id: project.id, name: project.name, clientId: project.client_id, incomeKopecks, expenseKopecks, refundKopecks, ...projectLedgerTotals(incomeKopecks, expenseKopecks, refundKopecks), materialsIncomeKopecks, materialsExpenseKopecks, materialsBalanceKopecks: materialsIncomeKopecks - materialsExpenseKopecks, worksIncomeKopecks, worksExpenseKopecks, worksBalanceKopecks: worksIncomeKopecks - worksExpenseKopecks, additionalWorksIncomeKopecks: number(economics?.additional_works_income_kopecks), otherIncomeKopecks: number(economics?.other_income_kopecks) };
  });
  const attentionItems = [
    ...boxes.filter((box) => box.status === "ACTIVE" && number(box.balance_kopecks) < 0).map((box) => ({ type: "NEGATIVE_CASHBOX", severity: "WARNING", title: "Отрицательная касса", detail: `${box.name}: ${number(box.balance_kopecks)} коп.`, cashboxId: box.id })),
    ...serializedProjects.filter((project) => project.materialsBalanceKopecks < 0).map((project) => ({ type: "NEGATIVE_MATERIALS_BALANCE", severity: "WARNING", title: "Баланс материалов ниже нуля", detail: `${project.name}: долг клиента ${Math.abs(project.materialsBalanceKopecks)} коп.`, projectId: project.id })),
    ...serializedTransactions.filter((item) => item.type === "EXPENSE" && categoryRequiresReceipt(item.category) && item.attachmentCount === 0).map((item) => ({ type: "MISSING_RECEIPT", severity: "WARNING", title: "Расход без чека", detail: `${item.title}: ${item.amountKopecks} коп.`, transactionId: item.id })),
    ...serializedTransactions.filter((item) => item.type === "EXPENSE" && item.expenseType === "PROJECT" && !item.projectId && item.allocations.length === 0).map((item) => ({ type: "UNALLOCATED_EXPENSE", severity: "ERROR", title: "Нераспределённый объектный расход", detail: `${item.title}: ${item.amountKopecks} коп.`, transactionId: item.id })),
    ...boxes.filter((box) => box.status === "INACTIVE" && number(box.balance_kopecks) !== 0).map((box) => ({ type: "INACTIVE_CASHBOX_BALANCE", severity: "WARNING", title: "Неактивная касса с остатком", detail: `${box.name}: ${number(box.balance_kopecks)} коп.`, cashboxId: box.id })),
  ];
  const reconciliationMismatches = reconciliation.filter((row) => number(row.stored_balance_kopecks) !== number(row.calculated_balance_kopecks));
  if (reconciliationMismatches.length) console.error("FINANCE_RECONCILIATION_MISMATCH", reconciliationMismatches);
  const summary = summaryRows[0];
  return {
    isOwner: actor.role === "OWNER",
    cashboxes: boxes.map((box) => serializeCashbox(box, transactions)),
    transactions: serializedTransactions,
    projects: serializedProjects,
    clients,
    physicalTotalKopecks: boxes.filter((box) => box.status === "ACTIVE").reduce((sum, box) => sum + number(box.balance_kopecks), 0),
    clientFundsKopecks: serializedProjects.reduce((sum, project) => sum + Math.max(0, project.materialsBalanceKopecks) + Math.max(0, project.worksBalanceKopecks) + Math.max(0, project.additionalWorksIncomeKopecks) + Math.max(0, project.otherIncomeKopecks), 0),
    summary: { todayIncomeKopecks: number(summary?.today_income_kopecks), todayExpenseKopecks: number(summary?.today_expense_kopecks), todayTransferKopecks: number(summary?.today_transfer_kopecks), monthProjectExpenseKopecks: number(summary?.month_project_expense_kopecks), monthAdminExpenseKopecks: number(summary?.month_admin_expense_kopecks) },
    attentionItems,
    reconciliation: { ok: reconciliationMismatches.length === 0, mismatchCount: reconciliationMismatches.length },
  };
}

export type CreateFinanceOperationInput = {
  type?: unknown; amount?: unknown; date?: unknown; cashboxId?: unknown; destinationCashboxId?: unknown; expenseType?: unknown;
  category?: unknown; projectId?: unknown; clientId?: unknown; purpose?: unknown; source?: unknown; title?: unknown; comment?: unknown;
  showToClient?: unknown; originalTransactionId?: unknown; attachmentId?: unknown;
  allocations?: unknown;
};

export async function createFinanceOperation(actor: AuthUser, input: CreateFinanceOperationInput) {
  await ensurePersonalCashboxes();
  await assertFinanceAccess(actor);
  const type = cleanText(input.type, 20) as FinanceOperationType;
  if (!["INCOME", "EXPENSE", "TRANSFER", "REFUND"].includes(type)) throw new FinanceError("Выберите тип финансовой операции.");
  if (actor.role !== "OWNER" && type !== "EXPENSE") throw new FinanceError("Сотрудник может создавать только разрешённые расходы из своей кассы.", 403);
  const amountKopecks = parseAmountKopecks(input.amount);
  if (!amountKopecks) throw new FinanceError("Сумма должна быть больше нуля.");
  const cashboxId = cleanText(input.cashboxId, 100);
  if (!cashboxId) throw new FinanceError("Выберите кассу.");
  let sourceCashbox = await cashboxForActor(actor, cashboxId);
  let destinationCashbox: CashboxRow | null = null;
  const timestamp = nowSeconds();
  const dateValue = cleanText(input.date, 30);
  const transactionDate = dateValue ? Math.floor(new Date(`${dateValue}T12:00:00+10:00`).getTime() / 1000) : timestamp;
  if (!Number.isFinite(transactionDate)) throw new FinanceError("Укажите корректную дату.");

  let expenseType = cleanText(input.expenseType, 20) as ExpenseKind;
  let category = cleanText(input.category, 100);
  let projectId = cleanText(input.projectId, 100) || null;
  let clientId = cleanText(input.clientId, 100) || null;
  let purpose = cleanText(input.purpose, 40) || null;
  let showToClient = input.showToClient === true;
  let originalTransactionId = cleanText(input.originalTransactionId, 100) || null;
  const rawAllocations = Array.isArray(input.allocations) ? input.allocations : [];
  const allocations = rawAllocations.map((value) => {
    const row = value && typeof value === "object" ? value as { projectId?: unknown; amount?: unknown } : {};
    return { projectId: cleanText(row.projectId, 100), amountKopecks: parseAmountKopecks(row.amount) ?? 0 };
  }).filter((item) => item.projectId || item.amountKopecks);
  const suppliedTitle = cleanText(input.title, 180);
  const comment = cleanText(input.comment, 1000) || null;
  const source = cleanText(input.source, 180) || null;

  if (type === "TRANSFER") {
    if (actor.role !== "OWNER") throw new FinanceError("Перемещения между кассами проводит Owner.", 403);
    const destinationId = cleanText(input.destinationCashboxId, 100);
    if (!destinationId) throw new FinanceError("Выберите кассу-получатель.");
    if (destinationId === cashboxId) throw new FinanceError("Кассы отправителя и получателя должны отличаться.");
    destinationCashbox = await cashboxForActor(actor, destinationId);
    expenseType = "" as ExpenseKind; category = "Перемещение"; projectId = null; clientId = null; purpose = null; showToClient = false; originalTransactionId = null;
  } else if (type === "EXPENSE") {
    if (expenseType !== "PROJECT" && expenseType !== "ADMIN") throw new FinanceError("Выберите тип расхода.");
    if (actor.role !== "OWNER" && expenseType === "ADMIN") throw new FinanceError("Административные расходы проводит Owner.", 403);
    const expenseError = validateExpense(expenseType, category, projectId || allocations[0]?.projectId);
    if (expenseError) throw new FinanceError(expenseError);
    if (expenseType === "ADMIN") { projectId = null; clientId = null; showToClient = false; allocations.length = 0; }
    if (expenseType === "PROJECT" && allocations.length) {
      const allocationError = validateAllocations(amountKopecks, allocations);
      if (allocationError) throw new FinanceError(allocationError);
      for (const allocation of allocations) await projectForActor(actor, allocation.projectId);
      projectId = null;
      clientId = null;
    }
  } else if (type === "INCOME") {
    category = category || "Поступление"; expenseType = "" as ExpenseKind;
    if ((projectId || clientId) && !(INCOME_PURPOSES as readonly string[]).includes(purpose ?? "")) throw new FinanceError("Выберите назначение поступления.");
    showToClient = Boolean(projectId && clientId);
  } else {
    category = category || "Возврат"; expenseType = "" as ExpenseKind; showToClient = false;
    if (originalTransactionId) {
      const original = await first<{ id: string; type: string; cashbox_id: string; project_id: string | null; client_id: string | null; category: string; amount_kopecks: string | number }>("SELECT id, type, cashbox_id, project_id, client_id, category, amount_kopecks FROM financial_transactions WHERE id = $1 LIMIT 1", [originalTransactionId]);
      if (!original || original.type !== "EXPENSE") throw new FinanceError("Исходный расход для возврата не найден.");
      const refunded = await first<{ total: string | number }>("SELECT COALESCE(SUM(amount_kopecks), 0) AS total FROM financial_transactions WHERE type = 'REFUND' AND original_transaction_id = $1", [originalTransactionId]);
      if (amountKopecks > number(original.amount_kopecks) - number(refunded?.total)) throw new FinanceError("Сумма возврата превышает остаток исходного расхода.");
      sourceCashbox = await cashboxForActor(actor, original.cashbox_id);
      projectId = original.project_id; clientId = original.client_id; category = original.category;
    }
  }

  if (projectId) {
    const project = await projectForActor(actor, projectId);
    clientId = project.client_id;
  }
  const title = suppliedTitle || (type === "TRANSFER" ? "Перемещение между кассами" : type === "INCOME" ? source || "Поступление" : financeCategoryLabel(category || type));
  if (allocations.length && type !== "EXPENSE") throw new FinanceError("Распределение доступно только для объектного расхода.");

  const attachmentId = cleanText(input.attachmentId, 100) || null;
  if (attachmentId) {
    try {
      const attachment = await confirmAttachmentUpload(actor, attachmentId);
      if ((attachment.project_id ?? null) !== projectId) throw new FinanceError("Файл был загружен для другого объекта.", 409);
    } catch (error) {
      if (error instanceof FinanceError) throw error;
      if (error instanceof FileError) throw new FinanceError(error.message, error.status);
      throw error;
    }
  }

  const id = crypto.randomUUID();
  const balanceBefore = number(sourceCashbox.balance_kopecks);
  const sourceDelta = type === "EXPENSE" || type === "TRANSFER" ? -amountKopecks : amountKopecks;
  const statements: { text: string; params: unknown[] }[] = [];
  if (attachmentId) statements.push(
    { text: "SELECT pg_advisory_xact_lock(hashtext($1))", params: [attachmentId] },
    { text: "SELECT 1 / COUNT(*)::int FROM attachments WHERE id=$1 AND uploaded_by_user_id=$2 AND upload_status='UPLOADED' AND transaction_id IS NULL AND deleted_at IS NULL", params: [attachmentId, actor.id] },
  );
  statements.push(
    { text: "INSERT INTO financial_transactions (id, amount_kopecks, transaction_date, type, expense_type, author_user_id, cashbox_id, destination_cashbox_id, original_transaction_id, client_id, project_id, category, source, purpose, title, comment, show_to_client, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)", params: [id, amountKopecks, transactionDate, type, expenseType || null, actor.id, sourceCashbox.id, destinationCashbox?.id ?? null, originalTransactionId, clientId, projectId, category, source, purpose, title, comment, showToClient ? 1 : 0, timestamp, timestamp] },
    { text: "UPDATE cashboxes SET balance_kopecks = balance_kopecks + $1, updated_at = $2 WHERE id = $3 AND status = 'ACTIVE'", params: [sourceDelta, timestamp, sourceCashbox.id] },
  );
  const allocationPurpose = category === "MATERIALS" ? "MATERIALS" : category === "CONTRACTOR_WORK" ? "WORKS" : "OTHER";
  for (const allocation of allocations) {
    const allocationId = crypto.randomUUID();
    statements.push(
      { text: "INSERT INTO transaction_allocations (id,transaction_id,project_id,amount_kopecks,purpose,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)", params: [allocationId, id, allocation.projectId, allocation.amountKopecks, allocationPurpose, timestamp, timestamp] },
      { text: "INSERT INTO audit_logs (id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES ($1,$2,'TRANSACTION_ALLOCATION_CREATED','TransactionAllocation',$3,$4,$5)", params: [crypto.randomUUID(), actor.id, allocationId, timestamp, JSON.stringify({ transactionId: id, projectId: allocation.projectId, amountKopecks: allocation.amountKopecks })] },
    );
  }
  if (destinationCashbox) statements.push({ text: "UPDATE cashboxes SET balance_kopecks = balance_kopecks + $1, updated_at = $2 WHERE id = $3 AND status = 'ACTIVE'", params: [amountKopecks, timestamp, destinationCashbox.id] });

  if (attachmentId) statements.push(
    { text: "UPDATE attachments SET transaction_id=$1,project_id=$2,entity_type='FINANCIAL_TRANSACTION',entity_id=$1,upload_status='LINKED',linked_at=$3,updated_at=$4 WHERE id=$5 AND uploaded_by_user_id=$6 AND upload_status='UPLOADED' AND transaction_id IS NULL", params: [id, projectId, timestamp, timestamp, attachmentId, actor.id] },
    { text: "INSERT INTO audit_logs (id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES ($1,$2,'ATTACHMENT_LINKED','Attachment',$3,$4,$5)", params: [crypto.randomUUID(), actor.id, attachmentId, timestamp, JSON.stringify({ transactionId: id, projectId, allocationProjectIds: allocations.map((item) => item.projectId) })] },
  );
  statements.push({ text: "INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, occurred_at, metadata_json) VALUES ($1,$2,$3,'FinancialTransaction',$4,$5,$6)", params: [crypto.randomUUID(), actor.id, type === "TRANSFER" ? "TRANSFER_CREATED" : "FINANCIAL_TRANSACTION_CREATED", id, timestamp, JSON.stringify({ type, amountKopecks, cashboxId: sourceCashbox.id, destinationCashboxId: destinationCashbox?.id ?? null, projectId, allocations })] });
  await transaction(statements);

  const preview = destinationCashbox ? transferPreview(balanceBefore, number(destinationCashbox.balance_kopecks), amountKopecks) : null;
  return { id, balanceBeforeKopecks: balanceBefore, balanceAfterKopecks: balanceBefore + sourceDelta, destinationBalanceAfterKopecks: preview?.toAfterKopecks ?? null, warning: preview?.warning ?? (balanceBefore + sourceDelta < 0 ? `После операции баланс ${sourceCashbox.name} отрицательный.` : null) };
}

export async function updateFinanceOperation(actor: AuthUser, input: { id?: unknown; title?: unknown; comment?: unknown; showToClient?: unknown }) {
  if (actor.role !== "OWNER") throw new FinanceError("Редактировать финансовые операции может только Owner.", 403);
  const id = cleanText(input.id, 100);
  const existing = await first<{ id: string; title: string; comment: string | null; show_to_client: string | number; expense_type: string | null }>("SELECT id,title,comment,show_to_client,expense_type FROM financial_transactions WHERE id=$1 LIMIT 1", [id]);
  if (!existing) throw new FinanceError("Финансовая операция не найдена.", 404);
  const title = cleanText(input.title, 180);
  if (!title) throw new FinanceError("Укажите название операции.");
  const comment = cleanText(input.comment, 1000) || null;
  const showToClient = existing.expense_type === "PROJECT" && input.showToClient === true;
  const timestamp = nowSeconds();
  const changes = { title: { before: existing.title, after: title }, comment: { before: existing.comment, after: comment }, showToClient: { before: Boolean(number(existing.show_to_client)), after: showToClient } };
  await transaction([
    { text: "UPDATE financial_transactions SET title=$1,comment=$2,show_to_client=$3,updated_at=$4 WHERE id=$5", params: [title, comment, showToClient ? 1 : 0, timestamp, id] },
    { text: "INSERT INTO audit_logs (id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES ($1,$2,'FINANCIAL_TRANSACTION_UPDATED','FinancialTransaction',$3,$4,$5)", params: [crypto.randomUUID(), actor.id, id, timestamp, JSON.stringify({ changes, immutableFields: ["amountKopecks", "cashboxId", "projectId", "category", "allocations"] })] },
  ]);
  return { ok: true };
}

export async function getTeamFinanceAccess(actor: AuthUser) {
  if (actor.role !== "OWNER") throw new FinanceError("Только Owner управляет правами сотрудников.", 403);
  await ensurePersonalCashboxes();
  const rows = await query<{ id: string; display_name: string; role: string; status: string; employee_id: string | null; finance_access: string | number; own_cashbox: string | number; cashbox_id: string | null; cashbox_name: string | null; cashbox_status: string | null; balance_kopecks: string | number | null }>(`SELECT u.id, u.display_name, u.role, u.status, u.employee_id,
    COALESCE((SELECT allowed FROM user_permissions p WHERE p.user_id=u.id AND p.permission='FINANCE_ACCESS' AND p.scope='COMPANY'),0) AS finance_access,
    COALESCE((SELECT allowed FROM user_permissions p WHERE p.user_id=u.id AND p.permission='OWN_CASHBOX' AND p.scope='COMPANY'),0) AS own_cashbox,
    c.id AS cashbox_id, c.name AS cashbox_name, c.status AS cashbox_status, c.balance_kopecks
    FROM users u LEFT JOIN cashboxes c ON c.owner_user_id=u.id ORDER BY CASE WHEN u.role='OWNER' THEN 0 ELSE 1 END, u.display_name`);
  return rows.map((row) => ({ id: row.id, name: row.display_name, role: row.role, status: row.status, employeeId: row.employee_id, financeAccess: row.role === "OWNER" || Boolean(number(row.finance_access)), ownCashbox: row.role === "OWNER" || Boolean(number(row.own_cashbox)), cashbox: row.cashbox_id ? { id: row.cashbox_id, name: row.cashbox_name, status: row.cashbox_status, balanceKopecks: number(row.balance_kopecks) } : null }));
}

export async function setTeamFinanceAccess(actor: AuthUser, input: { userId?: unknown; financeAccess?: unknown; ownCashbox?: unknown; confirmNonZero?: unknown }) {
  if (actor.role !== "OWNER") throw new FinanceError("Только Owner управляет правами сотрудников.", 403);
  const userId = cleanText(input.userId, 100);
  const target = await first<{ id: string; display_name: string; role: string; employee_id: string | null; is_protected_owner: string | number }>("SELECT id, display_name, role, employee_id, is_protected_owner FROM users WHERE id = $1 LIMIT 1", [userId]);
  if (!target) throw new FinanceError("Сотрудник не найден.", 404);
  if (target.role === "OWNER" || Boolean(number(target.is_protected_owner))) throw new FinanceError("Права защищённого Owner всегда активны.");
  const financeAccess = input.financeAccess === true;
  const ownCashbox = input.ownCashbox === true;
  const existingBox = await first<CashboxRow>("SELECT c.*, u.display_name AS owner_name FROM cashboxes c LEFT JOIN users u ON u.id=c.owner_user_id WHERE c.owner_user_id=$1 LIMIT 1", [userId]);
  if (!ownCashbox && existingBox && number(existingBox.balance_kopecks) !== 0 && input.confirmNonZero !== true) {
    throw new FinanceError(`Баланс ${existingBox.name} составляет ${number(existingBox.balance_kopecks)} коп. Перед закрытием рекомендуется урегулировать остаток.`, 409, { requiresConfirmation: true, balanceKopecks: number(existingBox.balance_kopecks), cashboxName: existingBox.name });
  }
  const timestamp = nowSeconds();
  const statements: { text: string; params: unknown[] }[] = [
    { text: "INSERT INTO user_permissions (id,user_id,permission,scope,allowed,created_at,updated_at) VALUES ($1,$2,'FINANCE_ACCESS','COMPANY',$3,$4,$5) ON CONFLICT (user_id,permission,scope) DO UPDATE SET allowed=EXCLUDED.allowed,updated_at=EXCLUDED.updated_at", params: [crypto.randomUUID(), userId, financeAccess ? 1 : 0, timestamp, timestamp] },
    { text: "INSERT INTO user_permissions (id,user_id,permission,scope,allowed,created_at,updated_at) VALUES ($1,$2,'OWN_CASHBOX','COMPANY',$3,$4,$5) ON CONFLICT (user_id,permission,scope) DO UPDATE SET allowed=EXCLUDED.allowed,updated_at=EXCLUDED.updated_at", params: [crypto.randomUUID(), userId, ownCashbox ? 1 : 0, timestamp, timestamp] },
  ];
  if (ownCashbox) statements.push({ text: "INSERT INTO cashboxes (id,owner_user_id,name,type,owner_employee_id,currency,status,balance_kopecks,is_active,created_at,updated_at) VALUES ($1,$2,$3,'PERSONAL',$4,'RUB','ACTIVE',0,1,$5,$6) ON CONFLICT (owner_user_id) DO UPDATE SET name=EXCLUDED.name,status='ACTIVE',is_active=1,deactivated_at=NULL,deactivated_by_user_id=NULL,updated_at=EXCLUDED.updated_at", params: [`cashbox_${userId}`, userId, personalCashboxName({ id: userId, name: target.display_name }), target.employee_id, timestamp, timestamp] });
  else if (existingBox) statements.push({ text: "UPDATE cashboxes SET status='INACTIVE',is_active=0,deactivated_at=$1,deactivated_by_user_id=$2,updated_at=$3 WHERE id=$4", params: [timestamp, actor.id, timestamp, existingBox.id] });
  if (ownCashbox && !existingBox) statements.push({ text: "INSERT INTO audit_logs (id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES ($1,$2,'CASHBOX_CREATED','Cashbox',$3,$4,$5)", params: [crypto.randomUUID(), actor.id, `cashbox_${userId}`, timestamp, JSON.stringify({ ownerUserId: userId })] });
  if (!ownCashbox && existingBox) statements.push({ text: "INSERT INTO audit_logs (id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES ($1,$2,'CASHBOX_DEACTIVATED','Cashbox',$3,$4,$5)", params: [crypto.randomUUID(), actor.id, existingBox.id, timestamp, JSON.stringify({ balanceKopecks: number(existingBox.balance_kopecks) })] });
  statements.push({ text: "INSERT INTO audit_logs (id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES ($1,$2,'EMPLOYEE_FINANCE_ACCESS_CHANGED','User',$3,$4,$5)", params: [crypto.randomUUID(), actor.id, userId, timestamp, JSON.stringify({ financeAccess, ownCashbox, cashboxId: existingBox?.id ?? null })] });
  await transaction(statements);
  return { ok: true };
}
