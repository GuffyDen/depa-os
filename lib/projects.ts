import type { AuthUser } from "./auth";
import { financeCategoryLabel, financePurposeLabel } from "./finance-categories";
import { PROJECT_STATUSES, buildProjectName, type ProjectStatus } from "./project-config";
import { first, query, transaction } from "./postgres";
import { AccessError, assertModuleAction, getAccessProfile } from "./permissions";

export class ProjectError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

export type ProjectInput = {
  clientId?: unknown; residentialComplex?: unknown; address?: unknown; apartment?: unknown; areaSqm?: unknown; displayName?: unknown;
  responsibleUserId?: unknown; foremanEmployeeId?: unknown; status?: unknown; startDate?: unknown; plannedEndDate?: unknown;
  forecastEndDate?: unknown; actualEndDate?: unknown; contractWorksAmount?: unknown; estimatedMaterialsBudget?: unknown; comment?: unknown;
};

type ProjectRow = {
  id: string; client_id: string; client_name: string; client_phone: string; name: string; residential_complex: string | null;
  address: string; apartment: string; area_sqm: string | number | null; responsible_user_id: string; responsible_name: string;
  foreman_employee_id: string | null; foreman_name: string | null; status: ProjectStatus; start_date: number | null; planned_end_date: number | null;
  forecast_end_date: number | null; actual_end_date: number | null; contract_amount_kopecks: number | string;
  estimated_materials_budget_kopecks: number | string; comment: string | null; created_by_user_id: string; archived_at: number | null;
  created_at: number; updated_at: number;
};

function clean(value: unknown, max: number) {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result ? result.slice(0, max) : null;
}

function dateSeconds(value: unknown) {
  const text = clean(value, 10);
  if (!text) return null;
  const parsed = Date.parse(`${text}T00:00:00+10:00`);
  if (!Number.isFinite(parsed)) throw new ProjectError("Проверьте даты объекта.");
  return Math.floor(parsed / 1000);
}

function moneyKopecks(value: unknown) {
  if (value === null || value === undefined || value === "") return 0;
  const normalized = String(value).replaceAll(" ", "").replace(",", ".");
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) throw new ProjectError("Стоимость должна быть положительным числом или нулём.");
  return Math.round(amount * 100);
}

function validate(input: ProjectInput, actor: AuthUser, previous?: ProjectRow) {
  const clientId = clean(input.clientId, 100) ?? previous?.client_id ?? null;
  const residentialComplex = clean(input.residentialComplex, 180);
  const address = clean(input.address, 300);
  const apartment = clean(input.apartment, 40);
  const responsibleUserId = clean(input.responsibleUserId, 100) ?? previous?.responsible_user_id ?? actor.id;
  const status = (clean(input.status, 30) ?? previous?.status ?? "PLANNING") as ProjectStatus;
  if (!clientId) throw new ProjectError("Выберите клиента.");
  if (!address) throw new ProjectError("Укажите адрес объекта.");
  if (!apartment) throw new ProjectError("Укажите номер квартиры.");
  if (!PROJECT_STATUSES.some((item) => item.value === status)) throw new ProjectError("Некорректный статус объекта.");
  const areaText = clean(input.areaSqm, 20);
  const areaSqm = areaText ? Number(areaText.replace(",", ".")) : null;
  if (areaSqm !== null && (!Number.isFinite(areaSqm) || areaSqm <= 0 || areaSqm > 100000)) throw new ProjectError("Проверьте площадь объекта.");
  const plannedEndDate = dateSeconds(input.plannedEndDate);
  const forecastEndDate = dateSeconds(input.forecastEndDate) ?? plannedEndDate;
  const displayName = clean(input.displayName, 240) ?? buildProjectName(residentialComplex, address, apartment);
  return {
    clientId, residentialComplex, address, apartment, areaSqm, displayName, responsibleUserId,
    foremanEmployeeId: clean(input.foremanEmployeeId, 100), status, startDate: dateSeconds(input.startDate), plannedEndDate,
    forecastEndDate, actualEndDate: dateSeconds(input.actualEndDate), contractWorksAmountKopecks: moneyKopecks(input.contractWorksAmount),
    estimatedMaterialsBudgetKopecks: moneyKopecks(input.estimatedMaterialsBudget), comment: clean(input.comment, 4000),
  };
}

function baseSelect() {
  return `SELECT p.id,p.client_id,c.name AS client_name,c.phone AS client_phone,p.name,p.residential_complex,p.address,p.apartment,p.area_sqm,
    p.responsible_user_id,ru.display_name AS responsible_name,p.foreman_employee_id,fe.full_name AS foreman_name,p.status,p.start_date,
    p.planned_end_date,p.forecast_end_date,p.actual_end_date,p.contract_amount_kopecks,p.estimated_materials_budget_kopecks,p.comment,
    p.created_by_user_id,p.archived_at,p.created_at,p.updated_at
    FROM projects p JOIN clients c ON c.id=p.client_id JOIN users ru ON ru.id=p.responsible_user_id LEFT JOIN employees fe ON fe.id=p.foreman_employee_id`;
}

function serialize(row: ProjectRow) {
  return {
    id: row.id, clientId: row.client_id, clientName: row.client_name, clientPhone: row.client_phone, displayName: row.name,
    residentialComplex: row.residential_complex, address: row.address, apartment: row.apartment,
    areaSqm: row.area_sqm == null ? null : Number(row.area_sqm), responsibleUserId: row.responsible_user_id,
    responsibleName: row.responsible_name, foremanEmployeeId: row.foreman_employee_id, foremanName: row.foreman_name,
    status: row.status, startDate: row.start_date, plannedEndDate: row.planned_end_date, forecastEndDate: row.forecast_end_date,
    actualEndDate: row.actual_end_date, contractWorksAmountKopecks: Number(row.contract_amount_kopecks),
    estimatedMaterialsBudgetKopecks: Number(row.estimated_materials_budget_kopecks), comment: row.comment,
    createdByUserId: row.created_by_user_id, archivedAt: row.archived_at, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export async function listProjectManagers() {
  return query<{ id: string; name: string }>(`SELECT u.id,u.display_name AS name FROM users u WHERE u.status='ACTIVE' AND (u.role='OWNER' OR
    (u.role='EMPLOYEE' AND EXISTS (SELECT 1 FROM user_permissions up WHERE up.user_id=u.id AND up.permission='modules.projects.view' AND up.scope='COMPANY' AND up.allowed=1)))
    ORDER BY CASE WHEN u.role='OWNER' THEN 0 ELSE 1 END,u.display_name`);
}

export async function listForemen() {
  return query<{ id: string; name: string; position: string | null }>("SELECT id,full_name AS name,position FROM employees WHERE status='ACTIVE' ORDER BY full_name");
}

async function assertRelations(clientId: string, responsibleUserId: string, foremanEmployeeId: string | null) {
  const [client, responsible, foreman] = await Promise.all([
    first<{ id: string }>("SELECT id FROM clients WHERE id=$1 AND status='ACTIVE' LIMIT 1", [clientId]),
    first<{ id: string; employee_id: string | null }>(`SELECT u.id,u.employee_id FROM users u WHERE u.id=$1 AND u.status='ACTIVE' AND (u.role='OWNER' OR EXISTS
      (SELECT 1 FROM user_permissions up WHERE up.user_id=u.id AND up.permission='modules.projects.view' AND up.scope='COMPANY' AND up.allowed=1)) LIMIT 1`, [responsibleUserId]),
    foremanEmployeeId ? first<{ id: string }>("SELECT id FROM employees WHERE id=$1 AND status='ACTIVE' LIMIT 1", [foremanEmployeeId]) : Promise.resolve(null),
  ]);
  if (!client) throw new ProjectError("Выбранный клиент не найден или архивирован.");
  if (!responsible) throw new ProjectError("Выбранный пользователь не может быть ответственным.");
  if (foremanEmployeeId && !foreman) throw new ProjectError("Выбранный прораб недоступен.");
  return responsible;
}

function scopeCondition(actor: AuthUser, all: boolean, offset = 0) {
  if (actor.role === "OWNER" || all) return { sql: "", params: [] as unknown[] };
  return { sql: ` AND (p.responsible_user_id=$${offset + 1} OR EXISTS (SELECT 1 FROM user_project_access a WHERE a.project_id=p.id AND a.user_id=$${offset + 1}) OR p.manager_employee_id=$${offset + 2} OR p.foreman_employee_id=$${offset + 2})`, params: [actor.id, actor.employeeId] as unknown[] };
}

export async function listProjects(actor: AuthUser, requestUrl: string) {
  await assertModuleAction(actor, "projects", "projects.view");
  const access = await getAccessProfile(actor);
  const url = new URL(requestUrl);
  const search = (url.searchParams.get("search") ?? "").trim().slice(0, 150);
  const status = url.searchParams.get("status") ?? "WORKING";
  const responsible = (url.searchParams.get("responsibleUserId") ?? "ALL").slice(0, 100);
  const foreman = (url.searchParams.get("foremanEmployeeId") ?? "ALL").slice(0, 100);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 30, 1), 100);
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);
  const params: unknown[] = [];
  const conditions: string[] = ["1=1"];
  const add = (value: unknown) => { params.push(value); return `$${params.length}`; };
  if (actor.role !== "OWNER" && access.scopes.projects !== "ALL") conditions.push(`(p.responsible_user_id=${add(actor.id)} OR EXISTS (SELECT 1 FROM user_project_access a WHERE a.project_id=p.id AND a.user_id=${`$${params.length}`}) OR p.manager_employee_id=${add(actor.employeeId)} OR p.foreman_employee_id=${`$${params.length}`})`);
  if (search) { const like = add(`%${search}%`); conditions.push(`(p.name ILIKE ${like} OR p.residential_complex ILIKE ${like} OR p.address ILIKE ${like} OR p.apartment ILIKE ${like} OR c.name ILIKE ${like})`); }
  if (status === "WORKING") conditions.push("p.status IN ('PLANNING','ACTIVE','PAUSED')"); else if (PROJECT_STATUSES.some((item) => item.value === status)) conditions.push(`p.status=${add(status)}`);
  if (responsible !== "ALL") conditions.push(`p.responsible_user_id=${add(responsible)}`);
  if (foreman === "NONE") conditions.push("p.foreman_employee_id IS NULL"); else if (foreman !== "ALL") conditions.push(`p.foreman_employee_id=${add(foreman)}`);
  const where = ` WHERE ${conditions.join(" AND ")}`;
  const count = await first<{ count: string | number }>(`SELECT COUNT(*) AS count FROM projects p JOIN clients c ON c.id=p.client_id${where}`, params);
  const rows = await query<ProjectRow>(`${baseSelect()}${where} ORDER BY CASE p.status WHEN 'ACTIVE' THEN 0 WHEN 'PLANNING' THEN 1 WHEN 'PAUSED' THEN 2 WHEN 'COMPLETED' THEN 3 ELSE 4 END,p.created_at DESC,p.id DESC LIMIT ${add(limit + 1)} OFFSET ${add(offset)}`, params);
  return {
    items: rows.slice(0, limit).map(serialize), total: Number(count?.count ?? 0), hasMore: rows.length > limit, nextOffset: rows.length > limit ? offset + limit : null,
    managers: await listProjectManagers(), foremen: await listForemen(), statuses: PROJECT_STATUSES,
    hasClients: Boolean(await first<{ id: string }>("SELECT id FROM clients WHERE status='ACTIVE' LIMIT 1")),
  };
}

async function visibleRow(actor: AuthUser, projectId: string) {
  await assertModuleAction(actor, "projects", "projects.view");
  const access = await getAccessProfile(actor);
  const scope = scopeCondition(actor, access.scopes.projects === "ALL", 1);
  const row = await first<ProjectRow>(`${baseSelect()} WHERE p.id=$1${scope.sql} LIMIT 1`, [projectId, ...scope.params]);
  if (!row) throw new AccessError("Объект не найден или недоступен.", 404);
  return row;
}

function projectLedgerSql() {
  return `WITH project_ledger AS (
    SELECT ft.id AS transaction_id,ft.type,ft.amount_kopecks,ft.transaction_date,ft.category,ft.purpose,ft.title,ft.cashbox_id,ft.author_user_id
      FROM financial_transactions ft WHERE ft.project_id=$1 AND ft.type<>'EXPENSE'
    UNION ALL
    SELECT ft.id,ft.type,ft.amount_kopecks,ft.transaction_date,ft.category,ft.purpose,ft.title,ft.cashbox_id,ft.author_user_id
      FROM financial_transactions ft WHERE ft.project_id=$1 AND ft.type='EXPENSE' AND ft.expense_type='PROJECT' AND NOT EXISTS (SELECT 1 FROM transaction_allocations ta WHERE ta.transaction_id=ft.id)
    UNION ALL
    SELECT ft.id,ft.type,ta.amount_kopecks,ft.transaction_date,ft.category,ta.purpose,ft.title,ft.cashbox_id,ft.author_user_id
      FROM transaction_allocations ta JOIN financial_transactions ft ON ft.id=ta.transaction_id WHERE ta.project_id=$1 AND ft.type='EXPENSE' AND ft.expense_type='PROJECT'
  )`;
}

export async function getProject(actor: AuthUser, projectId: string) {
  const row = await visibleRow(actor, projectId);
  const access = await getAccessProfile(actor);
  const canReadFinance = actor.role === "OWNER" || (access.modules.finance && access.actions["finance.view"] && access.actions["projects.viewCost"]);
  const ledger = projectLedgerSql();
  const [summary, operations, estimates, stages, photos, additionalWorks, contractors, documents] = await Promise.all([
    canReadFinance ? first<{ materials_income: number | string; works_income: number | string; additional_income: number | string; materials_expense: number | string; object_expense: number | string }>(`${ledger} SELECT
      COALESCE(SUM(CASE WHEN type='INCOME' AND purpose='MATERIALS' THEN amount_kopecks ELSE 0 END),0) AS materials_income,
      COALESCE(SUM(CASE WHEN type='INCOME' AND purpose='WORKS' THEN amount_kopecks ELSE 0 END),0) AS works_income,
      COALESCE(SUM(CASE WHEN type='INCOME' AND purpose='ADDITIONAL_WORKS' THEN amount_kopecks ELSE 0 END),0) AS additional_income,
      COALESCE(SUM(CASE WHEN type='EXPENSE' AND category='MATERIALS' THEN amount_kopecks ELSE 0 END),0) AS materials_expense,
      COALESCE(SUM(CASE WHEN type='EXPENSE' THEN amount_kopecks ELSE 0 END),0) AS object_expense FROM project_ledger`, [projectId]) : Promise.resolve(null),
    canReadFinance ? query<{ id: string; type: string; amountKopecks: number; transactionDate: number; category: string; categoryLabel: string; purpose: string | null; purposeLabel: string | null; title: string; cashboxName: string; authorName: string; attachmentId: string | null }>(`${ledger} SELECT pl.transaction_id AS id,pl.type,pl.amount_kopecks AS "amountKopecks",pl.transaction_date AS "transactionDate",pl.category,pl.purpose,pl.title,cb.name AS "cashboxName",u.display_name AS "authorName",
      (SELECT a.id FROM attachments a WHERE a.transaction_id=pl.transaction_id AND a.upload_status='LINKED' AND a.deleted_at IS NULL ORDER BY a.created_at LIMIT 1) AS "attachmentId"
      FROM project_ledger pl JOIN cashboxes cb ON cb.id=pl.cashbox_id JOIN users u ON u.id=pl.author_user_id ORDER BY pl.transaction_date DESC,pl.transaction_id DESC`, [projectId]).then((items) => items.map((item) => ({ ...item, categoryLabel: financeCategoryLabel(item.category), purposeLabel: item.purpose ? financePurposeLabel(item.purpose) : null }))) : Promise.resolve([]),
    query<{ id: string; version: number; totalKopecks: number; createdAt: number }>("SELECT id,version,total_kopecks AS \"totalKopecks\",created_at AS \"createdAt\" FROM estimate_versions WHERE project_id=$1 ORDER BY version DESC", [projectId]),
    query<{ id: string; name: string; status: string; plannedStart: number | null; plannedEnd: number | null }>("SELECT id,name,status,planned_start AS \"plannedStart\",planned_end AS \"plannedEnd\" FROM project_stages WHERE project_id=$1 ORDER BY sort_order", [projectId]),
    query<{ id: string; originalFilename: string; createdAt: number }>("SELECT id,original_filename AS \"originalFilename\",created_at AS \"createdAt\" FROM attachments WHERE project_id=$1 AND category IN ('PROJECT_PHOTO','DAILY_REPORT') AND upload_status IN ('UPLOADED','LINKED') AND deleted_at IS NULL ORDER BY created_at DESC", [projectId]),
    query<{ id: string; title: string; amountKopecks: number; status: string; version: number }>("SELECT id,title,amount_kopecks AS \"amountKopecks\",status,version FROM additional_work_versions WHERE project_id=$1 ORDER BY created_at DESC", [projectId]),
    query<{ id: string; name: string; specialization: string; workTitle: string; status: string }>(`SELECT c.id,c.name,c.specialization,ca.work_title AS "workTitle",ca.status FROM contractor_agreements ca JOIN contractors c ON c.id=ca.contractor_id WHERE ca.project_id=$1 ORDER BY c.name`, [projectId]),
    query<{ id: string; originalFilename: string; category: string; createdAt: number }>("SELECT id,original_filename AS \"originalFilename\",category,created_at AS \"createdAt\" FROM attachments WHERE project_id=$1 AND category NOT IN ('RECEIPT','PROJECT_PHOTO','DAILY_REPORT') AND upload_status IN ('UPLOADED','LINKED') AND deleted_at IS NULL ORDER BY created_at DESC", [projectId]),
  ]);
  const finance = summary ? {
    materialsIncomeKopecks: Number(summary.materials_income), worksIncomeKopecks: Number(summary.works_income), additionalWorksIncomeKopecks: Number(summary.additional_income),
    materialsExpenseKopecks: Number(summary.materials_expense), objectExpenseKopecks: Number(summary.object_expense),
    materialsBalanceKopecks: Number(summary.materials_income) - Number(summary.materials_expense), operations,
  } : null;
  return { project: serialize(row), finance, estimates, stages, photos, additionalWorks, contractors, documents };
}

export async function createProject(actor: AuthUser, input: ProjectInput) {
  await assertModuleAction(actor, "projects", "projects.create");
  const data = validate(input, actor);
  const responsible = await assertRelations(data.clientId, data.responsibleUserId, data.foremanEmployeeId);
  const id = crypto.randomUUID();
  const timestamp = Math.floor(Date.now() / 1000);
  await transaction([
    { text: `INSERT INTO projects (id,order_id,client_id,name,residential_complex,address,apartment,area_sqm,responsible_user_id,manager_employee_id,foreman_employee_id,status,start_date,planned_end_date,forecast_end_date,actual_end_date,contract_amount_kopecks,estimated_materials_budget_kopecks,comment,created_by_user_id,created_at,updated_at)
      VALUES ($1,NULL,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`, params: [id, data.clientId, data.displayName, data.residentialComplex, data.address, data.apartment, data.areaSqm, data.responsibleUserId, responsible.employee_id, data.foremanEmployeeId, data.status, data.startDate, data.plannedEndDate, data.forecastEndDate, data.actualEndDate, data.contractWorksAmountKopecks, data.estimatedMaterialsBudgetKopecks, data.comment, actor.id, timestamp, timestamp] },
    { text: "INSERT INTO audit_logs (id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES ($1,$2,'PROJECT_CREATED','Project',$3,$4,$5)", params: [crypto.randomUUID(), actor.id, id, timestamp, JSON.stringify({ clientId: data.clientId, responsibleUserId: data.responsibleUserId, status: data.status })] },
  ]);
  return getProject(actor, id);
}

export async function updateProject(actor: AuthUser, projectId: string, input: ProjectInput) {
  await assertModuleAction(actor, "projects", "projects.edit");
  const before = await visibleRow(actor, projectId);
  const data = validate(input, actor, before);
  const responsible = await assertRelations(data.clientId, data.responsibleUserId, data.foremanEmployeeId);
  const timestamp = Math.floor(Date.now() / 1000);
  const changedFields = [["clientId",before.client_id,data.clientId],["displayName",before.name,data.displayName],["residentialComplex",before.residential_complex,data.residentialComplex],["address",before.address,data.address],["apartment",before.apartment,data.apartment],["areaSqm",before.area_sqm==null?null:Number(before.area_sqm),data.areaSqm],["responsibleUserId",before.responsible_user_id,data.responsibleUserId],["foremanEmployeeId",before.foreman_employee_id,data.foremanEmployeeId],["status",before.status,data.status],["startDate",before.start_date,data.startDate],["plannedEndDate",before.planned_end_date,data.plannedEndDate],["forecastEndDate",before.forecast_end_date,data.forecastEndDate],["actualEndDate",before.actual_end_date,data.actualEndDate],["contractWorksAmount",Number(before.contract_amount_kopecks),data.contractWorksAmountKopecks],["estimatedMaterialsBudget",Number(before.estimated_materials_budget_kopecks),data.estimatedMaterialsBudgetKopecks],["comment",before.comment,data.comment]].filter(([,oldValue,newValue])=>oldValue!==newValue).map(([field])=>field);
  if (!changedFields.length) return getProject(actor, projectId);
  const statements = [
    { text: `UPDATE projects SET client_id=$1,name=$2,residential_complex=$3,address=$4,apartment=$5,area_sqm=$6,responsible_user_id=$7,manager_employee_id=$8,foreman_employee_id=$9,status=$10,start_date=$11,planned_end_date=$12,forecast_end_date=$13,actual_end_date=$14,contract_amount_kopecks=$15,estimated_materials_budget_kopecks=$16,comment=$17,updated_at=$18 WHERE id=$19`, params: [data.clientId,data.displayName,data.residentialComplex,data.address,data.apartment,data.areaSqm,data.responsibleUserId,responsible.employee_id,data.foremanEmployeeId,data.status,data.startDate,data.plannedEndDate,data.forecastEndDate,data.actualEndDate,data.contractWorksAmountKopecks,data.estimatedMaterialsBudgetKopecks,data.comment,timestamp,projectId] },
    { text: "INSERT INTO audit_logs (id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES ($1,$2,'PROJECT_UPDATED','Project',$3,$4,$5)", params: [crypto.randomUUID(),actor.id,projectId,timestamp,JSON.stringify({changedFields})] },
  ];
  if (before.responsible_user_id!==data.responsibleUserId) statements.push({ text: "INSERT INTO audit_logs (id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES ($1,$2,'PROJECT_RESPONSIBLE_CHANGED','Project',$3,$4,$5)", params: [crypto.randomUUID(),actor.id,projectId,timestamp,JSON.stringify({oldResponsibleUserId:before.responsible_user_id,newResponsibleUserId:data.responsibleUserId})] });
  if (before.status!==data.status) statements.push({ text: "INSERT INTO audit_logs (id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES ($1,$2,'PROJECT_STATUS_CHANGED','Project',$3,$4,$5)", params: [crypto.randomUUID(),actor.id,projectId,timestamp,JSON.stringify({oldStatus:before.status,newStatus:data.status})] });
  await transaction(statements);
  return getProject(actor, projectId);
}

export async function setProjectArchived(actor: AuthUser, projectId: string, archived: boolean) {
  await assertModuleAction(actor, "projects", "projects.edit");
  const before = await visibleRow(actor, projectId);
  const next: ProjectStatus = archived ? "ARCHIVED" : "PLANNING";
  if (before.status===next) return getProject(actor, projectId);
  const timestamp=Math.floor(Date.now()/1000);
  await transaction([
    { text:"UPDATE projects SET status=$1,archived_at=$2,updated_at=$3 WHERE id=$4",params:[next,archived?timestamp:null,timestamp,projectId] },
    { text:"INSERT INTO audit_logs (id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES ($1,$2,$3,'Project',$4,$5,'{}')",params:[crypto.randomUUID(),actor.id,archived?"PROJECT_ARCHIVED":"PROJECT_RESTORED",projectId,timestamp] },
  ]);
  return getProject(actor,projectId);
}
