import type { AuthUser } from "./auth";
import { CLIENT_SOURCES, normalizePhone, type ClientSource } from "./client-config";
import { first, query, transaction } from "./postgres";
import { assertModuleAction, getAccessProfile, AccessError } from "./permissions";
export type ClientStatus = "ACTIVE" | "ARCHIVED";

export class ClientError extends Error {
  status: number;
  duplicate?: ClientSummary;
  constructor(message: string, status = 400, duplicate?: ClientSummary) { super(message); this.status = status; this.duplicate = duplicate; }
}

type ClientRow = {
  id: string; name: string; phone: string; phone_normalized: string; secondary_phone: string | null;
  email: string | null; preferred_contact: string | null; source: ClientSource; comment: string | null;
  responsible_user_id: string; responsible_name: string; status: ClientStatus; archived_at: number | null;
  created_at: number; updated_at: number; project_count: string | number;
};

export type ClientSummary = ReturnType<typeof serializeClient>;

export type ClientInput = {
  fullName?: unknown; phone?: unknown; secondaryPhone?: unknown; email?: unknown; preferredContact?: unknown;
  source?: unknown; responsibleUserId?: unknown; comment?: unknown;
};

function cleanOptional(value: unknown, max: number) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

function validateInput(input: ClientInput, fallbackResponsible?: string) {
  const fullName = cleanOptional(input.fullName, 180);
  const phone = cleanOptional(input.phone, 80);
  const source = cleanOptional(input.source, 30) as ClientSource | null;
  const responsibleUserId = cleanOptional(input.responsibleUserId, 100) ?? fallbackResponsible ?? null;
  if (!fullName) throw new ClientError("Укажите ФИО клиента.");
  if (!phone || normalizePhone(phone).length < 5) throw new ClientError("Укажите корректный телефон клиента.");
  if (!source || !CLIENT_SOURCES.some((item) => item.value === source)) throw new ClientError("Выберите источник клиента.");
  if (!responsibleUserId) throw new ClientError("Выберите ответственного.");
  const email = cleanOptional(input.email, 180);
  if (email && !/^\S+@\S+\.\S+$/.test(email)) throw new ClientError("Проверьте адрес электронной почты.");
  const preferredContact = cleanOptional(input.preferredContact, 30);
  if (preferredContact && !["PHONE", "EMAIL"].includes(preferredContact)) throw new ClientError("Некорректный предпочтительный способ связи.");
  return {
    fullName, phone, phoneNormalized: normalizePhone(phone), secondaryPhone: cleanOptional(input.secondaryPhone, 80),
    email, preferredContact, source, responsibleUserId, comment: cleanOptional(input.comment, 3000),
  };
}

function serializeClient(row: ClientRow) {
  return {
    id: row.id, fullName: row.name, phone: row.phone, phoneNormalized: row.phone_normalized,
    secondaryPhone: row.secondary_phone, email: row.email, preferredContact: row.preferred_contact,
    source: row.source, comment: row.comment, responsibleUserId: row.responsible_user_id,
    responsibleName: row.responsible_name, status: row.status, archivedAt: row.archived_at,
    createdAt: row.created_at, updatedAt: row.updated_at, projectCount: Number(row.project_count ?? 0),
  };
}

async function assertResponsibleUser(userId: string) {
  const row = await first<{ id: string }>(`SELECT u.id FROM users u
    WHERE u.id=$1 AND u.status='ACTIVE' AND (u.role='OWNER' OR (u.role='EMPLOYEE' AND EXISTS (
      SELECT 1 FROM user_permissions p WHERE p.user_id=u.id AND p.permission='modules.clients.view' AND p.scope='COMPANY' AND p.allowed=1
    ))) LIMIT 1`, [userId]);
  if (!row) throw new ClientError("Выбранный пользователь не может быть ответственным.");
}

function baseSelect() {
  return `SELECT c.id,c.name,c.phone,c.phone_normalized,c.secondary_phone,c.email,c.preferred_contact,c.source,c.comment,
    c.responsible_user_id,u.display_name AS responsible_name,c.status,c.archived_at,c.created_at,c.updated_at,
    (SELECT COUNT(*) FROM projects p WHERE p.client_id=c.id) AS project_count
    FROM clients c JOIN users u ON u.id=c.responsible_user_id`;
}

export async function listResponsibleUsers() {
  return query<{ id: string; name: string }>(`SELECT u.id,u.display_name AS name FROM users u
    WHERE u.status='ACTIVE' AND (u.role='OWNER' OR (u.role='EMPLOYEE' AND EXISTS (
      SELECT 1 FROM user_permissions p WHERE p.user_id=u.id AND p.permission='modules.clients.view' AND p.scope='COMPANY' AND p.allowed=1
    ))) ORDER BY CASE WHEN u.role='OWNER' THEN 0 ELSE 1 END,u.display_name`);
}

export async function listClients(actor: AuthUser, requestUrl: string) {
  await assertModuleAction(actor, "clients", "clients.view");
  const access = await getAccessProfile(actor);
  const url = new URL(requestUrl);
  const search = (url.searchParams.get("search") ?? "").trim().slice(0, 120);
  const source = url.searchParams.get("source") ?? "ALL";
  const responsibleUserId = (url.searchParams.get("responsibleUserId") ?? "ALL").slice(0, 100);
  const status = url.searchParams.get("status") === "ARCHIVED" ? "ARCHIVED" : url.searchParams.get("status") === "ALL" ? "ALL" : "ACTIVE";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 30, 1), 100);
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);
  const params: unknown[] = [];
  const conditions: string[] = [];
  const add = (value: unknown) => { params.push(value); return `$${params.length}`; };
  if (actor.role !== "OWNER" && access.scopes.clients !== "ALL") conditions.push(`c.responsible_user_id=${add(actor.id)}`);
  if (search) {
    const term = `%${search}%`;
    const digits = normalizePhone(search);
    const nameParam = add(term);
    const phoneParam = add(digits ? `%${digits}%` : "__NO_PHONE_MATCH__");
    const emailParam = add(term);
    conditions.push(`(c.name ILIKE ${nameParam} OR c.phone_normalized LIKE ${phoneParam} OR c.email ILIKE ${emailParam})`);
  }
  if (CLIENT_SOURCES.some((item) => item.value === source)) conditions.push(`c.source=${add(source)}`);
  if (responsibleUserId !== "ALL") conditions.push(`c.responsible_user_id=${add(responsibleUserId)}`);
  if (status !== "ALL") conditions.push(`c.status=${add(status)}`);
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const count = await first<{ count: string | number }>(`SELECT COUNT(*) AS count FROM clients c${where}`, params);
  const rows = await query<ClientRow>(`${baseSelect()}${where} ORDER BY c.created_at DESC,c.id DESC LIMIT ${add(limit + 1)} OFFSET ${add(offset)}`, params);
  const hasMore = rows.length > limit;
  return {
    items: rows.slice(0, limit).map(serializeClient), total: Number(count?.count ?? 0), hasMore, nextOffset: hasMore ? offset + limit : null,
    responsibleUsers: await listResponsibleUsers(), sources: CLIENT_SOURCES,
  };
}

async function visibleClientRow(actor: AuthUser, clientId: string) {
  await assertModuleAction(actor, "clients", "clients.view");
  const access = await getAccessProfile(actor);
  const conditions = actor.role === "OWNER" || access.scopes.clients === "ALL" ? "" : " AND c.responsible_user_id=$2";
  const row = await first<ClientRow>(`${baseSelect()} WHERE c.id=$1${conditions} LIMIT 1`, conditions ? [clientId, actor.id] : [clientId]);
  if (!row) throw new AccessError("Клиент не найден или недоступен.", 404);
  return row;
}

export async function findDuplicateClient(actor: AuthUser, phone: string, excludeId?: string) {
  await assertModuleAction(actor, "clients", "clients.view");
  const normalized = normalizePhone(phone);
  if (normalized.length < 5) return null;
  const access = await getAccessProfile(actor);
  const params: unknown[] = [normalized];
  const conditions = ["c.phone_normalized=$1"];
  if (excludeId) { params.push(excludeId); conditions.push(`c.id<>$${params.length}`); }
  if (actor.role !== "OWNER" && access.scopes.clients !== "ALL") { params.push(actor.id); conditions.push(`c.responsible_user_id=$${params.length}`); }
  const row = await first<ClientRow>(`${baseSelect()} WHERE ${conditions.join(" AND ")} ORDER BY c.created_at DESC LIMIT 1`, params);
  return row ? serializeClient(row) : null;
}

export async function createClient(actor: AuthUser, input: ClientInput, forceDuplicate = false) {
  await assertModuleAction(actor, "clients", "clients.create");
  const data = validateInput(input, actor.id);
  await assertResponsibleUser(data.responsibleUserId);
  const duplicate = await findDuplicateClient(actor, data.phone);
  if (duplicate && !forceDuplicate) throw new ClientError("Возможный дубль клиента.", 409, duplicate);
  const id = crypto.randomUUID();
  const timestamp = Math.floor(Date.now() / 1000);
  await transaction([
    { text: `INSERT INTO clients (id,name,phone,phone_normalized,secondary_phone,email,preferred_contact,source,comment,responsible_user_id,status,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ACTIVE',$11,$12)`, params: [id, data.fullName, data.phone, data.phoneNormalized, data.secondaryPhone, data.email, data.preferredContact, data.source, data.comment, data.responsibleUserId, timestamp, timestamp] },
    { text: "INSERT INTO audit_logs (id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES ($1,$2,'CLIENT_CREATED','Client',$3,$4,$5)", params: [crypto.randomUUID(), actor.id, id, timestamp, JSON.stringify({ source: data.source, responsibleUserId: data.responsibleUserId })] },
  ]);
  return getClient(actor, id);
}

export async function getClient(actor: AuthUser, clientId: string) {
  const row = await visibleClientRow(actor, clientId);
  const access = await getAccessProfile(actor);
  const canReadProjects = actor.role === "OWNER" || (access.modules.projects && access.actions["projects.view"]);
  const canReadOrders = actor.role === "OWNER" || (access.modules.orders && access.actions["orders.view"]);
  const canReadFinances = actor.role === "OWNER" || (access.modules.finance && access.actions["finance.view"] && access.actions["finance.viewClientFunds"]);
  const canReadTasks = actor.role === "OWNER" || (access.modules.tasks && access.actions["tasks.view"]);
  const canReadDocuments = actor.role === "OWNER" || (access.modules.documents && access.actions["documents.view"]);
  const assignedProjectWhere = actor.role === "OWNER" || access.scopes.projects === "ALL" ? "" : ` AND (p.responsible_user_id=$2 OR EXISTS (SELECT 1 FROM user_project_access a WHERE a.project_id=p.id AND a.user_id=$2) OR p.manager_employee_id=$3 OR p.foreman_employee_id=$3)`;
  const assignedTaskWhere = actor.role === "OWNER" || access.scopes.tasks === "ALL" ? "" : " AND (t.assignee_employee_id=$2 OR t.created_by_user_id=$3)";
  const assignedDocumentWhere = actor.role === "OWNER" || access.scopes.documents === "ALL" ? "" : ` AND (a.entity_type='Client' OR EXISTS (SELECT 1 FROM projects p LEFT JOIN user_project_access upa ON upa.project_id=p.id AND upa.user_id=$2 WHERE p.id=a.project_id AND (p.responsible_user_id=$2 OR upa.id IS NOT NULL OR p.manager_employee_id=$3 OR p.foreman_employee_id=$3)))`;
  const [projects, orders, finances, tasks, documents] = await Promise.all([
    canReadProjects ? query<{ id: string; name: string; address: string | null; status: string }>(`SELECT p.id,p.name,p.address,p.status FROM projects p WHERE p.client_id=$1${assignedProjectWhere} ORDER BY p.created_at DESC`, assignedProjectWhere ? [clientId, actor.id, actor.employeeId] : [clientId]) : Promise.resolve([]),
    canReadOrders ? query<{ id: string; number: string; title: string; status: string; amountKopecks: number }>("SELECT id,number,title,status,amount_kopecks AS \"amountKopecks\" FROM orders WHERE client_id=$1 ORDER BY created_at DESC", [clientId]) : Promise.resolve([]),
    canReadFinances ? query<{ id: string; transactionDate: number; amountKopecks: number; type: string; purpose: string | null; title: string; projectName: string | null }>(`SELECT ft.id,ft.transaction_date AS "transactionDate",ft.amount_kopecks AS "amountKopecks",ft.type,ft.purpose,ft.title,p.name AS "projectName"
      FROM financial_transactions ft LEFT JOIN projects p ON p.id=ft.project_id WHERE ft.client_id=$1 AND (ft.type IN ('INCOME','REFUND') OR ft.show_to_client=1) ORDER BY ft.transaction_date DESC,ft.created_at DESC`, [clientId]) : Promise.resolve([]),
    canReadTasks ? query<{ id: string; title: string; deadline: number | null; status: string }>(`SELECT t.id,t.title,t.deadline,t.status FROM tasks t WHERE t.client_id=$1${assignedTaskWhere} ORDER BY t.created_at DESC`, assignedTaskWhere ? [clientId, actor.employeeId, actor.id] : [clientId]) : Promise.resolve([]),
    canReadDocuments ? query<{ id: string; originalFilename: string; category: string; createdAt: number }>(`SELECT a.id,a.original_filename AS "originalFilename",a.category,a.created_at AS "createdAt" FROM attachments a
      WHERE a.upload_status IN ('UPLOADED','LINKED') AND ((a.entity_type='Client' AND a.entity_id=$1) OR a.project_id IN (SELECT id FROM projects WHERE client_id=$1))${assignedDocumentWhere} ORDER BY a.created_at DESC`, assignedDocumentWhere ? [clientId, actor.id, actor.employeeId] : [clientId]) : Promise.resolve([]),
  ]);
  return { client: serializeClient(row), projects, orders, finances, tasks, documents };
}

export async function updateClient(actor: AuthUser, clientId: string, input: ClientInput) {
  await assertModuleAction(actor, "clients", "clients.edit");
  const before = await visibleClientRow(actor, clientId);
  const data = validateInput(input, before.responsible_user_id);
  await assertResponsibleUser(data.responsibleUserId);
  const timestamp = Math.floor(Date.now() / 1000);
  const changedFields = [
    ["fullName", before.name, data.fullName], ["phone", before.phone, data.phone], ["secondaryPhone", before.secondary_phone, data.secondaryPhone],
    ["email", before.email, data.email], ["preferredContact", before.preferred_contact, data.preferredContact], ["source", before.source, data.source],
    ["responsibleUserId", before.responsible_user_id, data.responsibleUserId], ["comment", before.comment, data.comment],
  ].filter(([, oldValue, newValue]) => oldValue !== newValue).map(([field]) => field);
  if (changedFields.length === 0) return getClient(actor, clientId);
  const statements = [
    { text: `UPDATE clients SET name=$1,phone=$2,phone_normalized=$3,secondary_phone=$4,email=$5,preferred_contact=$6,source=$7,comment=$8,responsible_user_id=$9,updated_at=$10 WHERE id=$11`, params: [data.fullName, data.phone, data.phoneNormalized, data.secondaryPhone, data.email, data.preferredContact, data.source, data.comment, data.responsibleUserId, timestamp, clientId] },
    { text: "INSERT INTO audit_logs (id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES ($1,$2,'CLIENT_UPDATED','Client',$3,$4,$5)", params: [crypto.randomUUID(), actor.id, clientId, timestamp, JSON.stringify({ changedFields })] },
  ];
  if (before.responsible_user_id !== data.responsibleUserId) statements.push({ text: "INSERT INTO audit_logs (id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES ($1,$2,'CLIENT_RESPONSIBLE_CHANGED','Client',$3,$4,$5)", params: [crypto.randomUUID(), actor.id, clientId, timestamp, JSON.stringify({ oldResponsibleUserId: before.responsible_user_id, newResponsibleUserId: data.responsibleUserId })] });
  await transaction(statements);
  return getClient(actor, clientId);
}

export async function setClientArchived(actor: AuthUser, clientId: string, archived: boolean) {
  await assertModuleAction(actor, "clients", "clients.edit");
  const before = await visibleClientRow(actor, clientId);
  const next: ClientStatus = archived ? "ARCHIVED" : "ACTIVE";
  if (before.status === next) return getClient(actor, clientId);
  const timestamp = Math.floor(Date.now() / 1000);
  await transaction([
    { text: "UPDATE clients SET status=$1,archived_at=$2,updated_at=$3 WHERE id=$4", params: [next, archived ? timestamp : null, timestamp, clientId] },
    { text: "INSERT INTO audit_logs (id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES ($1,$2,$3,'Client',$4,$5,'{}')", params: [crypto.randomUUID(), actor.id, archived ? "CLIENT_ARCHIVED" : "CLIENT_RESTORED", clientId, timestamp] },
  ]);
  return getClient(actor, clientId);
}
