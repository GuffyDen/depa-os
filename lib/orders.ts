import type { AuthUser } from "./auth";
import { confirmAttachmentUpload, FileError } from "./files";
import { parseAmountKopecks } from "./finance-rules";
import {
  DEFECT_CATEGORIES,
  DEFECT_SEVERITIES,
  ORDER_STATUSES,
  ORDER_TYPES,
  type OrderStatus,
  type OrderType,
  type PaymentStatus,
} from "./orders-config";
import { first, query, transaction } from "./postgres";
import {
  AccessError,
  assertModuleAction,
  getAccessProfile,
} from "./permissions";

type OrderRow = {
  id: string;
  number: string;
  client_id: string;
  client_name: string;
  client_phone: string;
  type: OrderType;
  title: string;
  amount_kopecks: number | string;
  status: OrderStatus;
  responsible_user_id: string;
  responsible_name: string;
  scheduled_at: number | null;
  started_at: number | null;
  completed_at: number | null;
  cancelled_at: number | null;
  comment: string | null;
  internal_comment: string | null;
  created_by_user_id: string;
  created_at: number;
  updated_at: number;
  inspection_id: string | null;
  residential_complex: string | null;
  address: string | null;
  apartment_number: string | null;
  area_sqm: string | number | null;
  scheduled_start_at: number | null;
  scheduled_end_at: number | null;
  inspector_user_id: string | null;
  inspector_name: string | null;
  result_comment: string | null;
  paid_kopecks: number | string;
  defect_count: number | string;
  photo_count: number | string;
};

export type OrderInput = Record<string, unknown>;
export class OrderError extends Error {
  constructor(
    message: string,
    public status = 400,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
const now = () => Math.floor(Date.now() / 1000);
const clean = (value: unknown, max = 1000) =>
  typeof value === "string" ? value.trim().slice(0, max) || null : null;
const seconds = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value))
    return Math.floor(value);
  if (typeof value === "string" && value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 1_000_000_000)
      return Math.floor(numeric);
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return Math.floor(date.getTime() / 1000);
  }
  return null;
};
const area = (value: unknown) => {
  if (value == null || value === "") return null;
  const result = Number(String(value).replace(",", "."));
  return Number.isFinite(result) && result > 0
    ? Math.round(result * 100) / 100
    : null;
};
function paymentStatus(paid: number, price: number): PaymentStatus {
  return paid <= 0 ? "UNPAID" : paid < price ? "PARTIALLY_PAID" : "PAID";
}
function baseSelect() {
  return `SELECT o.id,o.number,o.client_id,c.name client_name,c.phone client_phone,o.type,o.title,o.amount_kopecks,o.status,o.responsible_user_id,ru.display_name responsible_name,o.scheduled_at,o.started_at,o.completed_at,o.cancelled_at,o.comment,o.internal_comment,o.created_by_user_id,o.created_at,o.updated_at,i.id inspection_id,i.residential_complex,i.address,i.apartment_number,i.area_sqm,i.scheduled_start_at,i.scheduled_end_at,i.inspector_user_id,iu.display_name inspector_name,i.result_comment,COALESCE((SELECT SUM(ft.amount_kopecks) FROM financial_transactions ft WHERE ft.order_id=o.id AND ft.type='INCOME'),0) paid_kopecks,COALESCE((SELECT COUNT(*) FROM inspection_defects d WHERE d.inspection_id=i.id),0) defect_count,COALESCE((SELECT COUNT(*) FROM attachments a WHERE a.category='INSPECTION' AND a.upload_status='LINKED' AND a.deleted_at IS NULL AND ((a.entity_type='Inspection' AND a.entity_id=i.id) OR (a.entity_type='InspectionDefect' AND a.entity_id IN (SELECT id FROM inspection_defects WHERE inspection_id=i.id)))),0) photo_count FROM orders o JOIN clients c ON c.id=o.client_id JOIN users ru ON ru.id=o.responsible_user_id LEFT JOIN inspections i ON i.order_id=o.id LEFT JOIN users iu ON iu.id=i.inspector_user_id`;
}
function serialize(row: OrderRow) {
  const price = Number(row.amount_kopecks),
    paid = Number(row.paid_kopecks),
    remaining = Math.max(price - paid, 0),
    overpayment = Math.max(paid - price, 0),
    scheduledStartAt = row.scheduled_start_at ?? row.scheduled_at,
    scheduledEndAt =
      row.scheduled_end_at ??
      (scheduledStartAt == null ? null : scheduledStartAt + 5400);
  return {
    id: row.id,
    orderNumber: row.number,
    clientId: row.client_id,
    clientName: row.client_name,
    clientPhone: row.client_phone,
    type: row.type,
    title: row.title,
    priceKopecks: price,
    status: row.status,
    responsibleUserId: row.responsible_user_id,
    responsibleName: row.responsible_name,
    scheduledAt: scheduledStartAt,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    comment: row.comment,
    internalComment: row.internal_comment,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    paidKopecks: paid,
    remainingKopecks: remaining,
    overpaymentKopecks: overpayment,
    paymentStatus: paymentStatus(paid, price),
    inspection: row.inspection_id
      ? {
          id: row.inspection_id,
          residentialComplex: row.residential_complex,
          address: row.address,
          apartmentNumber: row.apartment_number,
          areaSqm: row.area_sqm == null ? null : Number(row.area_sqm),
          scheduledAt: scheduledStartAt,
          scheduledStartAt,
          scheduledEndAt,
          inspectorUserId: row.inspector_user_id,
          inspectorName: row.inspector_name,
          resultComment: row.result_comment,
        }
      : null,
    defectCount: Number(row.defect_count),
    photoCount: Number(row.photo_count),
  };
}

export async function listOrderUsers() {
  return query<{ id: string; name: string }>(
    `SELECT u.id,u.display_name name FROM users u WHERE u.status='ACTIVE' AND (u.role='OWNER' OR EXISTS(SELECT 1 FROM user_permissions p WHERE p.user_id=u.id AND p.permission='modules.orders.view' AND p.scope='COMPANY' AND p.allowed=1)) ORDER BY CASE WHEN u.role='OWNER' THEN 0 ELSE 1 END,u.display_name`,
  );
}
async function assertOrderUser(id: string) {
  if (
    !(await first<{ id: string }>(
      `SELECT u.id FROM users u WHERE u.id=$1 AND u.status='ACTIVE' AND (u.role='OWNER' OR EXISTS(SELECT 1 FROM user_permissions p WHERE p.user_id=u.id AND p.permission='modules.orders.view' AND p.scope='COMPANY' AND p.allowed=1))`,
      [id],
    ))
  )
    throw new OrderError(
      "Выбранный пользователь не может работать с заказами.",
    );
}
async function assertClient(actor: AuthUser, id: string) {
  const access = await getAccessProfile(actor);
  const assigned = actor.role !== "OWNER" && access.scopes.clients !== "ALL";
  const row = await first<{ id: string }>(
    `SELECT id FROM clients WHERE id=$1 AND status='ACTIVE'${assigned ? " AND responsible_user_id=$2" : ""} LIMIT 1`,
    assigned ? [id, actor.id] : [id],
  );
  if (!row) throw new OrderError("Клиент не найден или недоступен.", 403);
}
function addScope(
  actor: AuthUser,
  allClients: boolean,
  conditions: string[],
  params: unknown[],
) {
  if (actor.role !== "OWNER" && !allClients) {
    params.push(actor.id);
    conditions.push(
      `(o.responsible_user_id=$${params.length} OR c.responsible_user_id=$${params.length})`,
    );
  }
}

function vladivostokRange(
  period: string,
  from: string | null,
  to: string | null,
) {
  const offset = 10 * 3600,
    current = now(),
    day = Math.floor((current + offset) / 86400) * 86400 - offset;
  let start: number | null = null,
    end: number | null = null;
  if (period === "TODAY") {
    start = day;
    end = day + 86400 - 1;
  } else if (period === "TOMORROW") {
    start = day + 86400;
    end = day + 2 * 86400 - 1;
  } else if (period === "WEEK") {
    const weekday = new Date((day + offset) * 1000).getUTCDay() || 7;
    start = day - (weekday - 1) * 86400;
    end = start + 7 * 86400 - 1;
  } else if (period === "MONTH") {
    const d = new Date((current + offset) * 1000);
    start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000 - offset;
    end =
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000 - offset - 1;
  } else if (period === "CUSTOM") {
    if (from)
      start = Math.floor(new Date(`${from}T00:00:00+10:00`).getTime() / 1000);
    if (to) end = Math.floor(new Date(`${to}T23:59:59+10:00`).getTime() / 1000);
  }
  return { start, end };
}

export async function listOrders(actor: AuthUser, requestUrl: string) {
  await assertModuleAction(actor, "orders", "orders.view");
  const access = await getAccessProfile(actor),
    url = new URL(requestUrl),
    attention = url.searchParams.get("attention") === "1";
  const search = (url.searchParams.get("search") || "").trim().slice(0, 120),
    type = url.searchParams.get("type") || "ALL",
    status = url.searchParams.get("status") || "ALL",
    payment = url.searchParams.get("payment") || "ALL",
    responsible = url.searchParams.get("responsibleUserId") || "ALL",
    period = url.searchParams.get("period") || "ALL";
  const limit = Math.min(
      Math.max(Number(url.searchParams.get("limit")) || 30, 1),
      100,
    ),
    offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0),
    params: unknown[] = [],
    conditions: string[] = [];
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  addScope(actor, access.scopes.clients === "ALL", conditions, params);
  if (search) {
    const term = `%${search}%`,
      digits = search.replace(/\D/g, "");
    conditions.push(
      `(o.number ILIKE ${add(term)} OR c.name ILIKE ${add(term)} OR c.phone_normalized LIKE ${add(digits ? `%${digits}%` : "__NO_PHONE__")} OR i.address ILIKE ${add(term)} OR i.residential_complex ILIKE ${add(term)} OR i.apartment_number ILIKE ${add(term)})`,
    );
  }
  if (ORDER_TYPES.some((x) => x.value === type))
    conditions.push(`o.type=${add(type)}`);
  if (ORDER_STATUSES.some((x) => x.value === status))
    conditions.push(`o.status=${add(status)}`);
  if (responsible !== "ALL")
    conditions.push(`o.responsible_user_id=${add(responsible)}`);
  const range = vladivostokRange(
    period,
    url.searchParams.get("from"),
    url.searchParams.get("to"),
  );
  if (range.start != null)
    conditions.push(
      `COALESCE(o.scheduled_at,o.created_at)>=${add(range.start)}`,
    );
  if (range.end != null)
    conditions.push(`COALESCE(o.scheduled_at,o.created_at)<=${add(range.end)}`);
  const paid = `COALESCE((SELECT SUM(ft.amount_kopecks) FROM financial_transactions ft WHERE ft.order_id=o.id AND ft.type='INCOME'),0)`;
  if (payment === "UNPAID") conditions.push(`${paid}=0`);
  else if (payment === "PARTIALLY_PAID")
    conditions.push(`${paid}>0 AND ${paid}<o.amount_kopecks`);
  else if (payment === "PAID") conditions.push(`${paid}>=o.amount_kopecks`);
  if (attention)
    conditions.push(
      `o.type='INSPECTION' AND o.status='COMPLETED' AND ${paid}<o.amount_kopecks AND NOT EXISTS(SELECT 1 FROM leads l JOIN lead_activities la ON la.lead_id=l.id WHERE l.linked_client_id=o.client_id AND la.type='REQUEST_PAYMENT' AND la.status='SCHEDULED')`,
    );
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "",
    count = await first<{ count: number | string }>(
      `SELECT COUNT(*) count FROM orders o JOIN clients c ON c.id=o.client_id LEFT JOIN inspections i ON i.order_id=o.id${where}`,
      params,
    );
  const rows = await query<OrderRow>(
    `${baseSelect()}${where} ORDER BY ${attention ? "o.completed_at DESC" : "CASE WHEN o.status IN ('NEW','SCHEDULED','IN_PROGRESS') THEN 0 ELSE 1 END,CASE WHEN o.status IN ('NEW','SCHEDULED','IN_PROGRESS') THEN COALESCE(o.scheduled_at,2147483647) END ASC,CASE WHEN o.status IN ('COMPLETED','CANCELLED') THEN COALESCE(o.completed_at,o.cancelled_at,o.updated_at) END DESC,o.created_at DESC"} LIMIT ${add(attention ? 5 : limit + 1)}${attention ? "" : ` OFFSET ${add(offset)}`}`,
    params,
  );
  const hasMore = !attention && rows.length > limit;
  return {
    items: rows.slice(0, attention ? 5 : limit).map(serialize),
    total: Number(count?.count || 0),
    hasMore,
    nextOffset: hasMore ? offset + limit : null,
    responsibleUsers: await listOrderUsers(),
    types: ORDER_TYPES,
    statuses: ORDER_STATUSES,
  };
}

export async function listInspectionCalendar(
  actor: AuthUser,
  requestUrl: string,
) {
  await assertModuleAction(actor, "orders", "orders.view");
  const access = await getAccessProfile(actor),
    url = new URL(requestUrl),
    rangeStart = seconds(url.searchParams.get("rangeStart")),
    rangeEnd = seconds(url.searchParams.get("rangeEnd")),
    inspectorUserId = url.searchParams.get("inspectorUserId") || "ALL";
  if (
    !rangeStart ||
    !rangeEnd ||
    rangeEnd <= rangeStart ||
    rangeEnd - rangeStart > 62 * 86400
  )
    throw new OrderError(
      "Укажите корректный период календаря не более 62 дней.",
    );
  const params: unknown[] = [],
    conditions = [
      "o.type='INSPECTION'",
      "i.scheduled_start_at IS NOT NULL",
      "i.scheduled_end_at IS NOT NULL",
    ],
    add = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
  addScope(actor, access.scopes.clients === "ALL", conditions, params);
  conditions.push(
    `i.scheduled_start_at<${add(rangeEnd)}`,
    `i.scheduled_end_at>${add(rangeStart)}`,
  );
  if (inspectorUserId !== "ALL")
    conditions.push(`i.inspector_user_id=${add(inspectorUserId)}`);
  const rows = await query<OrderRow>(
    `${baseSelect()} WHERE ${conditions.join(" AND ")} ORDER BY i.scheduled_start_at ASC,o.created_at ASC LIMIT 500`,
    params,
  );
  return {
    items: rows.map(serialize),
    inspectors: await listOrderUsers(),
    rangeStart,
    rangeEnd,
  };
}

async function visibleOrder(actor: AuthUser, id: string) {
  await assertModuleAction(actor, "orders", "orders.view");
  const access = await getAccessProfile(actor),
    params: unknown[] = [id],
    conditions = ["o.id=$1"];
  addScope(actor, access.scopes.clients === "ALL", conditions, params);
  const row = await first<OrderRow>(
    `${baseSelect()} WHERE ${conditions.join(" AND ")} LIMIT 1`,
    params,
  );
  if (!row) {
    const exists = await first<{ id: string }>(
      "SELECT id FROM orders WHERE id=$1",
      [id],
    );
    throw new AccessError(
      exists ? "Нет доступа к заказу." : "Заказ не найден.",
      exists ? 403 : 404,
    );
  }
  return row;
}
export async function canViewOrder(actor: AuthUser, id: string) {
  try {
    await visibleOrder(actor, id);
    return true;
  } catch {
    return false;
  }
}
export async function getOrder(actor: AuthUser, id: string) {
  const row = await visibleOrder(actor, id),
    access = await getAccessProfile(actor);
  const [defects, files, finances, history] = await Promise.all([
    row.inspection_id
      ? query<{
          id: string;
          room: string;
          category: string;
          description: string;
          severity: string;
          status: string;
          createdAt: number;
          updatedAt: number;
          photoCount: number | string;
        }>(
          `SELECT d.id,d.room,d.category,d.description,d.severity,d.status,d.created_at "createdAt",d.updated_at "updatedAt",(SELECT COUNT(*) FROM attachments a WHERE a.entity_type='InspectionDefect' AND a.entity_id=d.id AND a.category='INSPECTION' AND a.upload_status='LINKED' AND a.deleted_at IS NULL) "photoCount" FROM inspection_defects d WHERE d.inspection_id=$1 ORDER BY d.created_at DESC`,
          [row.inspection_id],
        )
      : Promise.resolve([]),
    row.inspection_id
      ? query<{
          id: string;
          originalFilename: string;
          entityType: string;
          entityId: string | null;
          createdAt: number;
        }>(
          `SELECT id,original_filename "originalFilename",entity_type "entityType",entity_id "entityId",created_at "createdAt" FROM attachments WHERE category='INSPECTION' AND upload_status='LINKED' AND deleted_at IS NULL AND ((entity_type='Inspection' AND entity_id=$1) OR (entity_type='InspectionDefect' AND entity_id IN (SELECT id FROM inspection_defects WHERE inspection_id=$1))) ORDER BY created_at DESC`,
          [row.inspection_id],
        )
      : Promise.resolve([]),
    query<{
      id: string;
      amountKopecks: number;
      transactionDate: number;
      title: string;
      cashboxName: string;
    }>(
      `SELECT ft.id,ft.amount_kopecks "amountKopecks",ft.transaction_date "transactionDate",ft.title,cb.name "cashboxName" FROM financial_transactions ft JOIN cashboxes cb ON cb.id=ft.cashbox_id WHERE ft.order_id=$1 AND ft.type='INCOME' ORDER BY ft.transaction_date DESC,ft.created_at DESC`,
      [id],
    ),
    query<{
      id: string;
      action: string;
      occurredAt: number;
      actorName: string;
      metadata: unknown;
    }>(
      `SELECT a.id,a.action,a.occurred_at "occurredAt",u.display_name "actorName",a.metadata_json metadata FROM audit_logs a JOIN users u ON u.id=a.actor_user_id WHERE (a.entity_type='Order' AND a.entity_id=$1) OR (a.metadata_json->>'orderId'=$1) ORDER BY a.occurred_at DESC LIMIT 100`,
      [id],
    ),
  ]);
  return {
    order: serialize(row),
    defects: defects.map((d) => ({ ...d, photoCount: Number(d.photoCount) })),
    files,
    finances,
    history,
    capabilities: {
      edit: actor.role === "OWNER" || access.actions["orders.edit"],
      addPayment:
        (actor.role === "OWNER" || access.actions["finance.createIncome"]) &&
        access.modules.finance &&
        access.ownCashbox,
      upload:
        (actor.role === "OWNER" || access.actions["documents.upload"]) &&
        access.modules.documents,
    },
  };
}

type ScheduleConflictRow = {
  order_id: string;
  number: string;
  client_name: string;
  residential_complex: string | null;
  address: string;
  apartment_number: string;
  scheduled_start_at: number;
  scheduled_end_at: number;
  responsible_user_id: string;
  client_responsible_user_id: string;
};
function scheduleValues(
  input: OrderInput,
  fallbackStart: number | null = null,
  fallbackEnd: number | null = null,
) {
  const scheduledStartAt =
    seconds(input.scheduledStartAt ?? input.scheduledAt) ?? fallbackStart;
  const scheduledEndAt =
    seconds(input.scheduledEndAt) ??
    (input.scheduledEndAt === undefined ? fallbackEnd : null) ??
    (scheduledStartAt == null ? null : scheduledStartAt + 5400);
  if (!scheduledStartAt || !scheduledEndAt)
    throw new OrderError("Укажите дату, время начала и окончания приёмки.");
  if (scheduledEndAt <= scheduledStartAt)
    throw new OrderError("Время окончания должно быть позже времени начала.");
  if (scheduledEndAt - scheduledStartAt > 24 * 3600)
    throw new OrderError("Приёмка не может длиться больше 24 часов.");
  return { scheduledStartAt, scheduledEndAt };
}
async function scheduleConflict(
  actor: AuthUser,
  inspectorUserId: string,
  scheduledStartAt: number,
  scheduledEndAt: number,
  excludeOrderId: string | null,
) {
  const params: unknown[] = [inspectorUserId, scheduledEndAt, scheduledStartAt],
    exclude = excludeOrderId
      ? ` AND o.id<>$${params.push(excludeOrderId)}`
      : "";
  const conflict = await first<ScheduleConflictRow>(
    `SELECT o.id order_id,o.number,c.name client_name,i.residential_complex,i.address,i.apartment_number,i.scheduled_start_at,i.scheduled_end_at,o.responsible_user_id,c.responsible_user_id client_responsible_user_id FROM inspections i JOIN orders o ON o.id=i.order_id JOIN clients c ON c.id=o.client_id WHERE i.inspector_user_id=$1 AND i.scheduled_start_at<$2 AND i.scheduled_end_at>$3 AND o.status<>'CANCELLED'${exclude} ORDER BY i.scheduled_start_at LIMIT 1`,
    params,
  );
  if (!conflict) return null;
  const access = await getAccessProfile(actor),
    canDisclose =
      actor.role === "OWNER" ||
      access.scopes.clients === "ALL" ||
      conflict.responsible_user_id === actor.id ||
      conflict.client_responsible_user_id === actor.id;
  return {
    orderId: canDisclose ? conflict.order_id : null,
    orderNumber: canDisclose ? conflict.number : null,
    clientName: canDisclose ? conflict.client_name : null,
    residentialComplex: canDisclose ? conflict.residential_complex : null,
    address: canDisclose ? conflict.address : null,
    apartmentNumber: canDisclose ? conflict.apartment_number : null,
    scheduledStartAt: conflict.scheduled_start_at,
    scheduledEndAt: conflict.scheduled_end_at,
    detailsRestricted: !canDisclose,
  };
}
async function requireConflictConfirmation(
  actor: AuthUser,
  input: OrderInput,
  inspectorUserId: string,
  scheduledStartAt: number,
  scheduledEndAt: number,
  excludeOrderId: string | null,
) {
  const conflict = await scheduleConflict(
    actor,
    inspectorUserId,
    scheduledStartAt,
    scheduledEndAt,
    excludeOrderId,
  );
  if (conflict && input.allowConflict !== true)
    throw new OrderError(
      "У выбранного специалиста уже есть приёмка в это время.",
      409,
      { code: "SCHEDULE_CONFLICT", conflict },
    );
  return Boolean(conflict);
}
async function validateInspectionInput(actor: AuthUser, input: OrderInput) {
  const clientId = clean(input.clientId, 100),
    responsibleUserId = clean(input.responsibleUserId, 100) || actor.id,
    inspectorUserId = clean(input.inspectorUserId, 100) || actor.id,
    address = clean(input.address, 500),
    apartmentNumber = clean(input.apartmentNumber, 80),
    schedule = scheduleValues(input),
    priceKopecks = parseAmountKopecks(input.price);
  if (!clientId) throw new OrderError("Выберите клиента.");
  if (!address) throw new OrderError("Укажите адрес.");
  if (!apartmentNumber) throw new OrderError("Укажите квартиру.");
  if (!priceKopecks) throw new OrderError("Стоимость должна быть больше нуля.");
  await Promise.all([
    assertClient(actor, clientId),
    assertOrderUser(responsibleUserId),
    assertOrderUser(inspectorUserId),
  ]);
  const conflictOverridden = await requireConflictConfirmation(
    actor,
    input,
    inspectorUserId,
    schedule.scheduledStartAt,
    schedule.scheduledEndAt,
    null,
  );
  return {
    clientId,
    responsibleUserId,
    inspectorUserId,
    address,
    apartmentNumber,
    ...schedule,
    priceKopecks,
    residentialComplex: clean(input.residentialComplex, 240),
    areaSqm: area(input.areaSqm),
    comment: clean(input.comment, 3000),
    internalComment: clean(input.internalComment, 3000),
    conflictOverridden,
  };
}
export async function createOrder(actor: AuthUser, input: OrderInput) {
  await assertModuleAction(actor, "orders", "orders.create");
  const type = clean(input.type, 30) || "INSPECTION";
  if (type !== "INSPECTION")
    throw new OrderError(
      "На этой итерации доступно создание только приёмки квартиры.",
    );
  const data = await validateInspectionInput(actor, input),
    sequence = await first<{ value: string | number }>(
      "SELECT nextval('depa_order_number_seq') value",
    ),
    orderId = crypto.randomUUID(),
    inspectionId = crypto.randomUUID(),
    timestamp = now(),
    number = `ORD-${String(sequence?.value || 1).padStart(6, "0")}`;
  await transaction([
    {
      text: `INSERT INTO orders(id,number,client_id,type,title,amount_kopecks,status,responsible_user_id,scheduled_at,comment,internal_comment,created_by_user_id,created_at,updated_at) VALUES($1,$2,$3,'INSPECTION','Приёмка квартиры',$4,'SCHEDULED',$5,$6,$7,$8,$9,$10,$11)`,
      params: [
        orderId,
        number,
        data.clientId,
        data.priceKopecks,
        data.responsibleUserId,
        data.scheduledStartAt,
        data.comment,
        data.internalComment,
        actor.id,
        timestamp,
        timestamp,
      ],
    },
    {
      text: `INSERT INTO inspections(id,order_id,residential_complex,address,apartment_number,area_sqm,scheduled_at,scheduled_start_at,scheduled_end_at,inspector_user_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10,$11)`,
      params: [
        inspectionId,
        orderId,
        data.residentialComplex,
        data.address,
        data.apartmentNumber,
        data.areaSqm,
        data.scheduledStartAt,
        data.scheduledEndAt,
        data.inspectorUserId,
        timestamp,
        timestamp,
      ],
    },
    {
      text: "INSERT INTO audit_logs(id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES($1,$2,'ORDER_CREATED','Order',$3,$4,$5)",
      params: [
        crypto.randomUUID(),
        actor.id,
        orderId,
        timestamp,
        JSON.stringify({ type: "INSPECTION", number, clientId: data.clientId }),
      ],
    },
    {
      text: "INSERT INTO audit_logs(id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES($1,$2,'INSPECTION_CREATED','Inspection',$3,$4,$5)",
      params: [
        crypto.randomUUID(),
        actor.id,
        inspectionId,
        timestamp,
        JSON.stringify({
          orderId,
          scheduledStartAt: data.scheduledStartAt,
          scheduledEndAt: data.scheduledEndAt,
          conflictOverridden: data.conflictOverridden,
        }),
      ],
    },
  ]);
  return getOrder(actor, orderId);
}

export async function updateOrder(
  actor: AuthUser,
  id: string,
  input: OrderInput,
) {
  await assertModuleAction(actor, "orders", "orders.edit");
  const before = await visibleOrder(actor, id),
    timestamp = now(),
    action = clean(input.action, 40);
  if (action === "START") {
    if (!["NEW", "SCHEDULED"].includes(before.status))
      throw new OrderError(
        "Начать можно только новый или назначенный заказ.",
        409,
      );
    await transaction([
      {
        text: "UPDATE orders SET status='IN_PROGRESS',started_at=$1,updated_at=$2 WHERE id=$3",
        params: [timestamp, timestamp, id],
      },
      {
        text: "INSERT INTO audit_logs(id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES($1,$2,'INSPECTION_STARTED','Order',$3,$4,'{}')",
        params: [crypto.randomUUID(), actor.id, id, timestamp],
      },
    ]);
    return getOrder(actor, id);
  }
  if (action === "COMPLETE") {
    if (before.status !== "IN_PROGRESS")
      throw new OrderError("Сначала начните приёмку.", 409);
    await transaction([
      {
        text: "UPDATE orders SET status='COMPLETED',completed_at=$1,updated_at=$2 WHERE id=$3",
        params: [timestamp, timestamp, id],
      },
      {
        text: "INSERT INTO audit_logs(id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES($1,$2,'INSPECTION_COMPLETED','Order',$3,$4,$5)",
        params: [
          crypto.randomUUID(),
          actor.id,
          id,
          timestamp,
          JSON.stringify({
            defectCount: Number(before.defect_count),
            photoCount: Number(before.photo_count),
          }),
        ],
      },
    ]);
    return getOrder(actor, id);
  }
  if (action === "CANCEL") {
    if (["COMPLETED", "CANCELLED"].includes(before.status))
      throw new OrderError("Этот заказ уже закрыт.", 409);
    await transaction([
      {
        text: "UPDATE orders SET status='CANCELLED',cancelled_at=$1,updated_at=$2 WHERE id=$3",
        params: [timestamp, timestamp, id],
      },
      {
        text: "INSERT INTO audit_logs(id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES($1,$2,'ORDER_CANCELLED','Order',$3,$4,'{}')",
        params: [crypto.randomUUID(), actor.id, id, timestamp],
      },
    ]);
    return getOrder(actor, id);
  }
  const responsibleUserId =
      clean(input.responsibleUserId, 100) || before.responsible_user_id,
    inspectorUserId =
      clean(input.inspectorUserId, 100) || before.inspector_user_id,
    address =
      input.address === undefined ? before.address : clean(input.address, 500),
    apartmentNumber =
      input.apartmentNumber === undefined
        ? before.apartment_number
        : clean(input.apartmentNumber, 80);
  if (!address || !apartmentNumber || !inspectorUserId)
    throw new OrderError("Заполните адрес, квартиру, дату и специалиста.");
  await Promise.all([
    assertOrderUser(responsibleUserId),
    assertOrderUser(inspectorUserId),
  ]);
  const schedule = scheduleValues(
      input,
      before.scheduled_start_at ?? before.scheduled_at,
      before.scheduled_end_at ??
        (before.scheduled_start_at ?? before.scheduled_at ?? 0) + 5400,
    ),
    scheduleChanged =
      input.scheduledStartAt !== undefined ||
      input.scheduledEndAt !== undefined ||
      input.scheduledAt !== undefined ||
      input.inspectorUserId !== undefined;
  const conflictOverridden = scheduleChanged
    ? await requireConflictConfirmation(
        actor,
        input,
        inspectorUserId,
        schedule.scheduledStartAt,
        schedule.scheduledEndAt,
        id,
      )
    : false;
  const price =
    input.price === undefined
      ? Number(before.amount_kopecks)
      : parseAmountKopecks(input.price);
  if (!price) throw new OrderError("Стоимость должна быть больше нуля.");
  const resultComment =
      input.resultComment === undefined
        ? before.result_comment
        : clean(input.resultComment, 6000),
    metadata = JSON.stringify({
      scheduleChanged,
      scheduledStartAt: schedule.scheduledStartAt,
      scheduledEndAt: schedule.scheduledEndAt,
      inspectorUserId,
      conflictOverridden,
    });
  await transaction([
    {
      text: `UPDATE orders SET amount_kopecks=$1,responsible_user_id=$2,scheduled_at=$3,comment=$4,internal_comment=$5,updated_at=$6 WHERE id=$7`,
      params: [
        price,
        responsibleUserId,
        schedule.scheduledStartAt,
        input.comment === undefined
          ? before.comment
          : clean(input.comment, 3000),
        input.internalComment === undefined
          ? before.internal_comment
          : clean(input.internalComment, 3000),
        timestamp,
        id,
      ],
    },
    {
      text: `UPDATE inspections SET residential_complex=$1,address=$2,apartment_number=$3,area_sqm=$4,scheduled_at=$5,scheduled_start_at=$5,scheduled_end_at=$6,inspector_user_id=$7,result_comment=$8,updated_at=$9 WHERE order_id=$10`,
      params: [
        input.residentialComplex === undefined
          ? before.residential_complex
          : clean(input.residentialComplex, 240),
        address,
        apartmentNumber,
        input.areaSqm === undefined
          ? before.area_sqm == null
            ? null
            : Number(before.area_sqm)
          : area(input.areaSqm),
        schedule.scheduledStartAt,
        schedule.scheduledEndAt,
        inspectorUserId,
        resultComment,
        timestamp,
        id,
      ],
    },
    {
      text: "INSERT INTO audit_logs(id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES($1,$2,'ORDER_UPDATED','Order',$3,$4,$5)",
      params: [crypto.randomUUID(), actor.id, id, timestamp, metadata],
    },
  ]);
  return getOrder(actor, id);
}

export async function createDefect(
  actor: AuthUser,
  orderId: string,
  input: OrderInput,
) {
  await assertModuleAction(actor, "orders", "orders.edit");
  const order = await visibleOrder(actor, orderId);
  if (!order.inspection_id) throw new OrderError("Приёмка не найдена.", 404);
  const room = clean(input.room, 120),
    category = clean(input.category, 40),
    description = clean(input.description, 3000),
    severity = clean(input.severity, 20) || "MEDIUM";
  if (!room || !description)
    throw new OrderError("Укажите помещение и описание замечания.");
  if (!DEFECT_CATEGORIES.some(([id]) => id === category))
    throw new OrderError("Выберите категорию.");
  if (!DEFECT_SEVERITIES.some(([id]) => id === severity))
    throw new OrderError("Выберите критичность.");
  const id = crypto.randomUUID(),
    timestamp = now();
  await transaction([
    {
      text: "INSERT INTO inspection_defects(id,inspection_id,room,category,description,severity,status,created_by_user_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'OPEN',$7,$8,$9)",
      params: [
        id,
        order.inspection_id,
        room,
        category,
        description,
        severity,
        actor.id,
        timestamp,
        timestamp,
      ],
    },
    {
      text: "INSERT INTO audit_logs(id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES($1,$2,'INSPECTION_DEFECT_CREATED','InspectionDefect',$3,$4,$5)",
      params: [
        crypto.randomUUID(),
        actor.id,
        id,
        timestamp,
        JSON.stringify({ orderId, inspectionId: order.inspection_id }),
      ],
    },
  ]);
  return getOrder(actor, orderId);
}
export async function updateDefect(
  actor: AuthUser,
  orderId: string,
  defectId: string,
  input: OrderInput,
) {
  await assertModuleAction(actor, "orders", "orders.edit");
  const order = await visibleOrder(actor, orderId);
  const defect = await first<{ id: string; status: string }>(
    "SELECT id,status FROM inspection_defects WHERE id=$1 AND inspection_id=$2",
    [defectId, order.inspection_id],
  );
  if (!defect) throw new OrderError("Замечание не найдено.", 404);
  const status = clean(input.status, 20);
  if (!status || !["OPEN", "RESOLVED"].includes(status))
    throw new OrderError("Некорректный статус замечания.");
  const timestamp = now();
  await transaction([
    {
      text: "UPDATE inspection_defects SET status=$1,updated_at=$2 WHERE id=$3",
      params: [status, timestamp, defectId],
    },
    {
      text: "INSERT INTO audit_logs(id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES($1,$2,'INSPECTION_DEFECT_STATUS_CHANGED','InspectionDefect',$3,$4,$5)",
      params: [
        crypto.randomUUID(),
        actor.id,
        defectId,
        timestamp,
        JSON.stringify({ orderId, from: defect.status, to: status }),
      ],
    },
  ]);
  return getOrder(actor, orderId);
}
export async function linkInspectionAttachment(
  actor: AuthUser,
  orderId: string,
  input: OrderInput,
) {
  await assertModuleAction(actor, "documents", "documents.upload");
  const order = await visibleOrder(actor, orderId);
  if (!order.inspection_id) throw new OrderError("Приёмка не найдена.", 404);
  const attachmentId = clean(input.attachmentId, 100),
    defectId = clean(input.defectId, 100),
    entityType = defectId ? "InspectionDefect" : "Inspection",
    entityId = defectId || order.inspection_id;
  if (!attachmentId) throw new OrderError("Файл не найден.");
  if (
    defectId &&
    !(await first<{ id: string }>(
      "SELECT id FROM inspection_defects WHERE id=$1 AND inspection_id=$2",
      [defectId, order.inspection_id],
    ))
  )
    throw new OrderError("Замечание не найдено.", 404);
  let attachment;
  try {
    attachment = await confirmAttachmentUpload(actor, attachmentId);
  } catch (error) {
    if (error instanceof FileError)
      throw new OrderError(error.message, error.status);
    throw error;
  }
  if (
    attachment.category !== "INSPECTION" ||
    attachment.entity_type !== entityType ||
    attachment.entity_id !== entityId
  )
    throw new OrderError("Файл загружен для другой сущности.", 409);
  const timestamp = now();
  await transaction([
    {
      text: "UPDATE attachments SET upload_status='LINKED',linked_at=$1,updated_at=$2 WHERE id=$3 AND uploaded_by_user_id=$4 AND upload_status='UPLOADED'",
      params: [timestamp, timestamp, attachmentId, actor.id],
    },
    {
      text: "INSERT INTO audit_logs(id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES($1,$2,'ATTACHMENT_LINKED','Attachment',$3,$4,$5)",
      params: [
        crypto.randomUUID(),
        actor.id,
        attachmentId,
        timestamp,
        JSON.stringify({
          orderId,
          inspectionId: order.inspection_id,
          defectId,
        }),
      ],
    },
  ]);
  return getOrder(actor, orderId);
}
