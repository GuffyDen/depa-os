import type { AuthUser } from "./auth";
import { first, query, transaction } from "./postgres";
import { AccessError, assertModuleAction, getAccessProfile } from "./permissions";
import { resolveResidentialComplexLocation } from "./residential-complexes";

export type EstimateInput = Record<string, unknown>;
export type EstimateVersionStatus = "DRAFT" | "SENT" | "APPROVED" | "REJECTED" | "SUPERSEDED";

export class EstimateError extends Error {
  constructor(message: string, public status = 400, public details?: Record<string, unknown>) { super(message); }
}

type EstimateRow = {
  id: string; client_id: string; client_name: string; client_phone: string; responsible_user_id: string; responsible_name: string;
  residential_complex_id: string | null; residential_complex_address_id: string | null; residential_complex: string | null; address: string; apartment_number: string | null;
  area_sqm: string | number | null; source_lead_id: string | null; source_order_id: string | null; project_id: string | null;
  status: "ACTIVE" | "CLOSED"; current_version_id: string; approved_version_id: string | null; created_by_user_id: string;
  archived_at: number | null; created_at: number; updated_at: number; current_version: number; current_status: EstimateVersionStatus;
  total_kopecks: string | number; estimated_materials_budget_kopecks: string | number | null;
};

type VersionRow = {
  id: string; estimate_id: string; project_id: string | null; version: number; total_kopecks: string | number; change_reason: string | null;
  status: EstimateVersionStatus; estimated_materials_budget_kopecks: string | number | null; planned_duration: string | null;
  client_comment: string | null; internal_comment: string | null; sent_at: number | null; sent_by_user_id: string | null;
  sent_by_name: string | null; approved_at: number | null; approved_by_user_id: string | null; approved_by_name: string | null;
  approval_comment: string | null; rejected_at: number | null; rejected_by_user_id: string | null; rejected_by_name: string | null;
  rejection_reason: string | null; created_by_user_id: string; created_by_name: string; created_at: number; updated_at: number;
};

type SectionInput = { id?: unknown; name?: unknown; items?: unknown };
type ItemInput = { id?: unknown; name?: unknown; unit?: unknown; quantity?: unknown; clientPriceKopecks?: unknown; internalCostKopecks?: unknown };
type ItemRow = { id: string; section_id: string; name: string; unit: string; quantity: string | number; client_price_kopecks: number | string; internal_cost_kopecks: number | string | null; position: number };

const now = () => Math.floor(Date.now() / 1000);
const clean = (value: unknown, max = 1000) => typeof value === "string" ? value.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max) || null : null;
const idValue = (value: unknown) => clean(value, 120);

function kopecks(value: unknown, nullable = false) {
  if (value === null || value === undefined || value === "") return nullable ? null : 0;
  const numeric = typeof value === "number" ? value : Number(String(value).replaceAll(" ", ""));
  if (!Number.isSafeInteger(numeric) || numeric < 0) throw new EstimateError("Проверьте денежные значения сметы.");
  return numeric;
}

function quantityHundredths(value: unknown) {
  const text = String(value ?? "").trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new EstimateError("Количество должно быть положительным числом с точностью до двух знаков.");
  const [whole, fraction = ""] = text.split(".");
  const scaled = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(scaled) || scaled <= 0) throw new EstimateError("Количество должно быть больше нуля.");
  return { scaled, database: `${whole}.${fraction.padEnd(2, "0")}` };
}

function itemTotal(quantityScaled: number, priceKopecks: number) {
  const product = quantityScaled * priceKopecks;
  if (!Number.isSafeInteger(product)) throw new EstimateError("Сумма позиции слишком велика.");
  return Math.round(product / 100);
}

function audit(actorId: string, action: string, entityType: string, entityId: string, timestamp: number, metadata: Record<string, unknown> = {}) {
  return { text: "INSERT INTO audit_logs(id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES($1,$2,$3,$4,$5,$6,$7)", params: [crypto.randomUUID(), actorId, action, entityType, entityId, timestamp, JSON.stringify(metadata)] };
}

function event(actorId: string, estimateId: string, versionId: string | null, type: string, timestamp: number, metadata: Record<string, unknown> = {}) {
  return { text: "INSERT INTO estimate_events(id,estimate_id,version_id,actor_user_id,type,occurred_at,metadata_json) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)", params: [crypto.randomUUID(), estimateId, versionId, actorId, type, timestamp, JSON.stringify(metadata)] };
}

function baseSelect() {
  return `SELECT e.id,e.client_id,c.name client_name,c.phone client_phone,e.responsible_user_id,u.display_name responsible_name,
    e.residential_complex_id,e.residential_complex_address_id,rc.name residential_complex,e.address,e.apartment_number,e.area_sqm,e.source_lead_id,e.source_order_id,e.project_id,
    e.status,e.current_version_id,e.approved_version_id,e.created_by_user_id,e.archived_at,e.created_at,e.updated_at,
    v.version current_version,v.status current_status,v.total_kopecks,v.estimated_materials_budget_kopecks
    FROM estimates e JOIN clients c ON c.id=e.client_id JOIN users u ON u.id=e.responsible_user_id
    LEFT JOIN residential_complexes rc ON rc.id=e.residential_complex_id JOIN estimate_versions v ON v.id=e.current_version_id`;
}

function serializeSummary(row: EstimateRow) {
  return { id: row.id, clientId: row.client_id, clientName: row.client_name, clientPhone: row.client_phone, responsibleUserId: row.responsible_user_id,
    responsibleName: row.responsible_name, residentialComplexId: row.residential_complex_id, residentialComplexAddressId: row.residential_complex_address_id, residentialComplex: row.residential_complex,
    address: row.address, apartmentNumber: row.apartment_number, areaSqm: row.area_sqm == null ? null : Number(row.area_sqm),
    sourceLeadId: row.source_lead_id, sourceOrderId: row.source_order_id, projectId: row.project_id, status: row.status,
    currentVersionId: row.current_version_id, currentVersion: Number(row.current_version), currentStatus: row.current_status,
    approvedVersionId: row.approved_version_id, worksTotalKopecks: Number(row.total_kopecks),
    estimatedMaterialsBudgetKopecks: row.estimated_materials_budget_kopecks == null ? null : Number(row.estimated_materials_budget_kopecks),
    archivedAt: row.archived_at, createdAt: row.created_at, updatedAt: row.updated_at };
}

async function assertEstimateAccess(actor: AuthUser, action: "estimates.view" | "estimates.create" | "estimates.edit" | "estimates.createVersion" | "estimates.sendProposal" | "estimates.approve" | "estimates.reject") {
  await assertModuleAction(actor, "orders", action);
}

async function visibleEstimate(actor: AuthUser, estimateId: string) {
  await assertEstimateAccess(actor, "estimates.view");
  const access = await getAccessProfile(actor);
  const scoped = actor.role !== "OWNER" && access.scopes.estimates !== "ALL";
  const row = await first<EstimateRow>(`${baseSelect()} WHERE e.id=$1${scoped ? " AND e.responsible_user_id=$2" : ""} LIMIT 1`, scoped ? [estimateId, actor.id] : [estimateId]);
  if (!row) {
    const exists = await first<{ id: string }>("SELECT id FROM estimates WHERE id=$1 LIMIT 1", [estimateId]);
    throw new AccessError(exists ? "Нет доступа к этой смете." : "Смета не найдена.", exists ? 403 : 404);
  }
  return row;
}

async function costCapabilities(actor: AuthUser) {
  const access = await getAccessProfile(actor);
  const viewCost = actor.role === "OWNER" || access.actions["estimates.viewCost"];
  return { viewCost, viewMargin: actor.role === "OWNER" || (viewCost && access.actions["estimates.viewMargin"]) };
}

export async function listEstimates(actor: AuthUser, requestUrl: string) {
  await assertEstimateAccess(actor, "estimates.view");
  const access = await getAccessProfile(actor), url = new URL(requestUrl);
  const search = (url.searchParams.get("search") ?? "").trim().slice(0, 150), status = url.searchParams.get("status") ?? "ALL";
  const responsible = url.searchParams.get("responsibleUserId") ?? "ALL", period = url.searchParams.get("period") ?? "ALL", clientId = idValue(url.searchParams.get("clientId")), sourceLeadId = idValue(url.searchParams.get("sourceLeadId"));
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 30, 1), 100), offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);
  const params: unknown[] = [], conditions = ["1=1"], add = (value: unknown) => { params.push(value); return `$${params.length}`; };
  if (actor.role !== "OWNER" && access.scopes.estimates !== "ALL") conditions.push(`e.responsible_user_id=${add(actor.id)}`);
  if (search) { const like = add(`%${search}%`), digits = add(`%${search.replace(/\D/g, "")}%`); conditions.push(`(c.name ILIKE ${like} OR regexp_replace(c.phone,'[^0-9]+','','g') LIKE ${digits} OR rc.name ILIKE ${like} OR e.address ILIKE ${like} OR e.apartment_number ILIKE ${like})`); }
  if (["DRAFT", "SENT", "APPROVED", "REJECTED", "SUPERSEDED"].includes(status)) conditions.push(`v.status=${add(status)}`);
  if (responsible !== "ALL") conditions.push(`e.responsible_user_id=${add(responsible)}`);
  if (clientId) conditions.push(`e.client_id=${add(clientId)}`);
  if (sourceLeadId) conditions.push(`e.source_lead_id=${add(sourceLeadId)}`);
  if (period === "30D") conditions.push(`e.created_at>=${add(now() - 30 * 86400)}`); else if (period === "90D") conditions.push(`e.created_at>=${add(now() - 90 * 86400)}`);
  const where = ` WHERE ${conditions.join(" AND ")}`;
  const count = await first<{ count: string | number }>(`SELECT COUNT(*) count FROM estimates e JOIN clients c ON c.id=e.client_id LEFT JOIN residential_complexes rc ON rc.id=e.residential_complex_id JOIN estimate_versions v ON v.id=e.current_version_id${where}`, params);
  const rows = await query<EstimateRow>(`${baseSelect()}${where} ORDER BY e.created_at DESC,e.id DESC LIMIT ${add(limit + 1)} OFFSET ${add(offset)}`, params);
  const [users, clients] = await Promise.all([
    query<{ id: string; name: string }>("SELECT id,display_name name FROM users WHERE status='ACTIVE' AND role IN ('OWNER','EMPLOYEE') ORDER BY CASE role WHEN 'OWNER' THEN 0 ELSE 1 END,display_name"),
    query<{ id: string; name: string; phone: string; responsibleUserId: string; residentialComplexId: string | null; residentialComplexAddressId: string | null; residentialComplex: string | null; address: string | null; apartmentNumber: string | null; areaSqm: string | number | null }>(`SELECT c.id,c.name,c.phone,c.responsible_user_id "responsibleUserId",p.residential_complex_id "residentialComplexId",p.residential_complex_address_id "residentialComplexAddressId",rc.name "residentialComplex",p.address,p.apartment "apartmentNumber",p.area_sqm "areaSqm" FROM clients c LEFT JOIN LATERAL (SELECT * FROM projects p2 WHERE p2.client_id=c.id ORDER BY p2.created_at DESC LIMIT 1) p ON true LEFT JOIN residential_complexes rc ON rc.id=p.residential_complex_id WHERE c.status='ACTIVE'${actor.role !== "OWNER" && access.scopes.clients !== "ALL" ? " AND c.responsible_user_id=$1" : ""} ORDER BY c.name LIMIT 300`, actor.role !== "OWNER" && access.scopes.clients !== "ALL" ? [actor.id] : []),
  ]);
  return { items: rows.slice(0, limit).map(serializeSummary), total: Number(count?.count ?? 0), hasMore: rows.length > limit, nextOffset: rows.length > limit ? offset + limit : null,
    users, clients: clients.map((item) => ({ ...item, areaSqm: item.areaSqm == null ? null : Number(item.areaSqm) })), capabilities: { create: actor.role === "OWNER" || access.actions["estimates.create"] } };
}

async function assertRelations(actor: AuthUser, clientId: string, responsibleUserId: string, sourceLeadId: string | null, sourceOrderId: string | null, projectId: string | null) {
  const access = await getAccessProfile(actor);
  const [client, responsible, lead, order, project] = await Promise.all([
    first<{ id: string; responsible_user_id: string }>("SELECT id,responsible_user_id FROM clients WHERE id=$1 AND status='ACTIVE' LIMIT 1", [clientId]),
    first<{ id: string }>("SELECT id FROM users WHERE id=$1 AND status='ACTIVE' AND role IN ('OWNER','EMPLOYEE') LIMIT 1", [responsibleUserId]),
    sourceLeadId ? first<{ linked_client_id: string | null; responsible_user_id: string }>("SELECT linked_client_id,responsible_user_id FROM leads WHERE id=$1 LIMIT 1", [sourceLeadId]) : Promise.resolve(null),
    sourceOrderId ? first<{ client_id: string; responsible_user_id: string }>("SELECT client_id,responsible_user_id FROM orders WHERE id=$1 LIMIT 1", [sourceOrderId]) : Promise.resolve(null),
    projectId ? first<{ client_id: string; responsible_user_id: string }>("SELECT client_id,responsible_user_id FROM projects WHERE id=$1 LIMIT 1", [projectId]) : Promise.resolve(null),
  ]);
  if (!client || !responsible) throw new EstimateError("Выбранный клиент или ответственный недоступен.");
  if (actor.role !== "OWNER" && access.scopes.clients !== "ALL" && client.responsible_user_id !== actor.id) throw new AccessError("Нет доступа к выбранному клиенту.", 403);
  if (actor.role !== "OWNER" && access.scopes.estimates !== "ALL" && responsibleUserId !== actor.id) throw new AccessError("В области «Назначенные» ответственным можно выбрать только себя.", 403);
  if (sourceLeadId && !lead) throw new EstimateError("Исходная CRM-заявка не найдена.", 404);
  if (sourceOrderId && !order) throw new EstimateError("Исходный заказ не найден.", 404);
  if (projectId && !project) throw new EstimateError("Исходный объект не найден.", 404);
  if (lead && actor.role !== "OWNER" && access.scopes.crm !== "ALL" && lead.responsible_user_id !== actor.id) throw new AccessError("Нет доступа к исходной CRM-заявке.", 403);
  if (order && actor.role !== "OWNER" && access.scopes.orders !== "ALL" && order.responsible_user_id !== actor.id) throw new AccessError("Нет доступа к исходному заказу.", 403);
  if (project && actor.role !== "OWNER" && access.scopes.projects !== "ALL" && project.responsible_user_id !== actor.id) throw new AccessError("Нет доступа к исходному объекту.", 403);
  if (lead && lead.linked_client_id !== clientId) throw new EstimateError("Заявка не связана с выбранным клиентом.", 409);
  if (order && order.client_id !== clientId) throw new EstimateError("Заказ относится к другому клиенту.", 409);
  if (project && project.client_id !== clientId) throw new EstimateError("Объект относится к другому клиенту.", 409);
}

export async function createEstimate(actor: AuthUser, input: EstimateInput) {
  await assertEstimateAccess(actor, "estimates.create");
  const clientId = idValue(input.clientId), responsibleUserId = idValue(input.responsibleUserId) ?? actor.id;
  const sourceLeadId = idValue(input.sourceLeadId), sourceOrderId = idValue(input.sourceOrderId), projectId = idValue(input.projectId);
  const apartmentNumber = clean(input.apartmentNumber, 80);
  if (!clientId) throw new EstimateError("Выберите клиента и укажите адрес.");
  const areaText = clean(input.areaSqm, 30), areaSqm = areaText ? Number(areaText.replace(",", ".")) : null;
  if (areaSqm !== null && (!Number.isFinite(areaSqm) || areaSqm <= 0)) throw new EstimateError("Проверьте площадь.");
  await assertRelations(actor, clientId, responsibleUserId, sourceLeadId, sourceOrderId, projectId);
  const location = await resolveResidentialComplexLocation(input.residentialComplexId, input.residentialComplexAddressId, input.address);
  const estimateId = crypto.randomUUID(), versionId = crypto.randomUUID(), timestamp = now(), costAccess = await costCapabilities(actor);
  const material = kopecks(input.estimatedMaterialsBudgetKopecks, true);
  await transaction([
    { text: "INSERT INTO estimates(id,client_id,responsible_user_id,residential_complex_id,residential_complex_address_id,address,apartment_number,area_sqm,source_lead_id,source_order_id,project_id,status,created_by_user_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'ACTIVE',$12,$13,$14)", params: [estimateId, clientId, responsibleUserId, location.residentialComplex?.id ?? null, location.address?.id ?? null, location.addressText, apartmentNumber, areaSqm, sourceLeadId, sourceOrderId, projectId, actor.id, timestamp, timestamp] },
    { text: "INSERT INTO estimate_versions(id,estimate_id,project_id,version,total_kopecks,status,estimated_materials_budget_kopecks,planned_duration,client_comment,internal_comment,created_by_user_id,created_at,updated_at) VALUES($1,$2,$3,1,0,'DRAFT',$4,$5,$6,$7,$8,$9,$10)", params: [versionId, estimateId, projectId, material, clean(input.plannedDuration, 300), clean(input.clientComment, 4000), costAccess.viewCost ? clean(input.internalComment, 4000) : null, actor.id, timestamp, timestamp] },
    { text: "UPDATE estimates SET current_version_id=$1 WHERE id=$2", params: [versionId, estimateId] },
    audit(actor.id, "ESTIMATE_CREATED", "Estimate", estimateId, timestamp, { clientId, versionId, version: 1, sourceLeadId, sourceOrderId, projectId }),
    audit(actor.id, "ESTIMATE_VERSION_CREATED", "EstimateVersion", versionId, timestamp, { estimateId, version: 1 }),
    event(actor.id, estimateId, versionId, "ESTIMATE_CREATED", timestamp, { version: 1 }),
  ]);
  return getEstimate(actor, estimateId);
}

async function versionsFor(estimateId: string) {
  return query<VersionRow>(`SELECT v.*,cu.display_name created_by_name,su.display_name sent_by_name,au.display_name approved_by_name,ru.display_name rejected_by_name
    FROM estimate_versions v JOIN users cu ON cu.id=v.created_by_user_id LEFT JOIN users su ON su.id=v.sent_by_user_id
    LEFT JOIN users au ON au.id=v.approved_by_user_id LEFT JOIN users ru ON ru.id=v.rejected_by_user_id
    WHERE v.estimate_id=$1 ORDER BY v.version DESC`, [estimateId]);
}

function serializeVersion(row: VersionRow) {
  return { id: row.id, version: Number(row.version), status: row.status, worksTotalKopecks: Number(row.total_kopecks), changeReason: row.change_reason,
    estimatedMaterialsBudgetKopecks: row.estimated_materials_budget_kopecks == null ? null : Number(row.estimated_materials_budget_kopecks), plannedDuration: row.planned_duration,
    clientComment: row.client_comment, sentAt: row.sent_at, sentByUserId: row.sent_by_user_id, sentByName: row.sent_by_name,
    approvedAt: row.approved_at, approvedByUserId: row.approved_by_user_id, approvedByName: row.approved_by_name, approvalComment: row.approval_comment,
    rejectedAt: row.rejected_at, rejectedByUserId: row.rejected_by_user_id, rejectedByName: row.rejected_by_name, rejectionReason: row.rejection_reason,
    createdByUserId: row.created_by_user_id, createdByName: row.created_by_name, createdAt: row.created_at, updatedAt: row.updated_at };
}

async function loadSections(versionId: string, canCost: boolean, canMargin: boolean) {
  const [sections, items] = await Promise.all([
    query<{ id: string; name: string; position: number }>("SELECT id,name,position FROM estimate_sections WHERE version_id=$1 ORDER BY position,id", [versionId]),
    query<ItemRow>("SELECT i.id,i.section_id,i.name,i.unit,i.quantity,i.client_price_kopecks,i.internal_cost_kopecks,i.position FROM estimate_items i JOIN estimate_sections s ON s.id=i.section_id WHERE s.version_id=$1 ORDER BY s.position,i.position,i.id", [versionId]),
  ]);
  return sections.map((section) => {
    const sectionItems = items.filter((item) => item.section_id === section.id).map((item) => {
      const qtyScaled = quantityHundredths(item.quantity).scaled, price = Number(item.client_price_kopecks), total = itemTotal(qtyScaled, price);
      return { id: item.id, name: item.name, unit: item.unit, quantity: Number(item.quantity), clientPriceKopecks: price, totalKopecks: total,
        ...(canCost ? { internalCostKopecks: item.internal_cost_kopecks == null ? null : Number(item.internal_cost_kopecks), internalTotalKopecks: item.internal_cost_kopecks == null ? null : itemTotal(qtyScaled, Number(item.internal_cost_kopecks)) } : {}),
        ...(canMargin && item.internal_cost_kopecks != null ? { marginKopecks: total - itemTotal(qtyScaled, Number(item.internal_cost_kopecks)) } : {}) };
    });
    return { id: section.id, name: section.name, position: section.position, totalKopecks: sectionItems.reduce((sum, item) => sum + item.totalKopecks, 0), items: sectionItems };
  });
}

export async function getEstimate(actor: AuthUser, estimateId: string, requestedVersionId?: string | null) {
  const row = await visibleEstimate(actor, estimateId), capabilities = await costCapabilities(actor), access = await getAccessProfile(actor);
  const versions = await versionsFor(estimateId), selected = requestedVersionId ? versions.find((item) => item.id === requestedVersionId) : versions.find((item) => item.id === row.current_version_id);
  if (!selected) throw new EstimateError("Версия сметы не найдена.", 404);
  const sections = await loadSections(selected.id, capabilities.viewCost, capabilities.viewMargin);
  const itemCount = sections.reduce((sum, section) => sum + section.items.length, 0), costCount = sections.reduce((sum, section) => sum + section.items.filter((item) => "internalCostKopecks" in item && item.internalCostKopecks != null).length, 0);
  const internalTotal = capabilities.viewCost && itemCount > 0 && costCount === itemCount ? sections.reduce((sum, section) => sum + section.items.reduce((inner, item) => inner + ("internalTotalKopecks" in item ? Number(item.internalTotalKopecks ?? 0) : 0), 0), 0) : null;
  const summary = serializeSummary(row), selectedPublic = { ...serializeVersion(selected), ...(capabilities.viewCost ? { internalComment: selected.internal_comment, internalTotalKopecks: internalTotal, costCompletionPercent: itemCount ? Math.round(costCount / itemCount * 100) : 0 } : {}),
    ...(capabilities.viewMargin && internalTotal != null ? { marginKopecks: Number(selected.total_kopecks) - internalTotal, marginPercent: Number(selected.total_kopecks) > 0 ? (Number(selected.total_kopecks) - internalTotal) / Number(selected.total_kopecks) * 100 : 0 } : {}) };
  const history = await query<{ id: string; type: string; occurredAt: number; versionId: string | null; actorName: string; metadata: Record<string, unknown> }>(`SELECT ee.id,ee.type,ee.occurred_at "occurredAt",ee.version_id "versionId",u.display_name "actorName",ee.metadata_json metadata FROM estimate_events ee JOIN users u ON u.id=ee.actor_user_id WHERE ee.estimate_id=$1 ORDER BY ee.occurred_at DESC,ee.id DESC`, [estimateId]);
  const renovation = await first<{ orderId: string; orderNumber: string }>("SELECT rod.order_id \"orderId\",o.number \"orderNumber\" FROM renovation_order_details rod JOIN orders o ON o.id=rod.order_id WHERE rod.approved_estimate_version_id=$1 LIMIT 1", [selected.id]);
  return { estimate: summary, selectedVersion: selectedPublic, sections, versions: versions.map(serializeVersion), history, renovationOrder: renovation,
    capabilities: { ...capabilities, edit: selected.status === "DRAFT" && (actor.role === "OWNER" || access.actions["estimates.edit"]), archive: actor.role === "OWNER" || access.actions["estimates.edit"], createVersion: actor.role === "OWNER" || access.actions["estimates.createVersion"], send: actor.role === "OWNER" || access.actions["estimates.sendProposal"], approve: actor.role === "OWNER" || access.actions["estimates.approve"], reject: actor.role === "OWNER" || access.actions["estimates.reject"], createRenovation: (actor.role === "OWNER" || access.actions["orders.create"]) && selected.status === "APPROVED" } };
}

function parseSections(value: unknown, allowCost: boolean, existingCosts = new Map<string, number | null>()) {
  if (!Array.isArray(value) || value.length > 100) throw new EstimateError("Проверьте разделы сметы.");
  let worksTotal = 0, internalTotal = 0, costCount = 0, itemCount = 0;
  const sections = value.map((raw, sectionPosition) => {
    const source = raw as SectionInput, name = clean(source.name, 240); if (!name) throw new EstimateError("У каждого раздела должно быть название.");
    const rawItems = Array.isArray(source.items) ? source.items : []; if (rawItems.length > 1000) throw new EstimateError("В разделе слишком много позиций.");
    const items = rawItems.map((rawItem, position) => {
      const item = rawItem as ItemInput, itemName = clean(item.name, 500), unit = clean(item.unit, 40); if (!itemName || !unit) throw new EstimateError("Заполните название и единицу позиции.");
      const itemId = idValue(item.id) ?? crypto.randomUUID(), quantity = quantityHundredths(item.quantity), clientPrice = kopecks(item.clientPriceKopecks) as number, internalCost = allowCost ? kopecks(item.internalCostKopecks, true) : existingCosts.get(itemId) ?? null;
      const total = itemTotal(quantity.scaled, clientPrice); worksTotal += total; itemCount += 1;
      if (internalCost != null) { internalTotal += itemTotal(quantity.scaled, internalCost); costCount += 1; }
      return { id: itemId, name: itemName, unit, quantity: quantity.database, clientPrice, internalCost, position };
    });
    return { id: idValue(source.id) ?? crypto.randomUUID(), name, position: sectionPosition, items };
  });
  return { sections, worksTotal, internalTotal, costCount, itemCount };
}

export async function saveDraft(actor: AuthUser, estimateId: string, input: EstimateInput) {
  await assertEstimateAccess(actor, "estimates.edit");
  const estimate = await visibleEstimate(actor, estimateId), versionId = idValue(input.versionId) ?? estimate.current_version_id;
  const version = await first<{ id: string; status: EstimateVersionStatus; estimated_materials_budget_kopecks: number | string | null }>("SELECT id,status,estimated_materials_budget_kopecks FROM estimate_versions WHERE id=$1 AND estimate_id=$2 LIMIT 1", [versionId, estimateId]);
  if (!version) throw new EstimateError("Версия сметы не найдена.", 404); if (version.status !== "DRAFT") throw new EstimateError("Отправленную или согласованную версию нельзя редактировать. Создайте новую версию.", 409);
  const previousSections = await query<{id:string;name:string}>("SELECT id,name FROM estimate_sections WHERE version_id=$1",[versionId]);
  const previousItems = await query<{id:string;section_id:string;name:string;quantity:string|number;client_price_kopecks:string|number;internal_cost_kopecks:string|number|null}>("SELECT i.id,i.section_id,i.name,i.quantity,i.client_price_kopecks,i.internal_cost_kopecks FROM estimate_items i JOIN estimate_sections s ON s.id=i.section_id WHERE s.version_id=$1",[versionId]);
  const capabilities = await costCapabilities(actor), parsed = parseSections(input.sections, capabilities.viewCost, new Map(previousItems.map(item=>[item.id,item.internal_cost_kopecks==null?null:Number(item.internal_cost_kopecks)]))), timestamp = now();
  const material = input.estimatedMaterialsBudgetKopecks === undefined ? version.estimated_materials_budget_kopecks == null ? null : Number(version.estimated_materials_budget_kopecks) : kopecks(input.estimatedMaterialsBudgetKopecks, true);
  const statements: { text: string; params: unknown[] }[] = [
    { text: "SELECT id FROM estimate_versions WHERE id=$1 AND status='DRAFT' FOR UPDATE", params: [versionId] },
    { text: "DELETE FROM estimate_items WHERE section_id IN (SELECT id FROM estimate_sections WHERE version_id=$1)", params: [versionId] },
    { text: "DELETE FROM estimate_sections WHERE version_id=$1", params: [versionId] },
  ];
  for (const section of parsed.sections) {
    const oldSection=previousSections.find(item=>item.id===section.id);
    statements.push({ text: "INSERT INTO estimate_sections(id,version_id,name,position,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6)", params: [section.id, versionId, section.name, section.position, timestamp, timestamp] }, audit(actor.id, oldSection?"ESTIMATE_SECTION_UPDATED":"ESTIMATE_SECTION_CREATED", "EstimateSection", section.id, timestamp, { estimateId, versionId, position: section.position, ...(oldSection&&oldSection.name!==section.name?{before:{name:oldSection.name},after:{name:section.name}}:{}) }));
    for (const item of section.items) { const oldItem=previousItems.find(previous=>previous.id===item.id); statements.push({ text: "INSERT INTO estimate_items(id,section_id,name,unit,quantity,client_price_kopecks,internal_cost_kopecks,position,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", params: [item.id, section.id, item.name, item.unit, item.quantity, item.clientPrice, item.internalCost, item.position, timestamp, timestamp] }, audit(actor.id, oldItem?"ESTIMATE_ITEM_UPDATED":"ESTIMATE_ITEM_CREATED", "EstimateItem", item.id, timestamp, { estimateId, versionId, sectionId: section.id, ...(oldItem?{before:{name:oldItem.name,quantity:Number(oldItem.quantity),clientPriceKopecks:Number(oldItem.client_price_kopecks)},after:{name:item.name,quantity:Number(item.quantity),clientPriceKopecks:item.clientPrice}}:{quantity:item.quantity,clientPriceKopecks:item.clientPrice}) })); }
  }
  const nextSectionIds=new Set(parsed.sections.map(section=>section.id)),nextItemIds=new Set(parsed.sections.flatMap(section=>section.items.map(item=>item.id)));
  for(const section of previousSections)if(!nextSectionIds.has(section.id))statements.push(audit(actor.id,"ESTIMATE_SECTION_DELETED","EstimateSection",section.id,timestamp,{estimateId,versionId,name:section.name}));
  for(const item of previousItems)if(!nextItemIds.has(item.id))statements.push(audit(actor.id,"ESTIMATE_ITEM_DELETED","EstimateItem",item.id,timestamp,{estimateId,versionId,name:item.name}));
  statements.push(
    { text: "UPDATE estimate_versions SET total_kopecks=$1,estimated_materials_budget_kopecks=$2,planned_duration=$3,client_comment=$4,internal_comment=CASE WHEN $5::boolean THEN $6 ELSE internal_comment END,updated_at=$7 WHERE id=$8 AND status='DRAFT'", params: [parsed.worksTotal, material, clean(input.plannedDuration, 300), clean(input.clientComment, 4000), capabilities.viewCost, clean(input.internalComment, 4000), timestamp, versionId] },
    { text: "UPDATE estimates SET updated_at=$1 WHERE id=$2", params: [timestamp, estimateId] },
    audit(actor.id, "ESTIMATE_UPDATED", "Estimate", estimateId, timestamp, { versionId, worksTotalKopecks: parsed.worksTotal, sectionCount: parsed.sections.length, itemCount: parsed.itemCount }),
    event(actor.id, estimateId, versionId, "ESTIMATE_UPDATED", timestamp, { worksTotalKopecks: parsed.worksTotal }),
  );
  await transaction(statements); return getEstimate(actor, estimateId, versionId);
}

export async function createEstimateVersion(actor: AuthUser, estimateId: string, input: EstimateInput) {
  await assertEstimateAccess(actor, "estimates.createVersion");
  const estimate = await visibleEstimate(actor, estimateId), sourceId = idValue(input.sourceVersionId) ?? estimate.current_version_id;
  const source = await first<VersionRow>("SELECT v.*,'' created_by_name,NULL sent_by_name,NULL approved_by_name,NULL rejected_by_name FROM estimate_versions v WHERE v.id=$1 AND v.estimate_id=$2 LIMIT 1", [sourceId, estimateId]);
  if (!source) throw new EstimateError("Исходная версия не найдена.", 404);
  const oldSections = await query<{ id: string; name: string; position: number }>("SELECT id,name,position FROM estimate_sections WHERE version_id=$1 ORDER BY position", [sourceId]);
  const oldItems = await query<ItemRow>("SELECT i.id,i.section_id,i.name,i.unit,i.quantity,i.client_price_kopecks,i.internal_cost_kopecks,i.position FROM estimate_items i JOIN estimate_sections s ON s.id=i.section_id WHERE s.version_id=$1 ORDER BY s.position,i.position", [sourceId]);
  const versionId = crypto.randomUUID(), timestamp = now(), sectionIds = new Map(oldSections.map((section) => [section.id, crypto.randomUUID()]));
  const statements: { text: string; params: unknown[] }[] = [
    { text: "UPDATE estimates SET updated_at=$1 WHERE id=$2", params: [timestamp, estimateId] },
    { text: `INSERT INTO estimate_versions(id,estimate_id,project_id,version,total_kopecks,change_reason,status,estimated_materials_budget_kopecks,planned_duration,client_comment,internal_comment,created_by_user_id,created_at,updated_at)
      SELECT $1,$2,project_id,(SELECT COALESCE(MAX(version),0)+1 FROM estimate_versions WHERE estimate_id=$2),total_kopecks,$3,'DRAFT',estimated_materials_budget_kopecks,planned_duration,client_comment,internal_comment,$4,$5,$6 FROM estimate_versions WHERE id=$7 AND estimate_id=$2`, params: [versionId, estimateId, clean(input.changeReason, 1000), actor.id, timestamp, timestamp, sourceId] },
    { text: "UPDATE estimate_versions SET status='SUPERSEDED',updated_at=$1 WHERE id=$2 AND status IN ('DRAFT','SENT','REJECTED')", params: [timestamp, estimate.current_version_id] },
    { text: "UPDATE estimates SET current_version_id=$1,updated_at=$2 WHERE id=$3", params: [versionId, timestamp, estimateId] },
  ];
  for (const section of oldSections) statements.push({ text: "INSERT INTO estimate_sections(id,version_id,name,position,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6)", params: [sectionIds.get(section.id), versionId, section.name, section.position, timestamp, timestamp] });
  for (const item of oldItems) statements.push({ text: "INSERT INTO estimate_items(id,section_id,name,unit,quantity,client_price_kopecks,internal_cost_kopecks,position,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", params: [crypto.randomUUID(), sectionIds.get(item.section_id), item.name, item.unit, item.quantity, item.client_price_kopecks, item.internal_cost_kopecks, item.position, timestamp, timestamp] });
  statements.push(audit(actor.id, "ESTIMATE_VERSION_CREATED", "EstimateVersion", versionId, timestamp, { estimateId, sourceVersionId: sourceId }), event(actor.id, estimateId, versionId, "ESTIMATE_VERSION_CREATED", timestamp, { sourceVersion: source.version }));
  await transaction(statements); return getEstimate(actor, estimateId, versionId);
}

async function actionableVersion(actor: AuthUser, estimateId: string, versionId: string) {
  await visibleEstimate(actor, estimateId);
  const row = await first<VersionRow>("SELECT v.*,'' created_by_name,NULL sent_by_name,NULL approved_by_name,NULL rejected_by_name FROM estimate_versions v WHERE id=$1 AND estimate_id=$2 LIMIT 1", [versionId, estimateId]);
  if (!row) throw new EstimateError("Версия сметы не найдена.", 404); return row;
}

export async function sendProposal(actor: AuthUser, estimateId: string, input: EstimateInput) {
  await assertEstimateAccess(actor, "estimates.sendProposal"); const versionId = idValue(input.versionId); if (!versionId) throw new EstimateError("Версия не указана.");
  const version = await actionableVersion(actor, estimateId, versionId); if (!["DRAFT", "SENT"].includes(version.status)) throw new EstimateError("Эту версию нельзя отметить отправленной.", 409);
  const estimate = await visibleEstimate(actor, estimateId), timestamp = now(), moveLead = input.moveLeadToProposal === true && Boolean(estimate.source_lead_id);
  const statements = [{ text: "UPDATE estimate_versions SET status='SENT',sent_at=$1,sent_by_user_id=$2,updated_at=$3 WHERE id=$4", params: [timestamp, actor.id, timestamp, versionId] }, audit(actor.id, "ESTIMATE_SENT", "EstimateVersion", versionId, timestamp, { estimateId, resend: version.status === "SENT" }), event(actor.id, estimateId, versionId, "ESTIMATE_SENT", timestamp, { resend: version.status === "SENT" })];
  if (moveLead) statements.push({ text: "UPDATE leads SET stage='PROPOSAL',updated_at=$1 WHERE id=$2 AND stage='CALCULATION'", params: [timestamp, estimate.source_lead_id] }, audit(actor.id, "LEAD_STAGE_CHANGED", "Lead", estimate.source_lead_id!, timestamp, { from: "CALCULATION", to: "PROPOSAL", estimateId }));
  await transaction(statements);
  return getEstimate(actor, estimateId, versionId);
}

export async function approveEstimate(actor: AuthUser, estimateId: string, input: EstimateInput) {
  await assertEstimateAccess(actor, "estimates.approve"); const versionId = idValue(input.versionId); if (!versionId) throw new EstimateError("Версия не указана.");
  const version = await actionableVersion(actor, estimateId, versionId); if (["REJECTED", "SUPERSEDED"].includes(version.status)) throw new EstimateError("Отклонённую или заменённую версию нельзя согласовать.", 409);
  const timestamp = now(); await transaction([{ text: "UPDATE estimate_versions SET status='APPROVED',approved_at=$1,approved_by_user_id=$2,approval_comment=$3,updated_at=$4 WHERE id=$5", params: [timestamp, actor.id, clean(input.comment, 2000), timestamp, versionId] }, { text: "UPDATE estimates SET approved_version_id=$1,current_version_id=$1,updated_at=$2 WHERE id=$3", params: [versionId, timestamp, estimateId] }, audit(actor.id, "ESTIMATE_APPROVED", "EstimateVersion", versionId, timestamp, { estimateId }), event(actor.id, estimateId, versionId, "ESTIMATE_APPROVED", timestamp)]);
  return getEstimate(actor, estimateId, versionId);
}

export async function rejectEstimate(actor: AuthUser, estimateId: string, input: EstimateInput) {
  await assertEstimateAccess(actor, "estimates.reject"); const versionId = idValue(input.versionId), reason = clean(input.reason, 2000); if (!versionId || !reason) throw new EstimateError("Укажите причину отклонения.");
  const version = await actionableVersion(actor, estimateId, versionId); if (version.status === "APPROVED") throw new EstimateError("Согласованную версию нельзя отклонить задним числом.", 409);
  const timestamp = now(); await transaction([{ text: "UPDATE estimate_versions SET status='REJECTED',rejected_at=$1,rejected_by_user_id=$2,rejection_reason=$3,updated_at=$4 WHERE id=$5", params: [timestamp, actor.id, reason, timestamp, versionId] }, audit(actor.id, "ESTIMATE_REJECTED", "EstimateVersion", versionId, timestamp, { estimateId, reason }), event(actor.id, estimateId, versionId, "ESTIMATE_REJECTED", timestamp, { reason })]);
  return getEstimate(actor, estimateId, versionId);
}

export async function archiveEstimate(actor: AuthUser, estimateId: string, archived: boolean) {
  await assertEstimateAccess(actor, "estimates.edit");
  await visibleEstimate(actor, estimateId);
  const timestamp = now();
  await transaction([
    { text: "UPDATE estimates SET status=$1,archived_at=$2,updated_at=$3 WHERE id=$4", params: [archived ? "CLOSED" : "ACTIVE", archived ? timestamp : null, timestamp, estimateId] },
    audit(actor.id, archived ? "ESTIMATE_ARCHIVED" : "ESTIMATE_RESTORED", "Estimate", estimateId, timestamp),
    event(actor.id, estimateId, null, archived ? "ESTIMATE_ARCHIVED" : "ESTIMATE_RESTORED", timestamp),
  ]);
  return getEstimate(actor, estimateId);
}

export async function createProposalFollowUp(actor: AuthUser, estimateId: string, input: EstimateInput) {
  await assertModuleAction(actor, "crm", "crm.edit"); const estimate = await visibleEstimate(actor, estimateId); if (!estimate.source_lead_id) throw new EstimateError("У сметы нет связанной CRM-заявки.", 409);
  const scheduledAt = Number(input.scheduledAt); if (!Number.isInteger(scheduledAt) || scheduledAt <= now()) throw new EstimateError("Укажите будущую дату следующего действия.");
  const id = crypto.randomUUID(), timestamp = now(), comment = clean(input.comment, 1000);
  await transaction([{ text: "UPDATE lead_activities SET status='CANCELLED',updated_at=$1 WHERE lead_id=$2 AND status='SCHEDULED'", params: [timestamp, estimate.source_lead_id] }, { text: "INSERT INTO lead_activities(id,lead_id,type,status,scheduled_at,comment,created_by_user_id,created_at,updated_at) VALUES($1,$2,'FOLLOW_UP_PROPOSAL','SCHEDULED',$3,$4,$5,$6,$7)", params: [id, estimate.source_lead_id, scheduledAt, comment, actor.id, timestamp, timestamp] }, { text: "UPDATE leads SET next_action_type='FOLLOW_UP_PROPOSAL',next_action_at=$1,next_action_comment=$2,updated_at=$3 WHERE id=$4", params: [scheduledAt, comment, timestamp, estimate.source_lead_id] }, audit(actor.id, "LEAD_ACTIVITY_CREATED", "LeadActivity", id, timestamp, { leadId: estimate.source_lead_id, type: "FOLLOW_UP_PROPOSAL", estimateId }), event(actor.id, estimateId, estimate.current_version_id, "ESTIMATE_FOLLOW_UP_CREATED", timestamp, { leadId: estimate.source_lead_id, scheduledAt })]);
  return { ok: true, activityId: id };
}

async function nextOrderNumber() { const sequence = await first<{ value: string | number }>("SELECT nextval('depa_order_number_seq') value"); return `ORD-${String(sequence?.value || 1).padStart(6, "0")}`; }

export async function createRenovationFromEstimate(actor: AuthUser, estimateId: string, input: EstimateInput) {
  await assertModuleAction(actor, "orders", "orders.create"); const estimate = await visibleEstimate(actor, estimateId), versionId = idValue(input.versionId) ?? estimate.approved_version_id;
  if (!versionId) throw new EstimateError("Сначала согласуйте версию сметы.", 409); const version = await actionableVersion(actor, estimateId, versionId);
  if (version.status !== "APPROVED") throw new EstimateError("Заказ на ремонт создаётся только из согласованной версии.", 409);
  const existing = await first<{ order_id: string; number: string }>("SELECT rod.order_id,o.number FROM renovation_order_details rod JOIN orders o ON o.id=rod.order_id WHERE rod.approved_estimate_version_id=$1 LIMIT 1", [versionId]);
  if (existing) throw new EstimateError("Заказ на ремонт уже создан.", 409, { orderId: existing.order_id, orderNumber: existing.number });
  const orderId = crypto.randomUUID(), detailId = crypto.randomUUID(), number = await nextOrderNumber(), timestamp = now();
  await transaction([
    { text: "INSERT INTO orders(id,number,client_id,type,title,amount_kopecks,status,responsible_user_id,comment,created_by_user_id,source_lead_id,source_order_id,created_at,updated_at) VALUES($1,$2,$3,'RENOVATION','Ремонт квартиры',$4,'NEW',$5,$6,$7,$8,$9,$10,$11)", params: [orderId, number, estimate.client_id, Number(version.total_kopecks), estimate.responsible_user_id, clean(input.comment, 3000), actor.id, estimate.source_lead_id, estimate.source_order_id, timestamp, timestamp] },
    { text: "INSERT INTO renovation_order_details(id,order_id,residential_complex,residential_complex_id,residential_complex_address_id,address,apartment_number,area_sqm,approved_estimate_version_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", params: [detailId, orderId, estimate.residential_complex, estimate.residential_complex_id, estimate.residential_complex_address_id, estimate.address, estimate.apartment_number ?? "—", estimate.area_sqm, versionId, timestamp, timestamp] },
    audit(actor.id, "ORDER_CREATED", "Order", orderId, timestamp, { type: "RENOVATION", number, clientId: estimate.client_id, approvedEstimateVersionId: versionId }),
    audit(actor.id, "RENOVATION_ORDER_CREATED_FROM_ESTIMATE", "EstimateVersion", versionId, timestamp, { estimateId, orderId, worksTotalKopecks: Number(version.total_kopecks) }),
    event(actor.id, estimateId, versionId, "RENOVATION_ORDER_CREATED_FROM_ESTIMATE", timestamp, { orderId, number }),
  ]);
  return { orderId, orderNumber: number };
}

export async function getProposal(actor: AuthUser, estimateId: string, versionId?: string | null) {
  const estimate = await visibleEstimate(actor, estimateId), versions = await versionsFor(estimateId), selected = versionId ? versions.find((item) => item.id === versionId) : versions.find((item) => item.id === estimate.current_version_id);
  if (!selected) throw new EstimateError("Версия КП не найдена.", 404);
  const sections = await loadSections(selected.id, false, false);
  return { brand: "DEPA STROY", title: "Коммерческое предложение", estimateId, versionId: selected.id, version: Number(selected.version), status: selected.status,
    client: { name: estimate.client_name }, object: { residentialComplex: estimate.residential_complex, address: estimate.address, apartmentNumber: estimate.apartment_number, areaSqm: estimate.area_sqm == null ? null : Number(estimate.area_sqm) },
    sections, worksTotalKopecks: Number(selected.total_kopecks), estimatedMaterialsBudgetKopecks: selected.estimated_materials_budget_kopecks == null ? null : Number(selected.estimated_materials_budget_kopecks),
    totalBudgetReferenceKopecks: Number(selected.total_kopecks) + Number(selected.estimated_materials_budget_kopecks ?? 0), plannedDuration: selected.planned_duration, terms: selected.client_comment, date: selected.sent_at ?? selected.created_at };
}
