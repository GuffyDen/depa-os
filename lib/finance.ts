import type { AuthUser } from "./auth";
import { confirmAttachmentUpload, FileError } from "./files";
import { first, query, transaction } from "./postgres";
import { FINANCE_CATEGORY_GROUPS, categoryRequiresReceipt, financeCategoryLabel } from "./finance-categories";
import { INCOME_PURPOSES, investmentBalance, parseAmountKopecks, projectLedgerTotals, transferPreview, validateAllocations, validateExpense, validateInvestmentRepayment, type ExpenseKind, type FinanceOperationType } from "./finance-rules";
import { AccessError, assertActionPermission, assertModuleAction, canViewCashbox, getAccessProfile, getScope } from "./permissions";

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
  cashbox_id: string | null;
  cashbox_name: string | null;
  destination_cashbox_id: string | null;
  destination_cashbox_name: string | null;
  investment_account_id: string | null;
  investment_account_name: string | null;
  investment_owner_name: string | null;
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

type InvestmentAccountRow = {
  id: string;
  owner_user_id: string;
  owner_name: string;
  name: string;
  status: "ACTIVE" | "INACTIVE";
  contributed_kopecks: string | number;
  repaid_kopecks: string | number;
};

type InvestmentMovementRow = {
  id: string;
  investment_account_id: string;
  financial_transaction_id: string;
  type: "CONTRIBUTION" | "REPAYMENT";
  amount_kopecks: string | number;
  transaction_date: string | number;
  source_cashbox_id: string | null;
  source_cashbox_name: string | null;
  title: string;
  comment: string | null;
  category: string;
  expense_type: ExpenseKind | null;
  project_id: string | null;
  project_name: string | null;
  author_user_id: string;
  author_name: string;
  created_at: string | number;
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
function professionalCashboxName(value: string | null | undefined) {
  return String(value ?? "").replaceAll("Касса \u041f\u0430\u0448\u0438", "Касса Павла").replaceAll("Касса \u041f\u0430\u0445\u0438", "Касса Павла");
}
function parseAllocationsJson(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = item as { id?: unknown; projectId?: unknown; projectName?: unknown; amountKopecks?: unknown; purpose?: unknown };
    return { id: String(row.id ?? ""), projectId: String(row.projectId ?? ""), projectName: String(row.projectName ?? ""), amountKopecks: number(row.amountKopecks as string | number), purpose: String(row.purpose ?? "MATERIALS") };
  });
}

function personalCashboxName(user: Pick<AuthUser, "id" | "name">) {
  if (user.id === "user_owner_denis") return "Касса Дениса";
  if (user.id === "user_owner_pavel") return "Касса Павла";
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
          CASE id WHEN 'user_owner_denis' THEN 'Касса Дениса' WHEN 'user_owner_pavel' THEN 'Касса Павла' ELSE 'Касса ' || split_part(display_name, ' ', 1) END,
          'PERSONAL', employee_id, 'RUB', 'ACTIVE', 0, 1, $1, $2
        FROM users WHERE role = 'OWNER' AND status = 'ACTIVE'
        ON CONFLICT (owner_user_id) DO UPDATE SET name = EXCLUDED.name, owner_employee_id = EXCLUDED.owner_employee_id, type = 'PERSONAL', status = 'ACTIVE', is_active = 1, updated_at = EXCLUDED.updated_at
        WHERE cashboxes.name IS DISTINCT FROM EXCLUDED.name OR cashboxes.owner_employee_id IS DISTINCT FROM EXCLUDED.owner_employee_id OR cashboxes.type <> 'PERSONAL' OR cashboxes.status <> 'ACTIVE' OR cashboxes.is_active <> 1`,
      params: [timestamp, timestamp],
    },
    { text: "UPDATE cashboxes SET status = 'INACTIVE', is_active = 0, updated_at = $1 WHERE (owner_user_id IS NULL OR lower(name) LIKE '%общ%') AND (status <> 'INACTIVE' OR is_active <> 0)", params: [timestamp] },
  ]);
}

export async function ensureInvestmentAccounts() {
  const timestamp = nowSeconds();
  await query(`INSERT INTO investment_accounts (id,owner_user_id,name,currency,status,created_at,updated_at)
    SELECT 'investment_account_' || id,id,
      CASE id WHEN 'user_owner_denis' THEN 'Инвестиция Дениса' ELSE 'Инвестиция Павла' END,
      'RUB','ACTIVE',$1,$2
    FROM users WHERE id IN ('user_owner_denis','user_owner_pavel') AND role='OWNER' AND status='ACTIVE'
    ON CONFLICT(owner_user_id) DO UPDATE SET name=EXCLUDED.name,status='ACTIVE',updated_at=EXCLUDED.updated_at
    WHERE investment_accounts.name IS DISTINCT FROM EXCLUDED.name OR investment_accounts.status<>'ACTIVE'`, [timestamp, timestamp]);
}

async function assertFinanceAccess(actor: AuthUser) {
  try { await assertModuleAction(actor, "finance", "finance.view"); }
  catch (error) { if (error instanceof AccessError) throw new FinanceError("Нет доступа к финансовым операциям.", 403); throw error; }
}

async function cashboxById(id: string, requireActive = true) {
  const row = await first<CashboxRow>("SELECT c.*, u.display_name AS owner_name FROM cashboxes c LEFT JOIN users u ON u.id = c.owner_user_id WHERE c.id = $1 LIMIT 1", [id]);
  if (!row || (requireActive && row.status !== "ACTIVE")) throw new FinanceError("Касса не найдена или неактивна.", 404);
  return row;
}

async function cashboxForView(actor: AuthUser, id: string, requireActive = false) {
  const row = await cashboxById(id, requireActive);
  if (!(await canViewCashbox(actor, id))) throw new FinanceError("Нет доступа к истории этой кассы.", 403);
  return row;
}

async function ownCashboxForWrite(actor: AuthUser, id: string) {
  const row = await cashboxById(id, true);
  if (row.owner_user_id !== actor.id) throw new FinanceError("Финансовые операции можно проводить только из собственной кассы.", 403);
  return row;
}

async function cashboxForInvestmentRepayment(actor: AuthUser, id: string) {
  return actor.role === "OWNER" ? cashboxById(id, true) : ownCashboxForWrite(actor, id);
}

async function investmentAccountById(id: string, requireActive = true) {
  const row = await first<InvestmentAccountRow>(`SELECT ia.*,u.display_name AS owner_name,0 AS contributed_kopecks,0 AS repaid_kopecks
    FROM investment_accounts ia JOIN users u ON u.id=ia.owner_user_id WHERE ia.id=$1 LIMIT 1`, [id]);
  if (!row || (requireActive && row.status !== "ACTIVE")) throw new FinanceError("Инвестиционный счёт не найден или неактивен.", 404);
  return row;
}

async function investmentOutstandingKopecks(id: string) {
  const row = await first<{ contributed_kopecks: string | number; repaid_kopecks: string | number }>(`SELECT
    COALESCE(SUM(CASE WHEN type='CONTRIBUTION' THEN amount_kopecks ELSE 0 END),0) AS contributed_kopecks,
    COALESCE(SUM(CASE WHEN type='REPAYMENT' THEN amount_kopecks ELSE 0 END),0) AS repaid_kopecks
    FROM investment_movements WHERE investment_account_id=$1`, [id]);
  return investmentBalance(number(row?.contributed_kopecks), number(row?.repaid_kopecks));
}

async function projectForActor(actor: AuthUser, id: string) {
  const allProjects = actor.role === "OWNER" || await getScope(actor, "projects") === "ALL";
  const row = allProjects
    ? await first<{ id: string; client_id: string }>("SELECT id, client_id FROM projects WHERE id = $1 AND status <> 'ARCHIVED' LIMIT 1", [id])
    : await first<{ id: string; client_id: string }>("SELECT DISTINCT p.id,p.client_id FROM projects p LEFT JOIN user_project_access a ON a.project_id=p.id AND a.user_id=$2 WHERE p.id=$1 AND p.status<>'ARCHIVED' AND (a.id IS NOT NULL OR p.manager_employee_id=$3 OR p.foreman_employee_id=$3) LIMIT 1", [id, actor.id, actor.employeeId]);
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
    name: professionalCashboxName(row.name),
    status: row.status,
    balanceKopecks: number(row.balance_kopecks),
    createdAt: number(row.created_at),
    deactivatedAt: row.deactivated_at ? number(row.deactivated_at) : null,
    todayIncomeKopecks: today.filter((item) => item.cashbox_id === row.id && item.type === "INCOME").reduce((sum, item) => sum + number(item.amount_kopecks), 0),
    todayExpenseKopecks: today.filter((item) => item.cashbox_id === row.id && item.type === "EXPENSE").reduce((sum, item) => sum + number(item.amount_kopecks), 0),
    transferredOutKopecks: today.filter((item) => item.cashbox_id === row.id && (item.type === "TRANSFER" || item.type === "INVESTMENT_REPAYMENT")).reduce((sum, item) => sum + number(item.amount_kopecks), 0),
    transferredInKopecks: today.filter((item) => item.destination_cashbox_id === row.id && item.type === "TRANSFER").reduce((sum, item) => sum + number(item.amount_kopecks), 0),
  };
}

function serializeTransaction(row: TransactionRow) {
  const operationKind = row.type === "INVESTMENT_REPAYMENT" ? "INVESTMENT_REPAYMENT" : row.type === "EXPENSE" && row.investment_account_id ? "INVESTMENT" : row.type;
  return {
    id: row.id, type: row.type, operationKind, expenseType: row.expense_type, amountKopecks: number(row.amount_kopecks), transactionDate: number(row.transaction_date),
    cashboxId: row.cashbox_id, cashboxName: row.cashbox_name ? professionalCashboxName(row.cashbox_name) : row.investment_account_name ?? "Личные средства", destinationCashboxId: row.destination_cashbox_id, destinationCashboxName: row.destination_cashbox_name ? professionalCashboxName(row.destination_cashbox_name) : null,
    investmentAccountId: row.investment_account_id, investmentAccountName: row.investment_account_name, investmentOwnerName: row.investment_owner_name,
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
      WHEN ft.type='INVESTMENT_REPAYMENT' AND ft.cashbox_id=c.id THEN -ft.amount_kopecks
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
  await Promise.all([ensurePersonalCashboxes(), ensureInvestmentAccounts()]);
  await assertFinanceAccess(actor);
  const access = await getAccessProfile(actor);
  const canViewInvestments = actor.role === "OWNER" || access.actions["finance.viewInvestments"];
  const viewAllCashboxes = actor.role === "OWNER" || access.scopes.cashboxes === "ALL";
  const boxCondition = viewAllCashboxes ? "" : "WHERE c.owner_user_id = $1";
  const params = viewAllCashboxes ? [] : [actor.id];
  const investmentTransactionPredicate = canViewInvestments ? " OR ft.investment_account_id IS NOT NULL" : "";
  const cashboxTransactionPredicate = viewAllCashboxes ? "" : `(source_box.owner_user_id = $1 OR destination_box.owner_user_id = $1${investmentTransactionPredicate})`;
  const cashboxSummaryPredicate = viewAllCashboxes ? "" : `(EXISTS (SELECT 1 FROM cashboxes sc WHERE sc.id=ft.cashbox_id AND sc.owner_user_id=$1) OR EXISTS (SELECT 1 FROM cashboxes dc WHERE dc.id=ft.destination_cashbox_id AND dc.owner_user_id=$1)${investmentTransactionPredicate})`;
  const investmentPrivacyPredicate = canViewInvestments ? "" : "ft.investment_account_id IS NULL";
  const adminPredicate = access.actions["finance.viewAdministrativeExpenses"] ? "" : "ft.expense_type IS DISTINCT FROM 'ADMIN'";
  const transactionPredicates = [cashboxTransactionPredicate, investmentPrivacyPredicate, adminPredicate].filter(Boolean);
  const summaryPredicates = [cashboxSummaryPredicate, investmentPrivacyPredicate, adminPredicate].filter(Boolean);
  const transactionCondition = transactionPredicates.length ? `WHERE ${transactionPredicates.join(" AND ")}` : "";
  const summaryCondition = summaryPredicates.length ? `WHERE ${summaryPredicates.join(" AND ")}` : "";
  const allProjects = actor.role === "OWNER" || access.scopes.projects === "ALL";
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
    query<TransactionRow>(`SELECT ft.*, source_box.name AS cashbox_name, destination_box.name AS destination_cashbox_name, ia.name AS investment_account_name,iu.display_name AS investment_owner_name,p.name AS project_name, u.display_name AS author_name,
      (SELECT COUNT(*) FROM attachments a WHERE a.transaction_id = ft.id AND a.upload_status='LINKED' AND a.deleted_at IS NULL) AS attachment_count,
      (SELECT a.id FROM attachments a WHERE a.transaction_id = ft.id AND a.upload_status='LINKED' AND a.deleted_at IS NULL ORDER BY a.created_at LIMIT 1) AS attachment_id,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',ta.id,'projectId',ta.project_id,'projectName',ap.name,'amountKopecks',ta.amount_kopecks,'purpose',ta.purpose) ORDER BY ap.name) FROM transaction_allocations ta JOIN projects ap ON ap.id=ta.project_id WHERE ta.transaction_id=ft.id),'[]'::jsonb) AS allocations_json
      FROM financial_transactions ft LEFT JOIN cashboxes source_box ON source_box.id = ft.cashbox_id LEFT JOIN cashboxes destination_box ON destination_box.id = ft.destination_cashbox_id LEFT JOIN investment_accounts ia ON ia.id=ft.investment_account_id LEFT JOIN users iu ON iu.id=ia.owner_user_id LEFT JOIN projects p ON p.id = ft.project_id JOIN users u ON u.id = ft.author_user_id ${transactionCondition} ORDER BY ft.transaction_date DESC, ft.created_at DESC LIMIT 200`, params),
    allProjects
      ? query<{ id: string; name: string; client_id: string }>("SELECT id, name, client_id FROM projects WHERE status <> 'ARCHIVED' ORDER BY name")
      : query<{ id: string; name: string; client_id: string }>("SELECT DISTINCT p.id,p.name,p.client_id FROM projects p LEFT JOIN user_project_access a ON a.project_id=p.id AND a.user_id=$1 WHERE p.status<>'ARCHIVED' AND (p.responsible_user_id=$1 OR a.id IS NOT NULL OR p.manager_employee_id=$2 OR p.foreman_employee_id=$2) ORDER BY p.name", [actor.id, actor.employeeId]),
    (actor.role === "OWNER" || access.scopes.clients === "ALL")
      ? query<{ id: string; name: string }>("SELECT id, name FROM clients WHERE status = 'ACTIVE' ORDER BY name")
      : query<{ id: string; name: string }>("SELECT DISTINCT c.id,c.name FROM clients c LEFT JOIN projects p ON p.client_id=c.id LEFT JOIN user_project_access a ON a.project_id=p.id AND a.user_id=$1 WHERE c.status='ACTIVE' AND (c.responsible_user_id=$1 OR p.responsible_user_id=$1 OR a.id IS NOT NULL OR p.manager_employee_id=$2 OR p.foreman_employee_id=$2) ORDER BY c.name", [actor.id, actor.employeeId]),
    allProjects
      ? query<ProjectEconomicsRow>(`${ledgerSql} GROUP BY project_id`)
      : query<ProjectEconomicsRow>(`${ledgerSql} WHERE EXISTS (SELECT 1 FROM projects p LEFT JOIN user_project_access a ON a.project_id=p.id AND a.user_id=$1 WHERE p.id=ledger.project_id AND (p.responsible_user_id=$1 OR a.id IS NOT NULL OR p.manager_employee_id=$2 OR p.foreman_employee_id=$2)) GROUP BY project_id`, [actor.id, actor.employeeId]),
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
  const [investmentAccounts, investmentMovements] = canViewInvestments ? await Promise.all([
    query<InvestmentAccountRow>(`SELECT ia.id,ia.owner_user_id,ia.name,ia.status,u.display_name AS owner_name,
      COALESCE(SUM(CASE WHEN im.type='CONTRIBUTION' THEN im.amount_kopecks ELSE 0 END),0) AS contributed_kopecks,
      COALESCE(SUM(CASE WHEN im.type='REPAYMENT' THEN im.amount_kopecks ELSE 0 END),0) AS repaid_kopecks
      FROM investment_accounts ia JOIN users u ON u.id=ia.owner_user_id LEFT JOIN investment_movements im ON im.investment_account_id=ia.id
      WHERE ia.status='ACTIVE'
      GROUP BY ia.id,ia.owner_user_id,ia.name,ia.status,u.display_name ORDER BY ia.created_at,ia.id`),
    query<InvestmentMovementRow>(`SELECT im.*,ft.title,ft.comment,ft.category,ft.expense_type,ft.project_id,p.name AS project_name,cb.name AS source_cashbox_name,u.display_name AS author_name,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',ta.id,'projectId',ta.project_id,'projectName',ap.name,'amountKopecks',ta.amount_kopecks,'purpose',ta.purpose) ORDER BY ap.name) FROM transaction_allocations ta JOIN projects ap ON ap.id=ta.project_id WHERE ta.transaction_id=ft.id),'[]'::jsonb) AS allocations_json
      FROM investment_movements im JOIN financial_transactions ft ON ft.id=im.financial_transaction_id LEFT JOIN cashboxes cb ON cb.id=im.source_cashbox_id LEFT JOIN projects p ON p.id=ft.project_id JOIN users u ON u.id=im.created_by_user_id
      ORDER BY im.transaction_date DESC,im.created_at DESC,im.id DESC LIMIT 400`),
  ]) : [[], []] as [InvestmentAccountRow[], InvestmentMovementRow[]];
  const serializedInvestmentAccounts = investmentAccounts.map((account) => {
    const contributedKopecks = number(account.contributed_kopecks);
    const repaidKopecks = number(account.repaid_kopecks);
    return {
      id: account.id,
      ownerUserId: account.owner_user_id,
      ownerName: account.owner_name,
      name: account.name,
      status: account.status,
      contributedKopecks,
      repaidKopecks,
      outstandingKopecks: investmentBalance(contributedKopecks, repaidKopecks),
      movements: investmentMovements.filter((movement) => movement.investment_account_id === account.id).map((movement) => ({
        id: movement.id,
        type: movement.type,
        amountKopecks: number(movement.amount_kopecks),
        transactionDate: number(movement.transaction_date),
        transactionId: movement.financial_transaction_id,
        sourceCashboxId: movement.source_cashbox_id,
        sourceCashboxName: movement.source_cashbox_name ? professionalCashboxName(movement.source_cashbox_name) : null,
        title: movement.title,
        comment: movement.comment,
        category: movement.category,
        expenseType: movement.expense_type,
        projectId: movement.project_id,
        projectName: movement.project_name,
        authorUserId: movement.author_user_id,
        authorName: movement.author_name,
        createdAt: number(movement.created_at),
        allocations: parseAllocationsJson(movement.allocations_json),
      })),
    };
  });
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
  const depaProfitKopecks = 0; // Управленческий P&L будет подключён к достоверному реестру отдельным модулем.
  const visibleProjects = access.actions["finance.viewClientFunds"] ? serializedProjects : serializedProjects.map((project) => ({
    ...project, incomeKopecks: 0, expenseKopecks: 0, refundKopecks: 0, actualExpenseKopecks: 0, clientBalanceKopecks: 0,
    materialsIncomeKopecks: 0, materialsExpenseKopecks: 0, materialsBalanceKopecks: 0, worksIncomeKopecks: 0, worksExpenseKopecks: 0,
    worksBalanceKopecks: 0, additionalWorksIncomeKopecks: 0, otherIncomeKopecks: 0,
  }));
  return {
    isOwner: actor.role === "OWNER",
    currentUserId: actor.id,
    capabilities: {
      createExpense: access.actions["finance.createExpense"], createIncome: access.actions["finance.createIncome"], createTransfer: access.actions["finance.createTransfer"],
      editTransaction: access.actions["finance.editTransaction"], viewClientFunds: access.actions["finance.viewClientFunds"], viewProfit: access.actions["finance.viewProfit"],
      viewAdministrativeExpenses: access.actions["finance.viewAdministrativeExpenses"], viewInvestments: canViewInvestments,
      createInvestmentExpense: canViewInvestments && (actor.role === "OWNER" || access.actions["finance.createInvestmentExpense"]), repayInvestments: canViewInvestments && (actor.role === "OWNER" || access.actions["finance.repayInvestments"]),
      cashboxScope: access.scopes.cashboxes, hasOwnActiveCashbox: boxes.some((box) => box.owner_user_id === actor.id && box.status === "ACTIVE"),
    },
    cashboxes: boxes.map((box) => serializeCashbox(box, transactions)),
    transferRecipients: (await query<CashboxRow>("SELECT c.*,u.display_name AS owner_name FROM cashboxes c LEFT JOIN users u ON u.id=c.owner_user_id WHERE c.status='ACTIVE' AND c.owner_user_id<>$1 ORDER BY c.name", [actor.id])).map((box) => ({ id: box.id, name: professionalCashboxName(box.name), ownerName: box.owner_name })),
    transactions: serializedTransactions,
    investmentAccounts: serializedInvestmentAccounts,
    investmentOutstandingKopecks: canViewInvestments ? serializedInvestmentAccounts.reduce((sum, account) => sum + account.outstandingKopecks, 0) : null,
    projects: visibleProjects,
    clients,
    physicalTotalKopecks: boxes.filter((box) => box.status === "ACTIVE").reduce((sum, box) => sum + number(box.balance_kopecks), 0),
    clientFundsKopecks: access.actions["finance.viewClientFunds"] ? serializedProjects.reduce((sum, project) => sum + Math.max(0, project.materialsBalanceKopecks) + Math.max(0, project.worksBalanceKopecks) + Math.max(0, project.additionalWorksIncomeKopecks) + Math.max(0, project.otherIncomeKopecks), 0) : null,
    depaProfitKopecks: access.actions["finance.viewProfit"] ? depaProfitKopecks : null,
    summary: { todayIncomeKopecks: number(summary?.today_income_kopecks), todayExpenseKopecks: number(summary?.today_expense_kopecks), todayTransferKopecks: number(summary?.today_transfer_kopecks), monthProjectExpenseKopecks: number(summary?.month_project_expense_kopecks), monthAdminExpenseKopecks: access.actions["finance.viewAdministrativeExpenses"] ? number(summary?.month_admin_expense_kopecks) : null },
    attentionItems: attentionItems.filter((item) => access.actions["finance.viewAdministrativeExpenses"] || item.type !== "NEGATIVE_CASHBOX"),
    reconciliation: { ok: reconciliationMismatches.length === 0, mismatchCount: reconciliationMismatches.length },
  };
}

const cashboxHistoryCategories = new Set<string>([
  ...FINANCE_CATEGORY_GROUPS.PROJECT.map((item) => item.code),
  ...FINANCE_CATEGORY_GROUPS.ADMIN.map((item) => item.code),
]);

export type CashboxHistoryFilters = {
  cashboxId?: unknown;
  dateFrom?: unknown;
  dateTo?: unknown;
  transactionType?: unknown;
  category?: unknown;
  projectId?: unknown;
  limit?: unknown;
  offset?: unknown;
};

function validIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function getCashboxHistory(actor: AuthUser, filters: CashboxHistoryFilters) {
  await assertFinanceAccess(actor);
  const access = await getAccessProfile(actor);
  const canViewInvestments = actor.role === "OWNER" || access.actions["finance.viewInvestments"];
  const cashboxId = cleanText(filters.cashboxId, 100);
  if (!cashboxId) throw new FinanceError("Выберите кассу.");
  await cashboxForView(actor, cashboxId);

  const dateFrom = cleanText(filters.dateFrom, 10);
  const dateTo = cleanText(filters.dateTo, 10);
  if ((dateFrom && !validIsoDate(dateFrom)) || (dateTo && !validIsoDate(dateTo))) throw new FinanceError("Укажите корректный период.");
  if (dateFrom && dateTo && dateFrom > dateTo) throw new FinanceError("Дата начала периода должна быть не позже даты окончания.");

  const transactionType = cleanText(filters.transactionType, 20) as FinanceOperationType | "";
  if (transactionType && !["INCOME", "EXPENSE", "TRANSFER", "REFUND", "INVESTMENT_REPAYMENT"].includes(transactionType)) throw new FinanceError("Выберите корректный тип операции.");
  const category = cleanText(filters.category, 50);
  if (category && !cashboxHistoryCategories.has(category)) throw new FinanceError("Выберите корректную категорию.");
  const projectId = cleanText(filters.projectId, 100);
  const requestedLimit = Number(filters.limit);
  const requestedOffset = Number(filters.offset);
  const limit = Number.isInteger(requestedLimit) ? Math.min(50, Math.max(1, requestedLimit)) : 20;
  const offset = Number.isInteger(requestedOffset) ? Math.min(1_000_000, Math.max(0, requestedOffset)) : 0;

  const values: unknown[] = [cashboxId];
  const conditions = ["(ft.cashbox_id=$1 OR ft.destination_cashbox_id=$1)"];
  if (actor.role !== "OWNER" && !access.actions["finance.viewAdministrativeExpenses"]) conditions.push("ft.expense_type IS DISTINCT FROM 'ADMIN'");
  function bind(value: unknown) { values.push(value); return `$${values.length}`; }
  if (dateFrom) conditions.push(`ft.transaction_date >= EXTRACT(EPOCH FROM (${bind(dateFrom)}::date::timestamp AT TIME ZONE 'Asia/Vladivostok'))`);
  if (dateTo) conditions.push(`ft.transaction_date < EXTRACT(EPOCH FROM ((${bind(dateTo)}::date + 1)::timestamp AT TIME ZONE 'Asia/Vladivostok'))`);
  if (transactionType) conditions.push(`ft.type=${bind(transactionType)}`);
  if (category) conditions.push(`ft.category=${bind(category)}`);
  if (projectId) {
    const projectParam = bind(projectId);
    conditions.push(`(ft.project_id=${projectParam} OR EXISTS (SELECT 1 FROM transaction_allocations project_filter WHERE project_filter.transaction_id=ft.id AND project_filter.project_id=${projectParam}))`);
  }
  const limitParam = bind(limit + 1);
  const offsetParam = bind(offset);
  const rows = await query<TransactionRow>(`SELECT ft.*, source_box.name AS cashbox_name, destination_box.name AS destination_cashbox_name, ia.name AS investment_account_name,iu.display_name AS investment_owner_name,p.name AS project_name, u.display_name AS author_name,
    (SELECT COUNT(*) FROM attachments a WHERE a.transaction_id=ft.id AND a.upload_status='LINKED' AND a.deleted_at IS NULL) AS attachment_count,
    (SELECT a.id FROM attachments a WHERE a.transaction_id=ft.id AND a.upload_status='LINKED' AND a.deleted_at IS NULL ORDER BY a.created_at LIMIT 1) AS attachment_id,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',ta.id,'projectId',ta.project_id,'projectName',ap.name,'amountKopecks',ta.amount_kopecks,'purpose',ta.purpose) ORDER BY ap.name) FROM transaction_allocations ta JOIN projects ap ON ap.id=ta.project_id WHERE ta.transaction_id=ft.id),'[]'::jsonb) AS allocations_json
    FROM financial_transactions ft
    LEFT JOIN cashboxes source_box ON source_box.id=ft.cashbox_id
    LEFT JOIN cashboxes destination_box ON destination_box.id=ft.destination_cashbox_id
    LEFT JOIN investment_accounts ia ON ia.id=ft.investment_account_id
    LEFT JOIN users iu ON iu.id=ia.owner_user_id
    LEFT JOIN projects p ON p.id=ft.project_id
    JOIN users u ON u.id=ft.author_user_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY ft.transaction_date DESC,ft.created_at DESC,ft.id DESC
    LIMIT ${limitParam} OFFSET ${offsetParam}`, values);
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).map((row) => serializeTransaction(canViewInvestments ? row : {
    ...row,
    investment_account_name: row.investment_account_id ? "Инвестиционный счёт" : null,
    investment_owner_name: null,
  }));
  return { transactions: page, hasMore, nextOffset: hasMore ? offset + page.length : null };
}

export type CreateFinanceOperationInput = {
  type?: unknown; amount?: unknown; date?: unknown; cashboxId?: unknown; destinationCashboxId?: unknown; expenseType?: unknown;
  category?: unknown; projectId?: unknown; clientId?: unknown; orderId?: unknown; purpose?: unknown; source?: unknown; title?: unknown; comment?: unknown;
  showToClient?: unknown; originalTransactionId?: unknown; attachmentId?: unknown;
  allocations?: unknown; paymentSource?: unknown; destinationType?: unknown; investmentAccountId?: unknown;
};

export async function createFinanceOperation(actor: AuthUser, input: CreateFinanceOperationInput) {
  await Promise.all([ensurePersonalCashboxes(), ensureInvestmentAccounts()]);
  await assertFinanceAccess(actor);
  const requestedType = cleanText(input.type, 20) as FinanceOperationType;
  if (!["INCOME", "EXPENSE", "TRANSFER", "REFUND"].includes(requestedType)) throw new FinanceError("Выберите тип финансовой операции.");
  let type = requestedType;
  const requiredPermission = requestedType === "EXPENSE" ? "finance.createExpense" : requestedType === "INCOME" ? "finance.createIncome" : requestedType === "TRANSFER" ? "finance.createTransfer" : "finance.editTransaction";
  try { await assertActionPermission(actor, requiredPermission); }
  catch (error) { if (error instanceof AccessError) throw new FinanceError("Нет права на создание этой операции.", 403); throw error; }
  const amountKopecks = parseAmountKopecks(input.amount);
  if (!amountKopecks) throw new FinanceError("Сумма должна быть больше нуля.");
  const cashboxId = cleanText(input.cashboxId, 100);
  const paymentSource = cleanText(input.paymentSource, 20) || "CASHBOX";
  const destinationType = cleanText(input.destinationType, 20) || "CASHBOX";
  const requestedInvestmentAccountId = cleanText(input.investmentAccountId, 100);
  const personalExpense = requestedType === "EXPENSE" && paymentSource === "INVESTMENT";
  const investmentRepayment = requestedType === "TRANSFER" && destinationType === "INVESTMENT";
  if (requestedType === "EXPENSE" && !["CASHBOX", "INVESTMENT"].includes(paymentSource)) throw new FinanceError("Выберите источник оплаты расхода.");
  if (requestedType === "TRANSFER" && !["CASHBOX", "INVESTMENT"].includes(destinationType)) throw new FinanceError("Выберите получателя перевода.");
  if (personalExpense) {
    try { await assertActionPermission(actor, "finance.viewInvestments"); await assertActionPermission(actor, "finance.createInvestmentExpense"); }
    catch (error) { if (error instanceof AccessError) throw new FinanceError("Нет права оплачивать расходы личными средствами владельцев.", 403); throw error; }
  }
  if (investmentRepayment) {
    try { await assertActionPermission(actor, "finance.viewInvestments"); await assertActionPermission(actor, "finance.repayInvestments"); }
    catch (error) { if (error instanceof AccessError) throw new FinanceError("Нет права возвращать инвестиции.", 403); throw error; }
  }
  if (!personalExpense && !cashboxId) throw new FinanceError("Выберите кассу.");
  let sourceCashbox: CashboxRow | null = personalExpense ? null : investmentRepayment ? await cashboxForInvestmentRepayment(actor, cashboxId) : requestedType === "REFUND" ? await cashboxById(cashboxId) : await ownCashboxForWrite(actor, cashboxId);
  if ((personalExpense || investmentRepayment) && !requestedInvestmentAccountId) throw new FinanceError("Выберите инвестиционный счёт.");
  let destinationCashbox: CashboxRow | null = null;
  const investmentAccount: InvestmentAccountRow | null = personalExpense || investmentRepayment ? await investmentAccountById(requestedInvestmentAccountId) : null;
  const investmentOutstandingBefore: number | null = investmentAccount ? await investmentOutstandingKopecks(investmentAccount.id) : null;
  if (investmentRepayment) {
    const repaymentError = validateInvestmentRepayment(investmentOutstandingBefore ?? 0, amountKopecks);
    if (repaymentError) throw new FinanceError(repaymentError);
  }
  const timestamp = nowSeconds();
  const dateValue = cleanText(input.date, 30);
  const transactionDate = dateValue ? Math.floor(new Date(`${dateValue}T12:00:00+10:00`).getTime() / 1000) : timestamp;
  if (!Number.isFinite(transactionDate)) throw new FinanceError("Укажите корректную дату.");

  let expenseType = cleanText(input.expenseType, 20) as ExpenseKind;
  let category = cleanText(input.category, 100);
  let projectId = cleanText(input.projectId, 100) || null;
  let clientId = cleanText(input.clientId, 100) || null;
  let orderId = cleanText(input.orderId,100)||null;
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
  let source = cleanText(input.source, 180) || null;

  if (requestedType === "TRANSFER") {
    orderId = null;
    if (investmentRepayment) {
      type = "INVESTMENT_REPAYMENT";
      expenseType = "" as ExpenseKind; category = "INVESTMENT_REPAYMENT"; projectId = null; clientId = null; purpose = null; showToClient = false; originalTransactionId = null;
      source = source || sourceCashbox?.name || null;
    } else {
      const destinationId = cleanText(input.destinationCashboxId, 100);
      if (!destinationId) throw new FinanceError("Выберите кассу-получатель.");
      if (destinationId === cashboxId) throw new FinanceError("Кассы отправителя и получателя должны отличаться.");
      destinationCashbox = await cashboxById(destinationId, true);
      expenseType = "" as ExpenseKind; category = "Перемещение"; projectId = null; clientId = null; purpose = null; showToClient = false; originalTransactionId = null;
    }
  } else if (type === "EXPENSE") {
    if (expenseType !== "PROJECT" && expenseType !== "ADMIN") throw new FinanceError("Выберите тип расхода.");
    if (expenseType === "ADMIN" && actor.role !== "OWNER" && !(await getAccessProfile(actor)).actions["finance.viewAdministrativeExpenses"]) throw new FinanceError("Нет права на административные расходы.", 403);
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
    if (personalExpense) source = investmentAccount?.name ?? null;
  } else if (type === "INCOME") {
    category = category || "Поступление"; expenseType = "" as ExpenseKind;
    if ((projectId || clientId) && !(INCOME_PURPOSES as readonly string[]).includes(purpose ?? "")) throw new FinanceError("Выберите назначение поступления.");
    showToClient = Boolean(projectId && clientId);
  } else {
    category = category || "Возврат"; expenseType = "" as ExpenseKind; showToClient = false;
    if (originalTransactionId) {
      const original = await first<{ id: string; type: string; cashbox_id: string | null; project_id: string | null; client_id: string | null; category: string; amount_kopecks: string | number }>("SELECT id, type, cashbox_id, project_id, client_id, category, amount_kopecks FROM financial_transactions WHERE id = $1 LIMIT 1", [originalTransactionId]);
      if (!original || original.type !== "EXPENSE") throw new FinanceError("Исходный расход для возврата не найден.");
      if (!original.cashbox_id) throw new FinanceError("Возврат по расходу, оплаченному личными средствами, оформляется через инвестиционный учёт.");
      const refunded = await first<{ total: string | number }>("SELECT COALESCE(SUM(amount_kopecks), 0) AS total FROM financial_transactions WHERE type = 'REFUND' AND original_transaction_id = $1", [originalTransactionId]);
      if (amountKopecks > number(original.amount_kopecks) - number(refunded?.total)) throw new FinanceError("Сумма возврата превышает остаток исходного расхода.");
      sourceCashbox = await ownCashboxForWrite(actor, original.cashbox_id);
      projectId = original.project_id; clientId = original.client_id; category = original.category;
    }
  }

  if (projectId) {
    const project = await projectForActor(actor, projectId);
    clientId = project.client_id;
  }
  if(orderId){const access=await getAccessProfile(actor);if(actor.role!=="OWNER"&&(!access.modules.orders||!access.actions["orders.view"]))throw new FinanceError("Заказ недоступен.",403);const assigned=actor.role!=="OWNER"&&access.scopes.clients!=="ALL";const order=await first<{id:string;client_id:string}>(`SELECT o.id,o.client_id FROM orders o JOIN clients c ON c.id=o.client_id WHERE o.id=$1${assigned?" AND (o.responsible_user_id=$2 OR c.responsible_user_id=$2)":""} LIMIT 1`,assigned?[orderId,actor.id]:[orderId]);if(!order)throw new FinanceError("Заказ не найден или недоступен.",403);if(clientId&&clientId!==order.client_id)throw new FinanceError("Клиент не соответствует заказу.",409);clientId=order.client_id;}
  const title = suppliedTitle || (type === "TRANSFER" ? "Перемещение между кассами" : type === "INVESTMENT_REPAYMENT" ? `Возврат · ${investmentAccount?.name ?? "инвестиция"}` : type === "INCOME" ? source || "Поступление" : financeCategoryLabel(category || type));
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
  const balanceBefore = sourceCashbox ? number(sourceCashbox.balance_kopecks) : null;
  const sourceDelta = personalExpense ? 0 : type === "EXPENSE" || type === "TRANSFER" || type === "INVESTMENT_REPAYMENT" ? -amountKopecks : amountKopecks;
  const statements: { text: string; params: unknown[] }[] = [];
  const lockedCashboxIds = [sourceCashbox?.id, destinationCashbox?.id].filter((value): value is string => Boolean(value)).sort();
  if (lockedCashboxIds.length) statements.push({ text: "WITH locked AS (SELECT id FROM cashboxes WHERE id=ANY($1::text[]) AND status='ACTIVE' ORDER BY id FOR UPDATE) SELECT 1 / CASE WHEN COUNT(*)=$2 THEN 1 ELSE 0 END cashbox_guard FROM locked", params: [lockedCashboxIds, lockedCashboxIds.length] });
  if (investmentAccount) {
    statements.push({ text: "WITH locked AS (SELECT id FROM investment_accounts WHERE id=$1 AND status='ACTIVE' FOR UPDATE) SELECT 1 / CASE WHEN COUNT(*)=1 THEN 1 ELSE 0 END investment_guard FROM locked", params: [investmentAccount.id] });
    if (investmentRepayment) statements.push({ text: `SELECT 1 / CASE WHEN
      COALESCE(SUM(CASE WHEN type='CONTRIBUTION' THEN amount_kopecks ELSE -amount_kopecks END),0)>=$2
      THEN 1 ELSE 0 END investment_balance_guard FROM investment_movements WHERE investment_account_id=$1`, params: [investmentAccount.id, amountKopecks] });
  }
  if (type === "REFUND" && originalTransactionId) statements.push(
    { text: "SELECT pg_advisory_xact_lock(hashtext($1))", params: [`refund:${originalTransactionId}`] },
    { text: "WITH original AS (SELECT amount_kopecks FROM financial_transactions WHERE id=$1 AND type='EXPENSE') SELECT 1 / CASE WHEN COUNT(*)=1 AND COALESCE(MAX(amount_kopecks),0)-COALESCE((SELECT SUM(amount_kopecks) FROM financial_transactions WHERE type='REFUND' AND original_transaction_id=$1),0)>=$2 THEN 1 ELSE 0 END refund_guard FROM original", params: [originalTransactionId, amountKopecks] },
  );
  if (attachmentId) statements.push(
    { text: "SELECT pg_advisory_xact_lock(hashtext($1))", params: [attachmentId] },
    { text: "SELECT 1 / COUNT(*)::int FROM attachments WHERE id=$1 AND uploaded_by_user_id=$2 AND upload_status='UPLOADED' AND transaction_id IS NULL AND deleted_at IS NULL", params: [attachmentId, actor.id] },
  );
  statements.push(
    { text: "INSERT INTO financial_transactions (id, amount_kopecks, transaction_date, type, expense_type, author_user_id, cashbox_id, investment_account_id, destination_cashbox_id, original_transaction_id, client_id, project_id, order_id, category, source, purpose, title, comment, show_to_client, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)", params: [id, amountKopecks, transactionDate, type, expenseType || null, actor.id, sourceCashbox?.id ?? null, investmentAccount?.id ?? null, destinationCashbox?.id ?? null, originalTransactionId, clientId, projectId, orderId, category, source, purpose, title, comment, showToClient ? 1 : 0, timestamp, timestamp] },
  );
  if (sourceCashbox && sourceDelta !== 0) statements.push({ text: "UPDATE cashboxes SET balance_kopecks = balance_kopecks + $1, updated_at = $2 WHERE id = $3 AND status = 'ACTIVE'", params: [sourceDelta, timestamp, sourceCashbox.id] });
  const allocationPurpose = category === "MATERIALS" ? "MATERIALS" : category === "CONTRACTOR_WORK" ? "WORKS" : "OTHER";
  for (const allocation of allocations) {
    const allocationId = crypto.randomUUID();
    statements.push(
      { text: "INSERT INTO transaction_allocations (id,transaction_id,project_id,amount_kopecks,purpose,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)", params: [allocationId, id, allocation.projectId, allocation.amountKopecks, allocationPurpose, timestamp, timestamp] },
      { text: "INSERT INTO audit_logs (id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES ($1,$2,'TRANSACTION_ALLOCATION_CREATED','TransactionAllocation',$3,$4,$5)", params: [crypto.randomUUID(), actor.id, allocationId, timestamp, JSON.stringify({ transactionId: id, projectId: allocation.projectId, amountKopecks: allocation.amountKopecks })] },
    );
  }
  if (destinationCashbox) statements.push({ text: "UPDATE cashboxes SET balance_kopecks = balance_kopecks + $1, updated_at = $2 WHERE id = $3 AND status = 'ACTIVE'", params: [amountKopecks, timestamp, destinationCashbox.id] });
  if (investmentAccount) {
    const movementId = crypto.randomUUID();
    const movementType = personalExpense ? "CONTRIBUTION" : "REPAYMENT";
    statements.push(
      { text: "INSERT INTO investment_movements (id,investment_account_id,financial_transaction_id,type,amount_kopecks,transaction_date,source_cashbox_id,note,created_by_user_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", params: [movementId, investmentAccount.id, id, movementType, amountKopecks, transactionDate, sourceCashbox?.id ?? null, comment, actor.id, timestamp, timestamp] },
      { text: "INSERT INTO audit_logs (id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES ($1,$2,$3,'InvestmentMovement',$4,$5,$6)", params: [crypto.randomUUID(), actor.id, movementType === "CONTRIBUTION" ? "INVESTMENT_CONTRIBUTION_CREATED" : "INVESTMENT_REPAYMENT_CREATED", movementId, timestamp, JSON.stringify({ investmentAccountId: investmentAccount.id, financialTransactionId: id, amountKopecks, sourceCashboxId: sourceCashbox?.id ?? null })] },
    );
  }

  if (attachmentId) statements.push(
    { text: "UPDATE attachments SET transaction_id=$1,project_id=$2,entity_type='FINANCIAL_TRANSACTION',entity_id=$1,upload_status='LINKED',linked_at=$3,updated_at=$4 WHERE id=$5 AND uploaded_by_user_id=$6 AND upload_status='UPLOADED' AND transaction_id IS NULL", params: [id, projectId, timestamp, timestamp, attachmentId, actor.id] },
    { text: "INSERT INTO audit_logs (id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES ($1,$2,'ATTACHMENT_LINKED','Attachment',$3,$4,$5)", params: [crypto.randomUUID(), actor.id, attachmentId, timestamp, JSON.stringify({ transactionId: id, projectId, allocationProjectIds: allocations.map((item) => item.projectId) })] },
  );
  statements.push({ text: "INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, occurred_at, metadata_json) VALUES ($1,$2,$3,'FinancialTransaction',$4,$5,$6)", params: [crypto.randomUUID(), actor.id, type === "TRANSFER" ? "TRANSFER_CREATED" : type === "INVESTMENT_REPAYMENT" ? "INVESTMENT_REPAYMENT_TRANSACTION_CREATED" : "FINANCIAL_TRANSACTION_CREATED", id, timestamp, JSON.stringify({ type, amountKopecks, cashboxId: sourceCashbox?.id ?? null, investmentAccountId: investmentAccount?.id ?? null, destinationCashboxId: destinationCashbox?.id ?? null, projectId, orderId, allocations })] });
  try { await transaction(statements); }
  catch (error) {
    if ((error as { code?: string }).code === "22012") throw new FinanceError(investmentRepayment ? "Сумма возврата превышает остаток инвестиции." : "Состояние кассы или возврата изменилось. Обновите данные и повторите операцию.", 409);
    throw error;
  }

  const preview = destinationCashbox && balanceBefore !== null ? transferPreview(balanceBefore, number(destinationCashbox.balance_kopecks), amountKopecks) : null;
  const balanceAfter = balanceBefore === null ? null : balanceBefore + sourceDelta;
  const investmentAfter = investmentOutstandingBefore === null ? null : investmentOutstandingBefore + (personalExpense ? amountKopecks : -amountKopecks);
  return { id, balanceBeforeKopecks: balanceBefore, balanceAfterKopecks: balanceAfter, destinationBalanceAfterKopecks: preview?.toAfterKopecks ?? null, investmentOutstandingAfterKopecks: investmentAfter, warning: preview?.warning ?? (balanceAfter !== null && balanceAfter < 0 ? `После операции баланс ${sourceCashbox?.name ?? "кассы"} отрицательный.` : null) };
}

export async function updateFinanceOperation(actor: AuthUser, input: { id?: unknown; title?: unknown; comment?: unknown; showToClient?: unknown }) {
  try { await assertModuleAction(actor, "finance", "finance.editTransaction"); }
  catch (error) { if (error instanceof AccessError) throw new FinanceError("Нет права редактировать финансовые операции.", 403); throw error; }
  const id = cleanText(input.id, 100);
  const existing = await first<{ id: string; title: string; comment: string | null; show_to_client: string | number; expense_type: string | null; cashbox_id: string | null; investment_account_id: string | null }>("SELECT id,title,comment,show_to_client,expense_type,cashbox_id,investment_account_id FROM financial_transactions WHERE id=$1 LIMIT 1", [id]);
  if (!existing) throw new FinanceError("Финансовая операция не найдена.", 404);
  const access = await getAccessProfile(actor);
  if (existing.investment_account_id && actor.role !== "OWNER" && !access.actions["finance.viewInvestments"]) throw new FinanceError("Операция недоступна.", 403);
  if (existing.cashbox_id) {
    if (!(await canViewCashbox(actor, existing.cashbox_id))) throw new FinanceError("Операция недоступна.", 403);
  }
  if (existing.expense_type === "ADMIN" && actor.role !== "OWNER" && !access.actions["finance.viewAdministrativeExpenses"]) throw new FinanceError("Операция недоступна.", 403);
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
