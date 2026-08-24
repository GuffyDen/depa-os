import type { AuthUser } from "./auth";
import type { ClientPortalUser } from "./client-portal";
import { first, query, transaction } from "./postgres";
import { AccessError, assertModuleAction, canViewProject, getAccessProfile } from "./permissions";

const DAY = 86_400;
const now = () => Math.floor(Date.now() / 1000);
const id = () => crypto.randomUUID();
const clean = (value: unknown, max = 500) => typeof value === "string" ? value.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max) : "";
const integer = (value: unknown, label: string, minimum = 0) => { const parsed = Number(value); if (!Number.isInteger(parsed) || parsed < minimum) throw new AdditionalWorkError(`Проверьте поле «${label}».`); return parsed; };
const bool = (value: unknown) => value === true || value === 1 || value === "1";

export class AdditionalWorkError extends Error {
  status: number;
  details: Record<string, unknown>;
  constructor(message: string, status = 400, details: Record<string, unknown> = {}) { super(message); this.status = status; this.details = details; }
}

export type AdditionalWorkItemInput = { name?: unknown; description?: unknown; quantity?: unknown; unit?: unknown; clientUnitPriceKopecks?: unknown; internalUnitCostKopecks?: unknown };
export type ProposedTaskInput = { title?: unknown; description?: unknown; stageId?: unknown; progressType?: unknown; quantity?: unknown; unit?: unknown; typicalDurationDays?: unknown; clientVisible?: unknown };
export type AdditionalWorkInput = {
  projectId?: unknown; title?: unknown; reason?: unknown; clientDescription?: unknown; internalComment?: unknown; stageId?: unknown;
  responsibleUserId?: unknown; scheduleImpactType?: unknown; scheduleImpactDays?: unknown; taskCreationMode?: unknown; paymentDueDate?: unknown;
  items?: unknown; proposedTasks?: unknown;
};

type WorkRow = {
  id: string; project_id: string; client_id: string; order_id: string | null; contract_id: string | null; stage_id: string | null; number: string; title: string; status: string;
  responsible_user_id: string; current_version_id: string; approved_version_id: string | null; created_by_user_id: string; approved_by_client_portal_user_id: string | null;
  created_at: number; updated_at: number; client_name: string; project_name: string; project_address: string; residential_complex: string | null; responsible_name: string;
};

type VersionRow = {
  id: string; additional_work_id: string; project_id: string; version: number; title: string; amount_kopecks: number | string; schedule_delta_days: number;
  status: string; reason: string; client_description: string; internal_comment: string | null; schedule_impact_type: string; sent_at: number | null; rejected_at: number | null;
  approved_at: number | null; client_decision_comment: string | null; approved_by_client_portal_user_id: string | null; approved_by_user_id: string | null;
  manual_approval_reason: string | null; task_creation_mode: string; payment_due_date: number | null; schedule_applied_at: number | null; created_at: number; updated_at: number;
};

const reasons = new Set(["CLIENT_REQUEST", "HIDDEN_CONDITION", "DESIGN_CHANGE", "SCOPE_CHANGE", "ERROR_CORRECTION", "OTHER"]);
const impacts = new Set(["NO_IMPACT", "ADD_DAYS", "RECALCULATE"]);
const BIG_ZERO = BigInt(0), BIG_THOUSAND = BigInt(1000), BIG_ROUND_HALF = BigInt(500), BIG_MAX_QUANTITY = BigInt("999999999999");

function decimalMilli(value: unknown, label: string) {
  const text = String(value ?? "").trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,3})?$/.test(text)) throw new AdditionalWorkError(`Проверьте поле «${label}».`);
  const [whole, fraction = ""] = text.split(".");
  const milli = BigInt(whole) * BIG_THOUSAND + BigInt(fraction.padEnd(3, "0"));
  if (milli <= BIG_ZERO || milli > BIG_MAX_QUANTITY) throw new AdditionalWorkError(`Проверьте поле «${label}».`);
  return { milli, db: `${milli / BIG_THOUSAND}.${String(milli % BIG_THOUSAND).padStart(3, "0")}` };
}

function dateSeconds(value: unknown) {
  const text = clean(value, 10);
  if (!text) return null;
  const parsed = Date.parse(`${text}T00:00:00+10:00`);
  if (!Number.isFinite(parsed)) throw new AdditionalWorkError("Проверьте срок оплаты.");
  return Math.floor(parsed / 1000);
}

function validatePayload(input: AdditionalWorkInput) {
  const title = clean(input.title, 240), clientDescription = clean(input.clientDescription, 5_000), internalComment = clean(input.internalComment, 5_000) || null;
  if (!title) throw new AdditionalWorkError("Укажите название дополнительной работы.");
  if (!clientDescription) throw new AdditionalWorkError("Добавьте описание для клиента.");
  const reason = clean(input.reason, 40) || "OTHER"; if (!reasons.has(reason)) throw new AdditionalWorkError("Выберите причину дополнительной работы.");
  const scheduleImpactType = clean(input.scheduleImpactType, 30) || "NO_IMPACT"; if (!impacts.has(scheduleImpactType)) throw new AdditionalWorkError("Выберите влияние на срок.");
  const scheduleImpactDays = scheduleImpactType === "ADD_DAYS" ? integer(input.scheduleImpactDays, "Изменение срока", 1) : 0;
  const taskCreationMode = clean(input.taskCreationMode, 30) === "AFTER_APPROVAL" ? "AFTER_APPROVAL" : "NONE";
  if (!Array.isArray(input.items) || input.items.length === 0) throw new AdditionalWorkError("Добавьте минимум одну позицию, в том числе для работы стоимостью 0 ₽.");
  if (input.items.length > 100) throw new AdditionalWorkError("В одной версии допускается не более 100 позиций.");
  let total = BIG_ZERO;
  const items = (input.items as AdditionalWorkItemInput[]).map((raw, position) => {
    const name = clean(raw.name, 240), unit = clean(raw.unit, 40); if (!name || !unit) throw new AdditionalWorkError("Заполните название и единицу каждой позиции.");
    const quantity = decimalMilli(raw.quantity, `Количество: ${name}`), unitPrice = BigInt(integer(raw.clientUnitPriceKopecks, `Цена: ${name}`));
    const itemTotal = (quantity.milli * unitPrice + BIG_ROUND_HALF) / BIG_THOUSAND; total += itemTotal;
    const cost = raw.internalUnitCostKopecks === null || raw.internalUnitCostKopecks === undefined || raw.internalUnitCostKopecks === "" ? null : integer(raw.internalUnitCostKopecks, `Себестоимость: ${name}`);
    return { id: id(), position, name, description: clean(raw.description, 2_000) || null, quantity: quantity.db, clientUnitPriceKopecks: Number(unitPrice), clientTotalKopecks: Number(itemTotal), internalUnitCostKopecks: cost, unit };
  });
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new AdditionalWorkError("Итоговая стоимость слишком велика.");
  const proposedTasks = Array.isArray(input.proposedTasks) ? (input.proposedTasks as ProposedTaskInput[]).map((raw, position) => {
    const title = clean(raw.title, 240); if (!title) throw new AdditionalWorkError("Укажите название каждой производственной задачи.");
    const progressType = clean(raw.progressType, 20) === "QUANTITY" ? "QUANTITY" : "BINARY";
    const quantity = progressType === "QUANTITY" ? decimalMilli(raw.quantity, `Объём задачи: ${title}`).db : null;
    return { id: id(), position, title, description: clean(raw.description, 2_000) || null, stageId: clean(raw.stageId, 100) || null, progressType, quantity, unit: progressType === "QUANTITY" ? clean(raw.unit, 40) || null : null, typicalDurationDays: raw.typicalDurationDays === null || raw.typicalDurationDays === undefined || raw.typicalDurationDays === "" ? null : integer(raw.typicalDurationDays, `Длительность: ${title}`, 1), clientVisible: bool(raw.clientVisible) ? 1 : 0 };
  }) : [];
  if (taskCreationMode === "AFTER_APPROVAL" && proposedTasks.length === 0) throw new AdditionalWorkError("Добавьте предложенные задачи или отключите их создание.");
  return { title, reason, clientDescription, internalComment, scheduleImpactType, scheduleImpactDays, taskCreationMode, paymentDueDate: dateSeconds(input.paymentDueDate), items, proposedTasks, totalKopecks: Number(total) };
}

function employeeAudit(actor: AuthUser, action: string, entityId: string, metadata: Record<string, unknown>, at: number) {
  return { text: "INSERT INTO audit_logs(id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES($1,$2,$3,'AdditionalWork',$4,$5,$6::jsonb)", params: [id(), actor.id, action, entityId, at, JSON.stringify(metadata)] };
}

async function permit(actor: AuthUser, action: Parameters<typeof assertModuleAction>[2], projectId: string) {
  await assertModuleAction(actor, "projects", action);
  if (!(await canViewProject(actor, projectId))) throw new AccessError("Дополнительная работа этого объекта недоступна.", 403);
}

async function getWorkRow(workId: string) {
  return first<WorkRow>(`SELECT aw.*,c.name client_name,p.name project_name,p.address project_address,COALESCE(rc.name,p.residential_complex) residential_complex,u.display_name responsible_name
    FROM additional_works aw JOIN clients c ON c.id=aw.client_id JOIN projects p ON p.id=aw.project_id LEFT JOIN residential_complexes rc ON rc.id=p.residential_complex_id JOIN users u ON u.id=aw.responsible_user_id WHERE aw.id=$1`, [workId]);
}

async function internalWork(actor: AuthUser, workId: string, action: Parameters<typeof assertModuleAction>[2]) {
  const work = await getWorkRow(workId); if (!work) throw new AdditionalWorkError("Дополнительная работа не найдена.", 404); await permit(actor, action, work.project_id); return work;
}

async function serializeInternal(actor: AuthUser, work: WorkRow) {
  const access = await getAccessProfile(actor), showCost = actor.role === "OWNER" || access.actions["additionalWorks.viewCost"], showMargin = actor.role === "OWNER" || access.actions["additionalWorks.viewMargin"];
  const versions = await query<VersionRow>("SELECT * FROM additional_work_versions WHERE additional_work_id=$1 ORDER BY version DESC", [work.id]);
  const versionIds = versions.map((version) => version.id);
  const [items, proposedTasks, taskLinks, events, attachments, obligation] = await Promise.all([
    versionIds.length ? query<Record<string, unknown>>("SELECT * FROM additional_work_items WHERE additional_work_version_id=ANY($1) ORDER BY additional_work_version_id,position", [versionIds]) : [],
    versionIds.length ? query<Record<string, unknown>>("SELECT * FROM additional_work_proposed_tasks WHERE additional_work_version_id=ANY($1) ORDER BY additional_work_version_id,position", [versionIds]) : [],
    query<Record<string, unknown>>("SELECT l.additional_work_version_id,l.task_id,t.title,t.status,t.weight_within_stage FROM additional_work_task_links l JOIN tasks t ON t.id=l.task_id WHERE l.additional_work_id=$1 ORDER BY l.created_at", [work.id]),
    query<Record<string, unknown>>("SELECT e.*,COALESCE(u.display_name,pu.login_identifier) actor_name FROM additional_work_events e LEFT JOIN users u ON u.id=e.employee_user_id LEFT JOIN client_portal_users pu ON pu.id=e.client_portal_user_id WHERE e.additional_work_id=$1 ORDER BY e.occurred_at DESC,e.id DESC", [work.id]),
    query<Record<string, unknown>>("SELECT id,additional_work_version_id,original_filename,mime_type,size_bytes,visibility,created_at FROM attachments WHERE additional_work_version_id=ANY($1) AND upload_status='LINKED' AND deleted_at IS NULL ORDER BY created_at DESC", [versionIds.length ? versionIds : ["__none__"]]),
    first<Record<string, unknown>>(`SELECT o.id,o.amount_kopecks,o.paid_kopecks,o.status,o.due_date,COALESCE(SUM(a.amount_kopecks),0) allocated_kopecks FROM obligations o LEFT JOIN obligation_payment_allocations a ON a.obligation_id=o.id WHERE o.additional_work_id=$1 GROUP BY o.id`, [work.id]),
  ]);
  return {
    ...work,
    versions: versions.map((version) => {
      const versionItems = items.filter((item) => item.additional_work_version_id === version.id).map((item) => showCost ? item : { ...item, internal_unit_cost_kopecks: undefined });
      const internalCost = showCost && versionItems.every((item) => item.internal_unit_cost_kopecks !== null && item.internal_unit_cost_kopecks !== undefined) ? versionItems.reduce((sum, item) => sum + Math.round(Number(item.quantity) * Number(item.internal_unit_cost_kopecks)), 0) : null;
      return { ...version, internal_comment: actor.role === "OWNER" || access.actions["additionalWorks.editDraft"] ? version.internal_comment : null, items: versionItems, proposedTasks: proposedTasks.filter((task) => task.additional_work_version_id === version.id), marginKopecks: showMargin && internalCost !== null ? Number(version.amount_kopecks) - internalCost : null, internalCostKopecks: showCost ? internalCost : null };
    }),
    taskLinks, events, attachments, obligation,
    capabilities: Object.fromEntries(["editDraft", "createVersion", "send", "withdraw", "manualApprove", "manageProductionLinks", "applyScheduleImpact", "viewCost", "viewMargin", "uploadFiles"].map((key) => [key, actor.role === "OWNER" || Boolean(access.actions[`additionalWorks.${key}` as keyof typeof access.actions])])),
  };
}

export async function getAdditionalWork(actor: AuthUser, workId: string) { const work = await internalWork(actor, workId, "additionalWorks.view"); return serializeInternal(actor, work); }

export async function listAdditionalWorks(actor: AuthUser, requestUrl: string) {
  await assertModuleAction(actor, "projects", "additionalWorks.view");
  const access = await getAccessProfile(actor), url = new URL(requestUrl), projectId = clean(url.searchParams.get("projectId"), 100), search = clean(url.searchParams.get("search"), 150), status = clean(url.searchParams.get("status"), 40) || "ALL", responsible = clean(url.searchParams.get("responsibleUserId"), 100) || "ALL";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 30, 1), 100), offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0), params: unknown[] = [], where: string[] = ["1=1"];
  const add = (value: unknown) => { params.push(value); return `$${params.length}`; };
  if (projectId) where.push(`aw.project_id=${add(projectId)}`);
  if (actor.role !== "OWNER" && access.scopes.additionalWorks !== "ALL") { const actorParam = add(actor.id), employeeParam = add(actor.employeeId); where.push(`(p.responsible_user_id=${actorParam} OR aw.responsible_user_id=${actorParam} OR EXISTS(SELECT 1 FROM user_project_access upa WHERE upa.project_id=p.id AND upa.user_id=${actorParam}) OR p.manager_employee_id=${employeeParam} OR p.foreman_employee_id=${employeeParam})`); }
  if (search) { const like = add(`%${search}%`); where.push(`(aw.number ILIKE ${like} OR aw.title ILIKE ${like} OR c.name ILIKE ${like} OR p.address ILIKE ${like} OR COALESCE(rc.name,p.residential_complex) ILIKE ${like})`); }
  if (status !== "ALL") where.push(`aw.status=${add(status)}`); if (responsible !== "ALL") where.push(`aw.responsible_user_id=${add(responsible)}`);
  const sqlWhere = where.join(" AND "), count = await first<{ count: number | string }>(`SELECT COUNT(*) count FROM additional_works aw JOIN projects p ON p.id=aw.project_id JOIN clients c ON c.id=aw.client_id LEFT JOIN residential_complexes rc ON rc.id=p.residential_complex_id WHERE ${sqlWhere}`, params);
  const rows = await query<Record<string, unknown>>(`SELECT aw.*,c.name client_name,p.name project_name,p.address,COALESCE(rc.name,p.residential_complex) residential_complex,u.display_name responsible_name,v.version,v.amount_kopecks,v.schedule_impact_type,v.schedule_delta_days,
    (SELECT COUNT(*)::int FROM additional_work_task_links l WHERE l.additional_work_id=aw.id) task_count FROM additional_works aw JOIN projects p ON p.id=aw.project_id JOIN clients c ON c.id=aw.client_id LEFT JOIN residential_complexes rc ON rc.id=p.residential_complex_id JOIN users u ON u.id=aw.responsible_user_id JOIN additional_work_versions v ON v.id=aw.current_version_id WHERE ${sqlWhere} ORDER BY aw.created_at DESC,aw.id DESC LIMIT ${add(limit + 1)} OFFSET ${add(offset)}`, params);
  return { items: rows.slice(0, limit), total: Number(count?.count ?? 0), hasMore: rows.length > limit, nextOffset: rows.length > limit ? offset + limit : null };
}

export async function createAdditionalWork(actor: AuthUser, input: AdditionalWorkInput) {
  const projectId = clean(input.projectId, 100); if (!projectId) throw new AdditionalWorkError("Выберите объект."); await permit(actor, "additionalWorks.create", projectId);
  const project = await first<{ client_id: string; order_id: string | null; contract_id: string | null; responsible_user_id: string }>("SELECT client_id,order_id,contract_id,responsible_user_id FROM projects WHERE id=$1", [projectId]); if (!project) throw new AdditionalWorkError("Объект не найден.", 404);
  const stageId = clean(input.stageId, 100) || null; if (stageId && !(await first("SELECT id FROM project_stages WHERE id=$1 AND project_id=$2 AND archived_at IS NULL", [stageId, projectId]))) throw new AdditionalWorkError("Этап не относится к выбранному объекту.");
  const responsibleUserId = clean(input.responsibleUserId, 100) || project.responsible_user_id || actor.id; if (!(await first("SELECT id FROM users WHERE id=$1 AND status='ACTIVE'", [responsibleUserId]))) throw new AdditionalWorkError("Ответственный недоступен.");
  const payload = validatePayload(input), workId = id(), versionId = id(), timestamp = now();
  const statements: Parameters<typeof transaction>[0] = [
    { text: `INSERT INTO additional_works(id,project_id,client_id,order_id,contract_id,stage_id,number,title,status,responsible_user_id,current_version_id,created_by_user_id,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,'ДР-'||lpad(nextval('additional_work_number_seq')::text,6,'0'),$7,'DRAFT',$8,$9,$10,$11,$12)`, params: [workId, projectId, project.client_id, project.order_id, project.contract_id, stageId, payload.title, responsibleUserId, versionId, actor.id, timestamp, timestamp] },
    { text: `INSERT INTO additional_work_versions(id,additional_work_id,project_id,version,title,amount_kopecks,schedule_delta_days,status,reason,client_description,internal_comment,schedule_impact_type,task_creation_mode,payment_due_date,created_by_user_id,created_at,updated_at)
      VALUES($1,$2,$3,1,$4,$5,$6,'DRAFT',$7,$8,$9,$10,$11,$12,$13,$14,$15)`, params: [versionId, workId, projectId, payload.title, payload.totalKopecks, payload.scheduleImpactDays, payload.reason, payload.clientDescription, payload.internalComment, payload.scheduleImpactType, payload.taskCreationMode, payload.paymentDueDate, actor.id, timestamp, timestamp] },
  ];
  for (const item of payload.items) statements.push({ text: "INSERT INTO additional_work_items(id,additional_work_version_id,position,name,description,quantity,unit,client_unit_price_kopecks,client_total_kopecks,internal_unit_cost_kopecks,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)", params: [item.id, versionId, item.position, item.name, item.description, item.quantity, item.unit, item.clientUnitPriceKopecks, item.clientTotalKopecks, item.internalUnitCostKopecks, timestamp, timestamp] });
  for (const task of payload.proposedTasks) statements.push({ text: "INSERT INTO additional_work_proposed_tasks(id,additional_work_version_id,stage_id,position,title,description,progress_type,quantity,unit,typical_duration_days,client_visible,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)", params: [task.id, versionId, task.stageId ?? stageId, task.position, task.title, task.description, task.progressType, task.quantity, task.unit, task.typicalDurationDays, task.clientVisible, timestamp, timestamp] });
  statements.push(
    { text: "INSERT INTO additional_work_events(id,additional_work_id,additional_work_version_id,type,employee_user_id,metadata_json,occurred_at) VALUES($1,$2,$3,'CREATED',$4,$5::jsonb,$6)", params: [id(), workId, versionId, actor.id, JSON.stringify({ version: 1, amountKopecks: payload.totalKopecks }), timestamp] },
    employeeAudit(actor, "ADDITIONAL_WORK_CREATED", workId, { projectId, versionId, amountKopecks: payload.totalKopecks }, timestamp),
  );
  await transaction(statements); return getAdditionalWork(actor, workId);
}

export async function updateAdditionalWorkDraft(actor: AuthUser, workId: string, input: AdditionalWorkInput) {
  const work = await internalWork(actor, workId, "additionalWorks.editDraft"), payload = validatePayload(input), stageId = clean(input.stageId, 100) || null;
  if (stageId && !(await first("SELECT id FROM project_stages WHERE id=$1 AND project_id=$2 AND archived_at IS NULL", [stageId, work.project_id]))) throw new AdditionalWorkError("Этап не относится к выбранному объекту.");
  const responsible = clean(input.responsibleUserId, 100) || work.responsible_user_id, timestamp = now(), versionId = work.current_version_id;
  const statements: Parameters<typeof transaction>[0] = [
    { text: "WITH locked AS (SELECT v.id FROM additional_work_versions v JOIN additional_works aw ON aw.id=v.additional_work_id WHERE v.id=$1 AND aw.id=$2 AND v.status='DRAFT' FOR UPDATE OF v,aw) SELECT 1/COUNT(*)::int guard FROM locked", params: [versionId, workId] },
    { text: "UPDATE additional_works SET title=$1,stage_id=$2,responsible_user_id=$3,updated_at=$4 WHERE id=$5", params: [payload.title, stageId, responsible, timestamp, workId] },
    { text: "UPDATE additional_work_versions SET title=$1,amount_kopecks=$2,schedule_delta_days=$3,reason=$4,client_description=$5,internal_comment=$6,schedule_impact_type=$7,task_creation_mode=$8,payment_due_date=$9,updated_at=$10 WHERE id=$11", params: [payload.title, payload.totalKopecks, payload.scheduleImpactDays, payload.reason, payload.clientDescription, payload.internalComment, payload.scheduleImpactType, payload.taskCreationMode, payload.paymentDueDate, timestamp, versionId] },
    { text: "DELETE FROM additional_work_items WHERE additional_work_version_id=$1", params: [versionId] },
    { text: "DELETE FROM additional_work_proposed_tasks WHERE additional_work_version_id=$1", params: [versionId] },
  ];
  for (const item of payload.items) statements.push({ text: "INSERT INTO additional_work_items(id,additional_work_version_id,position,name,description,quantity,unit,client_unit_price_kopecks,client_total_kopecks,internal_unit_cost_kopecks,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)", params: [item.id, versionId, item.position, item.name, item.description, item.quantity, item.unit, item.clientUnitPriceKopecks, item.clientTotalKopecks, item.internalUnitCostKopecks, timestamp, timestamp] });
  for (const task of payload.proposedTasks) statements.push({ text: "INSERT INTO additional_work_proposed_tasks(id,additional_work_version_id,stage_id,position,title,description,progress_type,quantity,unit,typical_duration_days,client_visible,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)", params: [task.id, versionId, task.stageId ?? stageId, task.position, task.title, task.description, task.progressType, task.quantity, task.unit, task.typicalDurationDays, task.clientVisible, timestamp, timestamp] });
  statements.push({ text: "INSERT INTO additional_work_events(id,additional_work_id,additional_work_version_id,type,employee_user_id,metadata_json,occurred_at) VALUES($1,$2,$3,'UPDATED',$4,$5::jsonb,$6)", params: [id(), workId, versionId, actor.id, JSON.stringify({ amountKopecks: payload.totalKopecks }), timestamp] }, employeeAudit(actor, "ADDITIONAL_WORK_UPDATED", workId, { projectId: work.project_id, versionId }, timestamp));
  try { await transaction(statements); } catch (error) { if ((error as { code?: string }).code === "22012") throw new AdditionalWorkError("Отправленную версию нельзя редактировать.", 409); throw error; } return getAdditionalWork(actor, workId);
}

export async function createAdditionalWorkVersion(actor: AuthUser, workId: string) {
  const work = await internalWork(actor, workId, "additionalWorks.createVersion"); if (work.status === "APPROVED") throw new AdditionalWorkError("Согласованные условия нельзя переписывать. Создайте новую корректирующую дополнительную работу.", 409);
  if (!['REJECTED'].includes(work.status)) throw new AdditionalWorkError("Новую версию можно создать после отклонения предыдущей.", 409);
  const sourceId = work.current_version_id, nextId = id(), timestamp = now();
  await transaction([
    { text: "SELECT pg_advisory_xact_lock(hashtext($1))", params: [`additional-work:${workId}`] },
    { text: `INSERT INTO additional_work_versions(id,additional_work_id,project_id,version,title,amount_kopecks,schedule_delta_days,status,reason,client_description,internal_comment,schedule_impact_type,task_creation_mode,payment_due_date,created_by_user_id,created_at,updated_at)
      SELECT $1,v.additional_work_id,v.project_id,(SELECT MAX(version)+1 FROM additional_work_versions WHERE additional_work_id=v.additional_work_id),v.title,v.amount_kopecks,v.schedule_delta_days,'DRAFT',v.reason,v.client_description,v.internal_comment,v.schedule_impact_type,v.task_creation_mode,v.payment_due_date,$2,$3,$3 FROM additional_work_versions v WHERE v.id=$4`, params: [nextId, actor.id, timestamp, sourceId] },
    { text: `INSERT INTO additional_work_items(id,additional_work_version_id,position,name,description,quantity,unit,client_unit_price_kopecks,client_total_kopecks,internal_unit_cost_kopecks,created_at,updated_at)
      SELECT $1||':item:'||position,$1,position,name,description,quantity,unit,client_unit_price_kopecks,client_total_kopecks,internal_unit_cost_kopecks,$2,$2 FROM additional_work_items WHERE additional_work_version_id=$3`, params: [nextId, timestamp, sourceId] },
    { text: `INSERT INTO additional_work_proposed_tasks(id,additional_work_version_id,stage_id,position,title,description,progress_type,quantity,unit,typical_duration_days,client_visible,created_at,updated_at)
      SELECT $1||':task:'||position,$1,stage_id,position,title,description,progress_type,quantity,unit,typical_duration_days,client_visible,$2,$2 FROM additional_work_proposed_tasks WHERE additional_work_version_id=$3`, params: [nextId, timestamp, sourceId] },
    { text: "UPDATE additional_works SET current_version_id=$1,status='DRAFT',updated_at=$2 WHERE id=$3", params: [nextId, timestamp, workId] },
    { text: "INSERT INTO additional_work_events(id,additional_work_id,additional_work_version_id,type,employee_user_id,metadata_json,occurred_at) SELECT $1,$2,$3,'VERSION_CREATED',$4,jsonb_build_object('version',version),$5 FROM additional_work_versions WHERE id=$3", params: [id(), workId, nextId, actor.id, timestamp] },
    employeeAudit(actor, "ADDITIONAL_WORK_VERSION_CREATED", workId, { projectId: work.project_id, versionId: nextId, sourceVersionId: sourceId }, timestamp),
  ]);
  return getAdditionalWork(actor, workId);
}

export async function sendAdditionalWork(actor: AuthUser, workId: string) {
  const work = await internalWork(actor, workId, "additionalWorks.send"), portal = await first("SELECT id FROM client_portal_users WHERE client_id=$1 AND status='ACTIVE'", [work.client_id]);
  if (!portal) throw new AdditionalWorkError("У клиента нет активного доступа к личному кабинету.", 409, { code: "PORTAL_ACCESS_REQUIRED", clientId: work.client_id });
  const timestamp = now();
  try { await transaction([
    { text: "WITH locked AS (SELECT v.id FROM additional_work_versions v JOIN additional_works aw ON aw.id=v.additional_work_id WHERE aw.id=$1 AND v.id=aw.current_version_id AND v.status='DRAFT' AND length(v.client_description)>0 AND EXISTS(SELECT 1 FROM additional_work_items i WHERE i.additional_work_version_id=v.id) FOR UPDATE OF v,aw) SELECT 1/COUNT(*)::int guard FROM locked", params: [workId] },
    { text: "UPDATE additional_work_versions SET status='SENT',sent_at=$1,sent_by_user_id=$2,updated_at=$3 WHERE id=$4", params: [timestamp, actor.id, timestamp, work.current_version_id] },
    { text: "UPDATE additional_works SET status='AWAITING_CLIENT_APPROVAL',updated_at=$1 WHERE id=$2", params: [timestamp, workId] },
    { text: "INSERT INTO additional_work_events(id,additional_work_id,additional_work_version_id,type,employee_user_id,metadata_json,occurred_at) SELECT $1,$2,id,'SENT',$3,jsonb_build_object('version',version,'amountKopecks',amount_kopecks),$4 FROM additional_work_versions WHERE id=$5", params: [id(), workId, actor.id, timestamp, work.current_version_id] },
    employeeAudit(actor, "ADDITIONAL_WORK_SENT", workId, { projectId: work.project_id, versionId: work.current_version_id }, timestamp),
  ]); } catch (error) { if ((error as { code?: string }).code === "22012") throw new AdditionalWorkError("Версия уже отправлена или не готова к отправке.", 409); throw error; }
  return getAdditionalWork(actor, workId);
}

type ApprovalActor = { portal?: ClientPortalUser; employee?: AuthUser; reason?: string };

async function approve(work: WorkRow, approval: ApprovalActor) {
  const timestamp = now(), versionId = work.current_version_id, employeeId = approval.employee?.id ?? null, portalId = approval.portal?.id ?? null;
  const taskEventId = id(), obligationEventId = id(), approvalEventId = id(), auditId = id(), portalAuditId = id();
  const result = await query<{ approval_count: number; task_count: number; obligation_count: number }>(`WITH locked AS MATERIALIZED (
      SELECT aw.id work_id,aw.project_id,aw.client_id,aw.stage_id,v.id version_id,v.amount_kopecks,v.task_creation_mode,v.payment_due_date
      FROM additional_works aw JOIN additional_work_versions v ON v.id=aw.current_version_id
      WHERE aw.id=$1 AND aw.status='AWAITING_CLIENT_APPROVAL' AND v.id=$2 AND v.status='SENT' FOR UPDATE OF aw,v
    ), approved_version AS (UPDATE additional_work_versions v SET status='APPROVED',approved_at=$3,approved_by_client_portal_user_id=$4,approved_by_user_id=$5,manual_approval_reason=$6,updated_at=$3 FROM locked l WHERE v.id=l.version_id RETURNING v.*),
    approved_work AS (UPDATE additional_works aw SET status='APPROVED',approved_version_id=l.version_id,approved_by_client_portal_user_id=$4,updated_at=$3 FROM locked l WHERE aw.id=l.work_id AND EXISTS(SELECT 1 FROM approved_version) RETURNING aw.*),
    inserted_obligation AS (INSERT INTO obligations(id,direction,counterparty_type,counterparty_id,project_id,amount_kopecks,paid_kopecks,due_date,status,obligation_type,payment_plan_version,source_key,currency,additional_work_id,additional_work_version_id,created_at,updated_at)
      SELECT 'aw-obligation:'||l.version_id,'RECEIVABLE','CLIENT',l.client_id,l.project_id,l.amount_kopecks,0,l.payment_due_date,'OPEN','ADDITIONAL_WORK',1,'additional_work:'||l.work_id||':version:'||l.version_id,'RUB',l.work_id,l.version_id,$3,$3 FROM locked l WHERE l.amount_kopecks>0 AND EXISTS(SELECT 1 FROM approved_version)
      ON CONFLICT(source_key) WHERE source_key IS NOT NULL DO NOTHING RETURNING id),
    inserted_tasks AS (INSERT INTO tasks(id,title,description,created_by_user_id,project_id,status,created_at,updated_at,production_plan_id,stage_id,position,progress_type,unit,planned_quantity,completed_quantity,weight_within_stage,planned_duration_days,client_visible,additional_work_id,additional_work_version_id)
      SELECT 'aw-task:'||pt.id,pt.title,pt.description,COALESCE($5,(SELECT created_by_user_id FROM additional_works WHERE id=l.work_id)),l.project_id,'NOT_STARTED',$3,$3,pp.id,COALESCE(pt.stage_id,l.stage_id),
        COALESCE((SELECT MAX(t.position)+1 FROM tasks t WHERE t.stage_id=COALESCE(pt.stage_id,l.stage_id)),0)+(row_number() OVER(PARTITION BY COALESCE(pt.stage_id,l.stage_id) ORDER BY pt.position)-1)::int,
        pt.progress_type,pt.unit,pt.quantity,0,0,pt.typical_duration_days,pt.client_visible,l.work_id,l.version_id
      FROM locked l JOIN approved_version av ON true JOIN additional_work_proposed_tasks pt ON pt.additional_work_version_id=l.version_id JOIN production_plans pp ON pp.project_id=l.project_id AND pp.status='ACTIVE' JOIN project_stages ps ON ps.id=COALESCE(pt.stage_id,l.stage_id) AND ps.production_plan_id=pp.id AND ps.archived_at IS NULL
      WHERE l.task_creation_mode='AFTER_APPROVAL' ON CONFLICT(id) DO NOTHING RETURNING id,additional_work_id,additional_work_version_id),
    inserted_links AS (INSERT INTO additional_work_task_links(id,additional_work_id,additional_work_version_id,proposed_task_id,task_id,created_at)
      SELECT 'aw-link:'||pt.id,l.work_id,l.version_id,pt.id,'aw-task:'||pt.id,$3 FROM locked l JOIN additional_work_proposed_tasks pt ON pt.additional_work_version_id=l.version_id JOIN tasks t ON t.id='aw-task:'||pt.id WHERE EXISTS(SELECT 1 FROM approved_version)
      ON CONFLICT(proposed_task_id) DO NOTHING RETURNING id),
    approval_event AS (INSERT INTO additional_work_events(id,additional_work_id,additional_work_version_id,type,employee_user_id,client_portal_user_id,comment,metadata_json,occurred_at)
      SELECT $7,l.work_id,l.version_id,CASE WHEN $4::text IS NULL THEN 'APPROVED_MANUALLY' ELSE 'APPROVED' END,$5,$4,$6,jsonb_build_object('amountKopecks',l.amount_kopecks),$3 FROM locked l WHERE EXISTS(SELECT 1 FROM approved_version) RETURNING id),
    obligation_event AS (INSERT INTO additional_work_events(id,additional_work_id,additional_work_version_id,type,employee_user_id,client_portal_user_id,metadata_json,occurred_at)
      SELECT $8,l.work_id,l.version_id,'OBLIGATION_CREATED',$5,$4,jsonb_build_object('amountKopecks',l.amount_kopecks),$3 FROM locked l WHERE EXISTS(SELECT 1 FROM inserted_obligation) RETURNING id),
    task_event AS (INSERT INTO additional_work_events(id,additional_work_id,additional_work_version_id,type,employee_user_id,client_portal_user_id,metadata_json,occurred_at)
      SELECT $9,l.work_id,l.version_id,'PRODUCTION_TASKS_CREATED',$5,$4,jsonb_build_object('count',(SELECT COUNT(*) FROM inserted_tasks)),$3 FROM locked l WHERE EXISTS(SELECT 1 FROM inserted_tasks) RETURNING id),
    employee_audit AS (INSERT INTO audit_logs(id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json)
      SELECT $10,$5,'ADDITIONAL_WORK_APPROVED_MANUALLY','AdditionalWork',l.work_id,$3,jsonb_build_object('versionId',l.version_id,'reason',$6) FROM locked l WHERE $5::text IS NOT NULL AND EXISTS(SELECT 1 FROM approved_version) RETURNING id),
    portal_audit AS (INSERT INTO client_portal_audit_events(id,action,entity_type,entity_id,client_id,client_portal_user_id,metadata_json,occurred_at)
      SELECT $11,'ADDITIONAL_WORK_APPROVED_BY_CLIENT','AdditionalWork',l.work_id,l.client_id,$4,jsonb_build_object('versionId',l.version_id,'amountKopecks',l.amount_kopecks),$3 FROM locked l WHERE $4::text IS NOT NULL AND EXISTS(SELECT 1 FROM approved_version) RETURNING id)
    SELECT (SELECT COUNT(*)::int FROM approved_version) approval_count,(SELECT COUNT(*)::int FROM inserted_tasks) task_count,(SELECT COUNT(*)::int FROM inserted_obligation) obligation_count`, [work.id, versionId, timestamp, portalId, employeeId, approval.reason ?? null, approvalEventId, obligationEventId, taskEventId, auditId, portalAuditId]);
  if (Number(result[0]?.approval_count ?? 0) !== 1) throw new AdditionalWorkError("Предложение уже обработано другим запросом.", 409);
  return { taskCount: Number(result[0].task_count), obligationCount: Number(result[0].obligation_count) };
}

export async function approveAdditionalWorkByClient(user: ClientPortalUser, workId: string) {
  const work = await getWorkRow(workId); if (!work || work.client_id !== user.clientId) throw new AdditionalWorkError("Дополнительная работа недоступна.", 403); await approve(work, { portal: user }); return getClientAdditionalWork(user, workId);
}

export async function manuallyApproveAdditionalWork(actor: AuthUser, workId: string, reason: string) {
  const comment = clean(reason, 2_000); if (!comment) throw new AdditionalWorkError("Укажите основание ручного согласования."); const work = await internalWork(actor, workId, "additionalWorks.manualApprove"); await approve(work, { employee: actor, reason: comment }); return getAdditionalWork(actor, workId);
}

export async function rejectAdditionalWorkByClient(user: ClientPortalUser, workId: string, comment?: string) {
  const work = await getWorkRow(workId); if (!work || work.client_id !== user.clientId) throw new AdditionalWorkError("Дополнительная работа недоступна.", 403); const timestamp = now(), reason = clean(comment, 2_000) || null;
  try { await transaction([
    { text: "WITH locked AS (SELECT v.id FROM additional_work_versions v JOIN additional_works aw ON aw.id=v.additional_work_id WHERE aw.id=$1 AND aw.client_id=$2 AND aw.status='AWAITING_CLIENT_APPROVAL' AND v.id=aw.current_version_id AND v.status='SENT' FOR UPDATE OF v,aw) SELECT 1/COUNT(*)::int guard FROM locked", params: [workId, user.clientId] },
    { text: "UPDATE additional_work_versions SET status='REJECTED',rejected_at=$1,client_decision_comment=$2,updated_at=$1 WHERE id=$3", params: [timestamp, reason, work.current_version_id] },
    { text: "UPDATE additional_works SET status='REJECTED',updated_at=$1 WHERE id=$2", params: [timestamp, workId] },
    { text: "INSERT INTO additional_work_events(id,additional_work_id,additional_work_version_id,type,client_portal_user_id,comment,occurred_at) VALUES($1,$2,$3,'REJECTED',$4,$5,$6)", params: [id(), workId, work.current_version_id, user.id, reason, timestamp] },
    { text: "INSERT INTO client_portal_audit_events(id,action,entity_type,entity_id,client_id,client_portal_user_id,metadata_json,occurred_at) VALUES($1,'ADDITIONAL_WORK_REJECTED_BY_CLIENT','AdditionalWork',$2,$3,$4,$5::jsonb,$6)", params: [id(), workId, user.clientId, user.id, JSON.stringify({ versionId: work.current_version_id }), timestamp] },
  ]); } catch (error) { if ((error as { code?: string }).code === "22012") throw new AdditionalWorkError("Предложение уже обработано другим запросом.", 409); throw error; }
  return getClientAdditionalWork(user, workId);
}

export async function withdrawAdditionalWork(actor: AuthUser, workId: string, comment?: string) {
  const work = await internalWork(actor, workId, "additionalWorks.withdraw"), timestamp = now(), reason = clean(comment, 2_000) || null;
  try { await transaction([
    { text: "WITH locked AS (SELECT v.id FROM additional_work_versions v JOIN additional_works aw ON aw.id=v.additional_work_id WHERE aw.id=$1 AND aw.status='AWAITING_CLIENT_APPROVAL' AND v.id=aw.current_version_id AND v.status='SENT' FOR UPDATE OF v,aw) SELECT 1/COUNT(*)::int guard FROM locked", params: [workId] },
    { text: "UPDATE additional_work_versions SET status='SUPERSEDED',client_decision_comment=$1,updated_at=$2 WHERE id=$3", params: [reason, timestamp, work.current_version_id] },
    { text: "UPDATE additional_works SET status='CANCELLED',cancelled_at=$1,cancellation_reason=$2,updated_at=$1 WHERE id=$3", params: [timestamp, reason, workId] },
    { text: "INSERT INTO additional_work_events(id,additional_work_id,additional_work_version_id,type,employee_user_id,comment,occurred_at) VALUES($1,$2,$3,'WITHDRAWN',$4,$5,$6)", params: [id(), workId, work.current_version_id, actor.id, reason, timestamp] },
    employeeAudit(actor, "ADDITIONAL_WORK_WITHDRAWN", workId, { projectId: work.project_id, versionId: work.current_version_id }, timestamp),
  ]); } catch (error) { if ((error as { code?: string }).code === "22012") throw new AdditionalWorkError("Предложение уже обработано другим запросом.", 409); throw error; }
  return getAdditionalWork(actor, workId);
}

export async function cancelAdditionalWorkDraft(actor: AuthUser, workId: string, comment: string) {
  const work = await internalWork(actor, workId, "additionalWorks.editDraft"), reason = clean(comment, 2_000); if (!reason) throw new AdditionalWorkError("Укажите причину отмены."); if (work.status !== "DRAFT") throw new AdditionalWorkError("Отменить обычным способом можно только черновик.", 409); const timestamp = now();
  await transaction([{ text: "UPDATE additional_works SET status='CANCELLED',cancelled_at=$1,cancellation_reason=$2,updated_at=$1 WHERE id=$3 AND status='DRAFT'", params: [timestamp, reason, workId] }, { text: "INSERT INTO additional_work_events(id,additional_work_id,additional_work_version_id,type,employee_user_id,comment,occurred_at) VALUES($1,$2,$3,'CANCELLED',$4,$5,$6)", params: [id(), workId, work.current_version_id, actor.id, reason, timestamp] }, employeeAudit(actor, "ADDITIONAL_WORK_CANCELLED", workId, { projectId: work.project_id }, timestamp)]); return getAdditionalWork(actor, workId);
}

function clientReason(reason: string) { return ({ CLIENT_REQUEST: "По вашему запросу", HIDDEN_CONDITION: "Выявлено в ходе работ", DESIGN_CHANGE: "Изменение дизайн-проекта", SCOPE_CHANGE: "Изменение объёма работ", ERROR_CORRECTION: "Исправление / корректировка", OTHER: "Дополнительное изменение" } as Record<string, string>)[reason] ?? "Дополнительное изменение"; }

function clientImpact(type: string, days: number) { return type === "ADD_DAYS" ? `+${days} дн.` : type === "RECALCULATE" ? "После согласования график будет пересчитан" : "Срок сдачи не изменится"; }

export async function listClientAdditionalWorks(user: ClientPortalUser, projectId: string) {
  if (!(await first("SELECT id FROM projects WHERE id=$1 AND client_id=$2", [projectId, user.clientId]))) throw new AdditionalWorkError("Объект недоступен.", 403);
  const rows = await query<Record<string, unknown>>(`SELECT aw.id,aw.number,aw.title,aw.status,aw.current_version_id,aw.approved_version_id,v.version,v.amount_kopecks,v.schedule_impact_type,v.schedule_delta_days,v.sent_at,v.approved_at,v.rejected_at,v.approved_by_client_portal_user_id,v.approved_by_user_id
    FROM additional_works aw JOIN additional_work_versions v ON v.id=CASE WHEN aw.status='APPROVED' THEN aw.approved_version_id ELSE aw.current_version_id END
    WHERE aw.project_id=$1 AND aw.client_id=$2 AND aw.status IN ('AWAITING_CLIENT_APPROVAL','APPROVED','REJECTED','CANCELLED') ORDER BY aw.created_at DESC`, [projectId, user.clientId]);
  return rows.map((row) => ({ ...row, scheduleImpactLabel: clientImpact(String(row.schedule_impact_type), Number(row.schedule_delta_days)) }));
}

export async function getClientAdditionalWork(user: ClientPortalUser, workId: string) {
  const work = await getWorkRow(workId); if (!work || work.client_id !== user.clientId || !["AWAITING_CLIENT_APPROVAL", "APPROVED", "REJECTED", "CANCELLED"].includes(work.status)) throw new AdditionalWorkError("Дополнительная работа недоступна.", 403);
  const selectedId = work.status === "APPROVED" ? work.approved_version_id! : work.current_version_id, version = await first<VersionRow>("SELECT * FROM additional_work_versions WHERE id=$1 AND additional_work_id=$2", [selectedId, workId]); if (!version) throw new AdditionalWorkError("Версия недоступна.", 404);
  const [items, attachments, history, payment, tasks] = await Promise.all([
    query<Record<string, unknown>>("SELECT id,position,name,description,quantity,unit,client_unit_price_kopecks,client_total_kopecks FROM additional_work_items WHERE additional_work_version_id=$1 ORDER BY position", [version.id]),
    query<Record<string, unknown>>("SELECT id,original_filename,mime_type,size_bytes,created_at FROM attachments WHERE additional_work_version_id=$1 AND visibility='CLIENT' AND upload_status='LINKED' AND deleted_at IS NULL ORDER BY created_at", [version.id]),
    query<Record<string, unknown>>(`SELECT v.id,v.version,v.status,v.amount_kopecks,v.sent_at,v.approved_at,v.rejected_at,v.client_decision_comment,CASE WHEN v.approved_by_client_portal_user_id IS NULL AND v.approved_by_user_id IS NOT NULL THEN 'DEPA' ELSE 'CLIENT' END approval_source
      FROM additional_work_versions v WHERE v.additional_work_id=$1 AND v.status<>'DRAFT' ORDER BY v.version DESC`, [workId]),
    first<Record<string, unknown>>(`SELECT o.amount_kopecks,o.paid_kopecks,o.status,o.due_date FROM obligations o WHERE o.additional_work_version_id=$1`, [version.id]),
    query<Record<string, unknown>>("SELECT t.id,t.title,t.status FROM additional_work_task_links l JOIN tasks t ON t.id=l.task_id WHERE l.additional_work_version_id=$1 AND t.client_visible=1 ORDER BY t.position", [version.id]),
  ]);
  const taskStatuses = tasks.map((task) => String(task.status)), productionState = !tasks.length ? null : taskStatuses.every((status) => status === "COMPLETED") ? "COMPLETED" : taskStatuses.some((status) => status === "IN_PROGRESS" || status === "COMPLETED") ? "IN_PROGRESS" : "NOT_STARTED";
  return { id: work.id, projectId: work.project_id, number: work.number, title: work.title, status: work.status, version: version.version, reason: clientReason(version.reason), clientDescription: version.client_description, amountKopecks: Number(version.amount_kopecks), scheduleImpactType: version.schedule_impact_type, scheduleImpactDays: version.schedule_delta_days, scheduleImpactLabel: clientImpact(version.schedule_impact_type, version.schedule_delta_days), items, attachments, history, payment: payment ? { amountKopecks: Number(payment.amount_kopecks), paidKopecks: Number(payment.paid_kopecks), remainingKopecks: Number(payment.amount_kopecks) - Number(payment.paid_kopecks), status: payment.status, dueDate: payment.due_date } : null, productionState };
}

export async function previewAdditionalWorkSchedule(actor: AuthUser, workId: string) {
  const work = await internalWork(actor, workId, "additionalWorks.applyScheduleImpact"); if (work.status !== "APPROVED" || !work.approved_version_id) throw new AdditionalWorkError("Сначала согласуйте дополнительную работу.", 409);
  const version = await first<VersionRow>("SELECT * FROM additional_work_versions WHERE id=$1", [work.approved_version_id]); if (!version || version.schedule_impact_type === "NO_IMPACT") throw new AdditionalWorkError("Для этой работы изменение графика не требуется.", 409); if (version.schedule_applied_at) throw new AdditionalWorkError("Изменение графика уже применено.", 409);
  const plan = await first<{ id: string }>("SELECT id FROM production_plans WHERE project_id=$1 AND status='ACTIVE'", [work.project_id]); if (!plan) return { canApply: false, message: "Производственный план объекта пока не создан.", addedTaskCount: 0, affectedTaskCount: 0, previousForecastEndDate: null, newForecastEndDate: null };
  const stats = await first<{ added: number; affected: number; forecast: number | null; duration: number }>(`SELECT COUNT(*) FILTER(WHERE additional_work_version_id=$2)::int added,COUNT(*) FILTER(WHERE additional_work_version_id IS DISTINCT FROM $2 AND planned_end_date IS NOT NULL)::int affected,MAX(planned_end_date) forecast,COALESCE(SUM(planned_duration_days) FILTER(WHERE additional_work_version_id=$2),0)::int duration FROM tasks WHERE production_plan_id=$1 AND archived_at IS NULL`, [plan.id, version.id]);
  const deltaDays = version.schedule_impact_type === "ADD_DAYS" ? version.schedule_delta_days : Math.max(1, Number(stats?.duration ?? 0)), previous = Number(stats?.forecast ?? 0) || null;
  return { canApply: true, addedTaskCount: Number(stats?.added ?? 0), affectedTaskCount: Number(stats?.affected ?? 0), deltaDays, previousForecastEndDate: previous, newForecastEndDate: previous ? previous + deltaDays * DAY : null, publishedForecastUnchanged: true };
}

export async function applyAdditionalWorkSchedule(actor: AuthUser, workId: string) {
  const preview = await previewAdditionalWorkSchedule(actor, workId); if (!preview.canApply) throw new AdditionalWorkError(String(preview.message), 409); const work = (await getWorkRow(workId))!, versionId = work.approved_version_id!, timestamp = now(), shift = Number(preview.deltaDays) * DAY;
  try { await transaction([
    { text: "WITH locked AS (SELECT id FROM additional_work_versions WHERE id=$1 AND status='APPROVED' AND schedule_applied_at IS NULL FOR UPDATE) SELECT 1/COUNT(*)::int guard FROM locked", params: [versionId] },
    { text: "UPDATE tasks SET planned_start_date=CASE WHEN planned_start_date IS NULL THEN NULL ELSE planned_start_date+$1 END,planned_end_date=CASE WHEN planned_end_date IS NULL THEN NULL ELSE planned_end_date+$1 END,updated_at=$2 WHERE project_id=$3 AND production_plan_id IS NOT NULL AND additional_work_version_id IS DISTINCT FROM $4 AND archived_at IS NULL", params: [shift, timestamp, work.project_id, versionId] },
    { text: "UPDATE projects SET internal_forecast_end_date=COALESCE(internal_forecast_end_date,forecast_end_date,planned_end_date)+$1,updated_at=$2 WHERE id=$3", params: [shift, timestamp, work.project_id] },
    { text: "UPDATE additional_work_versions SET schedule_applied_at=$1,schedule_applied_by_user_id=$2,updated_at=$1 WHERE id=$3", params: [timestamp, actor.id, versionId] },
    { text: "INSERT INTO project_schedule_events(id,project_id,actor_user_id,type,previous_forecast_end_date,new_forecast_end_date,reason,metadata_json,occurred_at) VALUES($1,$2,$3,'ADDITIONAL_WORK_SCHEDULE_APPLIED',$4,$5,$6,$7::jsonb,$8)", params: [id(), work.project_id, actor.id, preview.previousForecastEndDate, preview.newForecastEndDate, `Дополнительная работа ${work.number}`, JSON.stringify({ additionalWorkId: workId, versionId, deltaDays: preview.deltaDays, publishedForecastUnchanged: true }), timestamp] },
    { text: "INSERT INTO additional_work_events(id,additional_work_id,additional_work_version_id,type,employee_user_id,metadata_json,occurred_at) VALUES($1,$2,$3,'SCHEDULE_APPLIED',$4,$5::jsonb,$6)", params: [id(), workId, versionId, actor.id, JSON.stringify(preview), timestamp] },
    employeeAudit(actor, "ADDITIONAL_WORK_SCHEDULE_APPLIED", workId, { projectId: work.project_id, versionId, deltaDays: preview.deltaDays }, timestamp),
  ]); } catch (error) { if ((error as { code?: string }).code === "22012") throw new AdditionalWorkError("Изменение графика уже применено.", 409); throw error; }
  return { ok: true, publishedForecastUnchanged: true, ...preview };
}

export async function additionalWorkCommercialSummary(projectId: string) {
  const row = await first<{ contract: number | string; additional: number | string }>(`SELECT p.contract_amount_kopecks contract,COALESCE(SUM(v.amount_kopecks) FILTER(WHERE aw.status='APPROVED' AND v.id=aw.approved_version_id),0) additional FROM projects p LEFT JOIN additional_works aw ON aw.project_id=p.id LEFT JOIN additional_work_versions v ON v.id=aw.approved_version_id WHERE p.id=$1 GROUP BY p.id`, [projectId]);
  const contract = Number(row?.contract ?? 0), additional = Number(row?.additional ?? 0); return { contractWorksKopecks: contract, approvedAdditionalWorksKopecks: additional, currentCommercialWorksKopecks: contract + additional };
}
