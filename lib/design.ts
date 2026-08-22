import type { AuthUser } from "./auth";
import { confirmAttachmentUpload, FileError } from "./files";
import { parseAmountKopecks } from "./finance-rules";
import { first, query, transaction } from "./postgres";
import {
  AccessError,
  assertModuleAction,
  canViewDesignProject,
  getAccessProfile,
} from "./permissions";

export const DESIGN_STATUSES = [
  ["PLANNING", "Подготовка"],
  ["IN_PROGRESS", "В работе"],
  ["WAITING_CLIENT", "Ожидает клиента"],
  ["COMPLETED", "Завершён"],
  ["PAUSED", "Приостановлен"],
  ["CANCELLED", "Отменён"],
] as const;

export const DESIGN_STAGE_STATUSES = [
  ["NOT_STARTED", "Не начат"],
  ["IN_PROGRESS", "В работе"],
  ["WAITING_CLIENT", "Ожидает клиента"],
  ["COMPLETED", "Завершён"],
] as const;

export const DEFAULT_DESIGN_STAGES = [
  "Обмеры",
  "Планировочное решение",
  "Концепция",
  "Визуализации",
  "Рабочая документация",
  "Комплектация",
] as const;

export const DESIGN_FILE_CATEGORIES = [
  ["MEASUREMENT_PLAN", "Обмерный план"],
  ["LAYOUT", "Планировка"],
  ["CONCEPT", "Концепция"],
  ["VISUALIZATION", "Визуализации"],
  ["WORKING_DRAWINGS", "Рабочая документация"],
  ["SPECIFICATION", "Спецификации"],
  ["FINAL_ALBUM", "Финальный альбом"],
  ["OTHER", "Другое"],
] as const;

type DesignStatus = (typeof DESIGN_STATUSES)[number][0];
type StageStatus = (typeof DESIGN_STAGE_STATUSES)[number][0];
export type DesignInput = Record<string, unknown>;

type DesignRow = {
  id: string;
  order_id: string;
  order_number: string;
  client_id: string;
  client_name: string;
  client_phone: string;
  price_kopecks: number | string;
  paid_kopecks: number | string;
  order_status: string;
  responsible_user_id: string;
  responsible_name: string;
  source_lead_id: string | null;
  source_order_id: string | null;
  residential_complex: string | null;
  residential_complex_id: string | null;
  address: string;
  apartment_number: string;
  area_sqm: string | number | null;
  designer_employee_id: string | null;
  designer_name: string | null;
  planned_start_date: number | null;
  planned_end_date: number | null;
  actual_end_date: number | null;
  status: DesignStatus;
  order_comment: string | null;
  comment: string | null;
  created_at: number;
  updated_at: number;
};

export class DesignError extends Error {
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
const area = (value: unknown) => {
  if (value == null || value === "") return null;
  const parsed = Number(String(value).replace(",", "."));
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100000)
    throw new DesignError("Проверьте площадь квартиры.");
  return Math.round(parsed * 100) / 100;
};
const dateSeconds = (value: unknown) => {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value))
    return Math.floor(value);
  const text = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text))
    throw new DesignError("Проверьте дату.");
  const parsed = Date.parse(`${text}T00:00:00+10:00`);
  if (!Number.isFinite(parsed)) throw new DesignError("Проверьте дату.");
  return Math.floor(parsed / 1000);
};
function assertDateOrder(start: number | null, end: number | null) {
  if (start != null && end != null && end < start)
    throw new DesignError("Дата завершения не может быть раньше даты начала.");
}

function designSelect() {
  return `SELECT dp.id,dp.order_id,o.number order_number,o.client_id,c.name client_name,c.phone client_phone,o.amount_kopecks price_kopecks,
    COALESCE((SELECT SUM(ft.amount_kopecks) FROM financial_transactions ft WHERE ft.order_id=o.id AND ft.type='INCOME'),0) paid_kopecks,
    o.status order_status,o.responsible_user_id,ru.display_name responsible_name,o.source_lead_id,o.source_order_id,
    dp.residential_complex,dp.residential_complex_id,dp.address,dp.apartment_number,dp.area_sqm,dp.designer_employee_id,de.full_name designer_name,
    dp.planned_start_date,dp.planned_end_date,dp.actual_end_date,dp.status,o.comment order_comment,dp.comment,dp.created_at,dp.updated_at
    FROM design_projects dp JOIN orders o ON o.id=dp.order_id JOIN clients c ON c.id=o.client_id
    JOIN users ru ON ru.id=o.responsible_user_id LEFT JOIN employees de ON de.id=dp.designer_employee_id`;
}

function orderStatusForDesign(status: DesignStatus) {
  if (status === "COMPLETED") return "COMPLETED";
  if (status === "CANCELLED") return "CANCELLED";
  if (status === "PLANNING") return "NEW";
  return "IN_PROGRESS";
}

async function assertOrderUser(id: string) {
  const row = await first<{ id: string }>(
    `SELECT u.id FROM users u WHERE u.id=$1 AND u.status='ACTIVE' AND
      (u.role='OWNER' OR EXISTS(SELECT 1 FROM user_permissions p WHERE p.user_id=u.id AND p.permission='modules.orders.view' AND p.scope='COMPANY' AND p.allowed=1)) LIMIT 1`,
    [id],
  );
  if (!row)
    throw new DesignError(
      "Выбранный пользователь не может работать с заказами.",
    );
}

async function assertClient(actor: AuthUser, clientId: string) {
  const access = await getAccessProfile(actor);
  const assigned = actor.role !== "OWNER" && access.scopes.clients !== "ALL";
  const row = await first<{ id: string }>(
    `SELECT id FROM clients WHERE id=$1 AND status='ACTIVE'${assigned ? " AND responsible_user_id=$2" : ""} LIMIT 1`,
    assigned ? [clientId, actor.id] : [clientId],
  );
  if (!row) throw new AccessError("Клиент не найден или недоступен.", 403);
}

async function assertDesigner(employeeId: string | null) {
  if (!employeeId) return;
  const row = await first<{ id: string }>(
    "SELECT id FROM employees WHERE id=$1 AND status='ACTIVE' LIMIT 1",
    [employeeId],
  );
  if (!row) throw new DesignError("Выбранный дизайнер недоступен.");
}

export async function assertOrderSourceRelations(
  actor: AuthUser,
  clientId: string,
  sourceLeadId: string | null,
  sourceOrderId: string | null,
) {
  if (sourceLeadId) {
    const lead = await first<{
      linked_client_id: string | null;
      responsible_user_id: string;
      stage: string;
    }>(
      "SELECT linked_client_id,responsible_user_id,stage FROM leads WHERE id=$1 LIMIT 1",
      [sourceLeadId],
    );
    if (!lead || lead.linked_client_id !== clientId)
      throw new DesignError(
        "Исходная заявка не связана с выбранным клиентом.",
        409,
      );
    const access = await getAccessProfile(actor);
    if (
      actor.role !== "OWNER" &&
      (!access.modules.crm ||
        !access.actions["crm.view"] ||
        (access.scopes.crm !== "ALL" && lead.responsible_user_id !== actor.id))
    )
      throw new AccessError("Нет доступа к исходной заявке.", 403);
    if (lead.stage !== "WON")
      throw new DesignError(
        "Создать заказ из CRM можно только из успешной заявки.",
        409,
      );
  }
  if (sourceOrderId) {
    const source = await first<{
      client_id: string;
      responsible_user_id: string;
      inspector_user_id: string | null;
      designer_user_id: string | null;
    }>(
      `SELECT o.client_id,o.responsible_user_id,i.inspector_user_id,du.id designer_user_id
        FROM orders o LEFT JOIN inspections i ON i.order_id=o.id LEFT JOIN design_projects dp ON dp.order_id=o.id
        LEFT JOIN users du ON du.employee_id=dp.designer_employee_id WHERE o.id=$1 LIMIT 1`,
      [sourceOrderId],
    );
    if (!source || source.client_id !== clientId)
      throw new DesignError("Исходный заказ относится к другому клиенту.", 409);
    const access = await getAccessProfile(actor);
    if (
      actor.role !== "OWNER" &&
      access.scopes.orders !== "ALL" &&
      ![
        source.responsible_user_id,
        source.inspector_user_id,
        source.designer_user_id,
      ].includes(actor.id)
    )
      throw new AccessError("Нет доступа к исходному заказу.", 403);
  }
}

async function nextOrderNumber() {
  const sequence = await first<{ value: string | number }>(
    "SELECT nextval('depa_order_number_seq') value",
  );
  return `ORD-${String(sequence?.value || 1).padStart(6, "0")}`;
}

function audit(
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  timestamp: number,
  metadata: Record<string, unknown>,
) {
  return {
    text: "INSERT INTO audit_logs(id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES($1,$2,$3,$4,$5,$6,$7)",
    params: [
      crypto.randomUUID(),
      actorId,
      action,
      entityType,
      entityId,
      timestamp,
      JSON.stringify(metadata),
    ],
  };
}

function event(
  actorId: string,
  type: string,
  designProjectId: string,
  orderId: string,
  timestamp: number,
  metadata: Record<string, unknown> = {},
) {
  return {
    text: "INSERT INTO design_project_events(id,design_project_id,order_id,actor_user_id,type,occurred_at,metadata_json) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)",
    params: [
      crypto.randomUUID(),
      designProjectId,
      orderId,
      actorId,
      type,
      timestamp,
      JSON.stringify(metadata),
    ],
  };
}

export async function listDesigners() {
  return query<{ id: string; name: string; userId: string | null }>(
    `SELECT e.id,e.full_name name,u.id "userId" FROM employees e LEFT JOIN users u ON u.employee_id=e.id AND u.status='ACTIVE'
      WHERE e.status='ACTIVE' ORDER BY e.full_name`,
  );
}

async function listDesignUsers() {
  return query<{ id: string; name: string }>(
    `SELECT u.id,u.display_name name FROM users u WHERE u.status='ACTIVE' AND
      (u.role='OWNER' OR EXISTS(SELECT 1 FROM user_permissions p WHERE p.user_id=u.id
        AND p.permission='modules.orders.view' AND p.scope='COMPANY' AND p.allowed=1))
      ORDER BY CASE WHEN u.role='OWNER' THEN 0 ELSE 1 END,u.display_name`,
  );
}

export async function createDesignOrder(actor: AuthUser, input: DesignInput) {
  await assertModuleAction(actor, "orders", "orders.create");
  await assertModuleAction(actor, "orders", "design.create");
  const clientId = clean(input.clientId, 100);
  const responsibleUserId = clean(input.responsibleUserId, 100) || actor.id;
  const designerEmployeeId = clean(input.designerEmployeeId, 100);
  const address = clean(input.address, 500);
  const apartmentNumber = clean(input.apartmentNumber, 80);
  const priceKopecks = parseAmountKopecks(input.price);
  const sourceLeadId = clean(input.sourceLeadId, 100);
  const sourceOrderId = clean(input.sourceOrderId, 100);
  if (!clientId) throw new DesignError("Выберите клиента.");
  if (!address) throw new DesignError("Укажите адрес.");
  if (!apartmentNumber) throw new DesignError("Укажите квартиру.");
  if (!priceKopecks)
    throw new DesignError("Стоимость должна быть больше нуля.");
  await Promise.all([
    assertClient(actor, clientId),
    assertOrderUser(responsibleUserId),
    assertDesigner(designerEmployeeId),
    assertOrderSourceRelations(actor, clientId, sourceLeadId, sourceOrderId),
  ]);
  const duplicate = await first<{
    order_id: string;
    number: string;
  }>(
    `SELECT o.id order_id,o.number FROM design_projects dp JOIN orders o ON o.id=dp.order_id
      WHERE o.client_id=$1 AND lower(dp.address)=lower($2) AND lower(dp.apartment_number)=lower($3)
      AND o.status NOT IN ('COMPLETED','CANCELLED') ORDER BY o.created_at DESC LIMIT 1`,
    [clientId, address, apartmentNumber],
  );
  if (duplicate && input.allowDuplicate !== true)
    throw new DesignError("Возможный дубль дизайн-проекта.", 409, {
      code: "POSSIBLE_DUPLICATE",
      duplicate: {
        orderId: duplicate.order_id,
        orderNumber: duplicate.number,
      },
    });
  const orderId = crypto.randomUUID();
  const designProjectId = crypto.randomUUID();
  const timestamp = now();
  const number = await nextOrderNumber();
  const plannedStartDate = dateSeconds(input.plannedStartDate);
  const plannedEndDate = dateSeconds(input.plannedEndDate);
  assertDateOrder(plannedStartDate, plannedEndDate);
  const statements = [
    {
      text: `INSERT INTO orders(id,number,client_id,type,title,amount_kopecks,status,responsible_user_id,comment,internal_comment,created_by_user_id,source_lead_id,source_order_id,created_at,updated_at)
        VALUES($1,$2,$3,'DESIGN','Дизайн-проект',$4,'NEW',$5,$6,$7,$8,$9,$10,$11,$12)`,
      params: [
        orderId,
        number,
        clientId,
        priceKopecks,
        responsibleUserId,
        clean(input.comment, 3000),
        clean(input.internalComment, 3000),
        actor.id,
        sourceLeadId,
        sourceOrderId,
        timestamp,
        timestamp,
      ],
    },
    {
      text: `INSERT INTO design_projects(id,order_id,residential_complex,address,apartment_number,area_sqm,designer_employee_id,planned_start_date,planned_end_date,status,comment,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'PLANNING',$10,$11,$12)`,
      params: [
        designProjectId,
        orderId,
        clean(input.residentialComplex, 240),
        address,
        apartmentNumber,
        area(input.areaSqm),
        designerEmployeeId,
        plannedStartDate,
        plannedEndDate,
        clean(input.designComment, 3000),
        timestamp,
        timestamp,
      ],
    },
    ...DEFAULT_DESIGN_STAGES.map((name, position) => ({
      text: `INSERT INTO design_project_stages(id,design_project_id,name,position,status,created_at,updated_at)
        VALUES($1,$2,$3,$4,'NOT_STARTED',$5,$6)`,
      params: [
        crypto.randomUUID(),
        designProjectId,
        name,
        position,
        timestamp,
        timestamp,
      ],
    })),
    audit(actor.id, "ORDER_CREATED", "Order", orderId, timestamp, {
      type: "DESIGN",
      number,
      clientId,
      sourceLeadId,
      sourceOrderId,
    }),
    audit(
      actor.id,
      "DESIGN_PROJECT_CREATED",
      "DesignProject",
      designProjectId,
      timestamp,
      { orderId, designerEmployeeId },
    ),
    event(
      actor.id,
      "DESIGN_PROJECT_CREATED",
      designProjectId,
      orderId,
      timestamp,
      {
        number,
      },
    ),
  ];
  await transaction(statements);
  return getDesignProject(actor, orderId);
}

export async function createRenovationOrder(
  actor: AuthUser,
  input: DesignInput,
) {
  await assertModuleAction(actor, "orders", "orders.create");
  const clientId = clean(input.clientId, 100);
  const responsibleUserId = clean(input.responsibleUserId, 100) || actor.id;
  const address = clean(input.address, 500);
  const apartmentNumber = clean(input.apartmentNumber, 80);
  const priceKopecks = parseAmountKopecks(input.price);
  const sourceLeadId = clean(input.sourceLeadId, 100);
  const sourceOrderId = clean(input.sourceOrderId, 100);
  if (!clientId || !address || !apartmentNumber)
    throw new DesignError("Выберите клиента и заполните адрес ремонта.");
  if (!priceKopecks)
    throw new DesignError("Стоимость должна быть больше нуля.");
  await Promise.all([
    assertClient(actor, clientId),
    assertOrderUser(responsibleUserId),
    assertOrderSourceRelations(actor, clientId, sourceLeadId, sourceOrderId),
  ]);
  const sourceOrder = sourceOrderId
    ? await first<{ type: string; design_project_id: string | null }>(
        `SELECT o.type,dp.id design_project_id FROM orders o
          LEFT JOIN design_projects dp ON dp.order_id=o.id WHERE o.id=$1 LIMIT 1`,
        [sourceOrderId],
      )
    : null;
  const orderId = crypto.randomUUID();
  const detailId = crypto.randomUUID();
  const timestamp = now();
  const number = await nextOrderNumber();
  await transaction([
    {
      text: `INSERT INTO orders(id,number,client_id,type,title,amount_kopecks,status,responsible_user_id,comment,internal_comment,created_by_user_id,source_lead_id,source_order_id,created_at,updated_at)
        VALUES($1,$2,$3,'RENOVATION','Ремонт квартиры',$4,'NEW',$5,$6,$7,$8,$9,$10,$11,$12)`,
      params: [
        orderId,
        number,
        clientId,
        priceKopecks,
        responsibleUserId,
        clean(input.comment, 3000),
        clean(input.internalComment, 3000),
        actor.id,
        sourceLeadId,
        sourceOrderId,
        timestamp,
        timestamp,
      ],
    },
    {
      text: `INSERT INTO renovation_order_details(id,order_id,residential_complex,address,apartment_number,area_sqm,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      params: [
        detailId,
        orderId,
        clean(input.residentialComplex, 240),
        address,
        apartmentNumber,
        area(input.areaSqm),
        timestamp,
        timestamp,
      ],
    },
    audit(actor.id, "ORDER_CREATED", "Order", orderId, timestamp, {
      type: "RENOVATION",
      number,
      clientId,
      sourceLeadId,
      sourceOrderId,
      projectCreated: false,
    }),
    ...(sourceOrderId
      ? [
          audit(
            actor.id,
            sourceOrder?.type === "DESIGN"
              ? "DESIGN_TO_RENOVATION_CREATED"
              : "ORDER_SOURCE_LINKED",
            "Order",
            orderId,
            timestamp,
            { sourceOrderId },
          ),
          ...(sourceOrder?.type === "DESIGN" && sourceOrder.design_project_id
            ? [
                event(
                  actor.id,
                  "DESIGN_TO_RENOVATION_CREATED",
                  sourceOrder.design_project_id,
                  sourceOrderId,
                  timestamp,
                  { renovationOrderId: orderId },
                ),
              ]
            : []),
        ]
      : []),
  ]);
  return { orderId, orderNumber: number, projectId: null };
}

async function visibleDesign(actor: AuthUser, orderId: string) {
  await assertModuleAction(actor, "orders", "orders.view");
  await assertModuleAction(actor, "orders", "design.view");
  const row = await first<DesignRow>(
    `${designSelect()} WHERE o.id=$1 AND o.type='DESIGN' LIMIT 1`,
    [orderId],
  );
  if (!row) {
    const exists = await first<{ id: string }>(
      "SELECT id FROM orders WHERE id=$1 LIMIT 1",
      [orderId],
    );
    throw new AccessError(
      exists ? "Дизайн-проект не найден для этого заказа." : "Заказ не найден.",
      404,
    );
  }
  if (!(await canViewDesignProject(actor, row.id)))
    throw new AccessError("Нет доступа к этому дизайн-проекту.", 403);
  return row;
}

export async function getDesignProject(actor: AuthUser, orderId: string) {
  const row = await visibleDesign(actor, orderId);
  const access = await getAccessProfile(actor);
  const canViewStages =
    actor.role === "OWNER" || access.actions["design.stages.view"];
  const canViewFiles =
    actor.role === "OWNER" || access.actions["design.files.view"];
  const canViewFinance =
    actor.role === "OWNER" || access.actions["design.viewFinance"];
  const [stages, files, finances, history, projectLink] = await Promise.all([
    canViewStages
      ? query<{
          id: string;
          name: string;
          position: number;
          status: StageStatus;
          plannedStartDate: number | null;
          plannedEndDate: number | null;
          completedAt: number | null;
          responsibleUserId: string | null;
          responsibleName: string | null;
          comment: string | null;
        }>(
          `SELECT ds.id,ds.name,ds.position,ds.status,ds.planned_start_date "plannedStartDate",ds.planned_end_date "plannedEndDate",
            ds.completed_at "completedAt",ds.responsible_user_id "responsibleUserId",u.display_name "responsibleName",ds.comment
            FROM design_project_stages ds LEFT JOIN users u ON u.id=ds.responsible_user_id
            WHERE ds.design_project_id=$1 AND ds.archived_at IS NULL ORDER BY ds.position,ds.created_at`,
          [row.id],
        )
      : Promise.resolve([]),
    canViewFiles
      ? query<{
          id: string;
          logicalName: string;
          category: string;
          originalFilename: string;
          mimeType: string;
          version: number;
          isCurrent: number;
          designStageId: string | null;
          previousVersionId: string | null;
          createdAt: number;
          uploadedByName: string;
        }>(
          `SELECT a.id,a.logical_name "logicalName",a.category,a.original_filename "originalFilename",a.mime_type "mimeType",
            a.version,a.is_current "isCurrent",a.design_stage_id "designStageId",a.previous_version_id "previousVersionId",
            a.created_at "createdAt",u.display_name "uploadedByName"
            FROM attachments a JOIN users u ON u.id=a.uploaded_by_user_id
            WHERE a.design_project_id=$1 AND a.upload_status='LINKED' AND a.deleted_at IS NULL AND a.archived_at IS NULL
            ORDER BY a.category,a.logical_name,a.version DESC`,
          [row.id],
        )
      : Promise.resolve([]),
    canViewFinance
      ? query<{
          id: string;
          amountKopecks: number;
          transactionDate: number;
          title: string;
          cashboxName: string;
        }>(
          `SELECT ft.id,ft.amount_kopecks "amountKopecks",ft.transaction_date "transactionDate",ft.title,cb.name "cashboxName"
            FROM financial_transactions ft JOIN cashboxes cb ON cb.id=ft.cashbox_id
            WHERE ft.order_id=$1 AND ft.type='INCOME' ORDER BY ft.transaction_date DESC,ft.created_at DESC`,
          [orderId],
        )
      : Promise.resolve([]),
    query<{
      id: string;
      type: string;
      occurredAt: number;
      actorName: string;
      metadata: Record<string, unknown>;
    }>(
      `SELECT e.id,e.type,e.occurred_at "occurredAt",u.display_name "actorName",e.metadata_json metadata
        FROM design_project_events e JOIN users u ON u.id=e.actor_user_id WHERE e.design_project_id=$1
        ORDER BY e.occurred_at DESC,e.id DESC LIMIT 200`,
      [row.id],
    ),
    first<{ id: string }>("SELECT id FROM projects WHERE order_id=$1 LIMIT 1", [
      orderId,
    ]),
  ]);
  const completedStages = stages.filter(
    (stage) => stage.status === "COMPLETED",
  ).length;
  const price = Number(row.price_kopecks);
  const paid = Number(row.paid_kopecks);
  return {
    order: {
      id: row.order_id,
      orderNumber: row.order_number,
      clientId: row.client_id,
      clientName: row.client_name,
      clientPhone: row.client_phone,
      status: row.order_status,
      responsibleUserId: row.responsible_user_id,
      responsibleName: row.responsible_name,
      sourceLeadId: row.source_lead_id,
      sourceOrderId: row.source_order_id,
      comment: row.order_comment,
      priceKopecks: canViewFinance ? price : null,
      paidKopecks: canViewFinance ? paid : null,
      remainingKopecks: canViewFinance ? Math.max(price - paid, 0) : null,
      overpaymentKopecks: canViewFinance ? Math.max(paid - price, 0) : null,
    },
    design: {
      id: row.id,
      residentialComplex: row.residential_complex,
      residentialComplexId: row.residential_complex_id,
      address: row.address,
      apartmentNumber: row.apartment_number,
      areaSqm: row.area_sqm == null ? null : Number(row.area_sqm),
      designerEmployeeId: row.designer_employee_id,
      designerName: row.designer_name,
      plannedStartDate: row.planned_start_date,
      plannedEndDate: row.planned_end_date,
      actualEndDate: row.actual_end_date,
      status: row.status,
      comment: row.comment,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      projectId: projectLink?.id ?? null,
    },
    stages,
    progress: {
      total: stages.length,
      completed: completedStages,
      percent: stages.length
        ? Math.round((completedStages / stages.length) * 100)
        : 0,
    },
    files,
    fileCategories: DESIGN_FILE_CATEGORIES,
    finances,
    history,
    designers: await listDesigners(),
    responsibleUsers: await listDesignUsers(),
    capabilities: {
      edit: actor.role === "OWNER" || access.actions["design.edit"],
      assignDesigner:
        actor.role === "OWNER" || access.actions["design.assignDesigner"],
      assignResponsible:
        actor.role === "OWNER" || access.actions["orders.edit"],
      viewStages: canViewStages,
      manageStages:
        actor.role === "OWNER" || access.actions["design.stages.edit"],
      completeStages:
        actor.role === "OWNER" || access.actions["design.stages.complete"],
      viewFiles: canViewFiles,
      uploadFiles:
        actor.role === "OWNER" || access.actions["design.files.upload"],
      manageVersions:
        actor.role === "OWNER" || access.actions["design.files.manageVersions"],
      archiveFiles:
        actor.role === "OWNER" || access.actions["design.files.archive"],
      viewFinance: canViewFinance,
      addPayment:
        canViewFinance &&
        access.modules.finance &&
        access.actions["finance.createIncome"] &&
        access.ownCashbox,
      complete: actor.role === "OWNER" || access.actions["design.complete"],
      cancel: actor.role === "OWNER" || access.actions["orders.cancel"],
      createRenovation:
        (actor.role === "OWNER" || access.actions["orders.create"]) &&
        row.status === "COMPLETED",
    },
  };
}

async function writeDesignAudit(
  actor: AuthUser,
  row: DesignRow,
  action: string,
  metadata: Record<string, unknown>,
  statements: { text: string; params: unknown[] }[],
  timestamp = now(),
) {
  statements.push(
    audit(actor.id, action, "DesignProject", row.id, timestamp, {
      orderId: row.order_id,
      ...metadata,
    }),
    event(actor.id, action, row.id, row.order_id, timestamp, metadata),
  );
}

export async function updateDesignProject(
  actor: AuthUser,
  orderId: string,
  input: DesignInput,
) {
  const row = await visibleDesign(actor, orderId);
  const action = clean(input.action, 50);
  const access = await getAccessProfile(actor);
  const timestamp = now();
  if (action === "CREATE_STAGE") {
    await assertModuleAction(actor, "orders", "design.stages.edit");
    const name = clean(input.name, 180);
    if (!name) throw new DesignError("Укажите название этапа.");
    const stageResponsibleUserId = clean(input.responsibleUserId, 100);
    if (stageResponsibleUserId) await assertOrderUser(stageResponsibleUserId);
    const plannedStartDate = dateSeconds(input.plannedStartDate);
    const plannedEndDate = dateSeconds(input.plannedEndDate);
    assertDateOrder(plannedStartDate, plannedEndDate);
    const positionRow = await first<{ position: number | string }>(
      "SELECT COALESCE(MAX(position),-1)+1 position FROM design_project_stages WHERE design_project_id=$1 AND archived_at IS NULL",
      [row.id],
    );
    const stageId = crypto.randomUUID();
    const statements = [
      {
        text: `INSERT INTO design_project_stages(id,design_project_id,name,position,status,planned_start_date,planned_end_date,responsible_user_id,comment,created_at,updated_at)
          VALUES($1,$2,$3,$4,'NOT_STARTED',$5,$6,$7,$8,$9,$10)`,
        params: [
          stageId,
          row.id,
          name,
          Number(positionRow?.position ?? 0),
          plannedStartDate,
          plannedEndDate,
          stageResponsibleUserId,
          clean(input.comment, 2000),
          timestamp,
          timestamp,
        ],
      },
    ];
    await writeDesignAudit(
      actor,
      row,
      "DESIGN_STAGE_CREATED",
      { stageId, name },
      statements,
      timestamp,
    );
    await transaction(statements);
    return getDesignProject(actor, orderId);
  }
  if (
    ["UPDATE_STAGE", "COMPLETE_STAGE", "ARCHIVE_STAGE", "MOVE_STAGE"].includes(
      action || "",
    )
  ) {
    const stageId = clean(input.stageId, 100);
    if (!stageId) throw new DesignError("Этап не найден.");
    const stage = await first<{
      id: string;
      name: string;
      status: StageStatus;
      position: number;
      completed_at: number | null;
      planned_start_date: number | null;
      planned_end_date: number | null;
      responsible_user_id: string | null;
      comment: string | null;
    }>(
      "SELECT id,name,status,position,completed_at,planned_start_date,planned_end_date,responsible_user_id,comment FROM design_project_stages WHERE id=$1 AND design_project_id=$2 AND archived_at IS NULL LIMIT 1",
      [stageId, row.id],
    );
    if (!stage) throw new DesignError("Этап не найден.", 404);
    if (action === "COMPLETE_STAGE")
      await assertModuleAction(actor, "orders", "design.stages.complete");
    else await assertModuleAction(actor, "orders", "design.stages.edit");
    const statements: { text: string; params: unknown[] }[] = [];
    let auditAction = "DESIGN_STAGE_UPDATED";
    let metadata: Record<string, unknown> = { stageId };
    if (action === "ARCHIVE_STAGE") {
      statements.push({
        text: "UPDATE design_project_stages SET archived_at=$1,updated_at=$2 WHERE id=$3",
        params: [timestamp, timestamp, stageId],
      });
      auditAction = "DESIGN_STAGE_DELETED";
    } else if (action === "MOVE_STAGE") {
      const direction = clean(input.direction, 10);
      if (!direction || !["UP", "DOWN"].includes(direction))
        throw new DesignError("Некорректное направление перемещения этапа.");
      const target = await first<{ id: string; position: number }>(
        `SELECT id,position FROM design_project_stages WHERE design_project_id=$1 AND archived_at IS NULL AND position${direction === "UP" ? "<" : ">"}$2 ORDER BY position ${direction === "UP" ? "DESC" : "ASC"} LIMIT 1`,
        [row.id, stage.position],
      );
      if (target) {
        statements.push(
          {
            text: "UPDATE design_project_stages SET position=$1,updated_at=$2 WHERE id=$3",
            params: [target.position, timestamp, stage.id],
          },
          {
            text: "UPDATE design_project_stages SET position=$1,updated_at=$2 WHERE id=$3",
            params: [stage.position, timestamp, target.id],
          },
        );
      }
      metadata = { stageId, direction };
    } else {
      const nextStatus = (clean(input.status, 30) ||
        (action === "COMPLETE_STAGE"
          ? "COMPLETED"
          : stage.status)) as StageStatus;
      if (!DESIGN_STAGE_STATUSES.some(([id]) => id === nextStatus))
        throw new DesignError("Некорректный статус этапа.");
      if (nextStatus === "COMPLETED")
        await assertModuleAction(actor, "orders", "design.stages.complete");
      const stageResponsibleUserId =
        input.responsibleUserId === undefined
          ? stage.responsible_user_id
          : clean(input.responsibleUserId, 100);
      if (stageResponsibleUserId) await assertOrderUser(stageResponsibleUserId);
      const completedAt = nextStatus === "COMPLETED" ? timestamp : null;
      const plannedStartDate =
        input.plannedStartDate === undefined
          ? stage.planned_start_date
          : dateSeconds(input.plannedStartDate);
      const plannedEndDate =
        input.plannedEndDate === undefined
          ? stage.planned_end_date
          : dateSeconds(input.plannedEndDate);
      assertDateOrder(plannedStartDate, plannedEndDate);
      statements.push({
        text: `UPDATE design_project_stages SET name=$1,status=$2,planned_start_date=$3,planned_end_date=$4,
          completed_at=$5,responsible_user_id=$6,comment=$7,updated_at=$8 WHERE id=$9`,
        params: [
          clean(input.name, 180) || stage.name,
          nextStatus,
          plannedStartDate,
          plannedEndDate,
          completedAt,
          stageResponsibleUserId,
          input.comment === undefined
            ? stage.comment
            : clean(input.comment, 2000),
          timestamp,
          stageId,
        ],
      });
      auditAction =
        nextStatus === "COMPLETED"
          ? "DESIGN_STAGE_COMPLETED"
          : "DESIGN_STAGE_UPDATED";
      metadata = { stageId, from: stage.status, to: nextStatus };
    }
    await writeDesignAudit(
      actor,
      row,
      auditAction,
      metadata,
      statements,
      timestamp,
    );
    await transaction(statements);
    return getDesignProject(actor, orderId);
  }
  if (action === "COMPLETE") {
    await assertModuleAction(actor, "orders", "design.complete");
    if (["COMPLETED", "CANCELLED"].includes(row.status))
      throw new DesignError("Дизайн-проект уже завершён или отменён.", 409);
    const summary = await first<{
      total: number | string;
      completed: number | string;
      final_album: number | string;
    }>(
      `SELECT COUNT(*) total,COUNT(*) FILTER(WHERE status='COMPLETED') completed,
        (SELECT COUNT(*) FROM attachments a WHERE a.design_project_id=$1 AND a.category='FINAL_ALBUM' AND a.is_current=1 AND a.upload_status='LINKED' AND a.deleted_at IS NULL AND a.archived_at IS NULL) final_album
        FROM design_project_stages WHERE design_project_id=$1 AND archived_at IS NULL`,
      [row.id],
    );
    const price = Number(row.price_kopecks);
    const paid = Number(row.paid_kopecks);
    const canViewFinance =
      actor.role === "OWNER" || access.actions["design.viewFinance"];
    const warnings = {
      unfinishedStages:
        Number(summary?.total || 0) - Number(summary?.completed || 0),
      finalAlbumMissing: Number(summary?.final_album || 0) === 0,
      remainingKopecks: canViewFinance ? Math.max(price - paid, 0) : 0,
    };
    if (
      input.confirmWarnings !== true &&
      (warnings.unfinishedStages ||
        warnings.finalAlbumMissing ||
        warnings.remainingKopecks)
    )
      throw new DesignError("Подтвердите завершение с предупреждениями.", 409, {
        code: "DESIGN_COMPLETION_WARNINGS",
        warnings,
      });
    const statements = [
      {
        text: "UPDATE design_projects SET status='COMPLETED',actual_end_date=$1,updated_at=$2 WHERE id=$3",
        params: [timestamp, timestamp, row.id],
      },
      {
        text: "UPDATE orders SET status='COMPLETED',completed_at=$1,updated_at=$2 WHERE id=$3",
        params: [timestamp, timestamp, orderId],
      },
    ];
    await writeDesignAudit(
      actor,
      row,
      "DESIGN_ORDER_COMPLETED",
      warnings,
      statements,
      timestamp,
    );
    await transaction(statements);
    return getDesignProject(actor, orderId);
  }
  if (action === "CANCEL") {
    await assertModuleAction(actor, "orders", "orders.cancel");
    if (["COMPLETED", "CANCELLED"].includes(row.status))
      throw new DesignError(
        "Завершённый или отменённый заказ нельзя отменить повторно.",
        409,
      );
    const reason = clean(input.reason, 500);
    if (!reason) throw new DesignError("Укажите причину отмены.");
    const statements = [
      {
        text: "UPDATE design_projects SET status='CANCELLED',updated_at=$1 WHERE id=$2",
        params: [timestamp, row.id],
      },
      {
        text: "UPDATE orders SET status='CANCELLED',cancelled_at=$1,updated_at=$2 WHERE id=$3",
        params: [timestamp, timestamp, orderId],
      },
    ];
    await writeDesignAudit(
      actor,
      row,
      "ORDER_CANCELLED",
      { reason },
      statements,
      timestamp,
    );
    await transaction(statements);
    return getDesignProject(actor, orderId);
  }
  if (action === "CONVERT_TO_RENOVATION") {
    if (row.status !== "COMPLETED")
      throw new DesignError("Сначала завершите дизайн-проект.", 409);
    return createRenovationOrder(actor, {
      ...input,
      clientId: row.client_id,
      responsibleUserId: row.responsible_user_id,
      residentialComplex: row.residential_complex,
      address: row.address,
      apartmentNumber: row.apartment_number,
      areaSqm: row.area_sqm,
      sourceOrderId: row.order_id,
    });
  }
  await assertModuleAction(actor, "orders", "design.edit");
  const nextStatus = (clean(input.status, 30) || row.status) as DesignStatus;
  if (!DESIGN_STATUSES.some(([id]) => id === nextStatus))
    throw new DesignError("Некорректный статус дизайн-проекта.");
  if (["COMPLETED", "CANCELLED"].includes(nextStatus))
    throw new DesignError(
      "Используйте отдельное действие завершения или отмены дизайн-проекта.",
      409,
    );
  const responsibleUserId =
    clean(input.responsibleUserId, 100) || row.responsible_user_id;
  if (
    actor.role !== "OWNER" &&
    responsibleUserId !== row.responsible_user_id &&
    !access.actions["orders.edit"]
  )
    throw new AccessError("Нет права менять ответственного по заказу.", 403);
  const designerEmployeeId =
    input.designerEmployeeId === undefined
      ? row.designer_employee_id
      : clean(input.designerEmployeeId, 100);
  if (
    actor.role !== "OWNER" &&
    designerEmployeeId !== row.designer_employee_id &&
    !access.actions["design.assignDesigner"]
  )
    throw new AccessError("Нет права назначать дизайнера.", 403);
  await Promise.all([
    assertOrderUser(responsibleUserId),
    assertDesigner(designerEmployeeId),
  ]);
  const price =
    input.price === undefined
      ? Number(row.price_kopecks)
      : parseAmountKopecks(input.price);
  if (
    input.price !== undefined &&
    actor.role !== "OWNER" &&
    !access.actions["design.viewFinance"]
  )
    throw new AccessError("Нет права изменять стоимость дизайн-проекта.", 403);
  if (!price) throw new DesignError("Стоимость должна быть больше нуля.");
  const plannedStartDate =
    input.plannedStartDate === undefined
      ? row.planned_start_date
      : dateSeconds(input.plannedStartDate);
  const plannedEndDate =
    input.plannedEndDate === undefined
      ? row.planned_end_date
      : dateSeconds(input.plannedEndDate);
  assertDateOrder(plannedStartDate, plannedEndDate);
  const statements = [
    {
      text: `UPDATE orders SET amount_kopecks=$1,status=$2,responsible_user_id=$3,comment=$4,updated_at=$5 WHERE id=$6`,
      params: [
        price,
        orderStatusForDesign(nextStatus),
        responsibleUserId,
        input.comment === undefined
          ? row.order_comment
          : clean(input.comment, 3000),
        timestamp,
        orderId,
      ],
    },
    {
      text: `UPDATE design_projects SET residential_complex=$1,address=$2,apartment_number=$3,area_sqm=$4,designer_employee_id=$5,
        planned_start_date=$6,planned_end_date=$7,status=$8,comment=$9,actual_end_date=$10,updated_at=$11 WHERE id=$12`,
      params: [
        input.residentialComplex === undefined
          ? row.residential_complex
          : clean(input.residentialComplex, 240),
        clean(input.address, 500) || row.address,
        clean(input.apartmentNumber, 80) || row.apartment_number,
        input.areaSqm === undefined ? row.area_sqm : area(input.areaSqm),
        designerEmployeeId,
        plannedStartDate,
        plannedEndDate,
        nextStatus,
        input.designComment === undefined
          ? row.comment
          : clean(input.designComment, 3000),
        nextStatus === "COMPLETED"
          ? row.actual_end_date || timestamp
          : row.actual_end_date,
        timestamp,
        row.id,
      ],
    },
  ];
  const assignmentChanged = designerEmployeeId !== row.designer_employee_id;
  await writeDesignAudit(
    actor,
    row,
    assignmentChanged ? "DESIGN_DESIGNER_CHANGED" : "DESIGN_PROJECT_UPDATED",
    {
      fromStatus: row.status,
      toStatus: nextStatus,
      designerEmployeeId,
      priceChanged: price !== Number(row.price_kopecks),
    },
    statements,
    timestamp,
  );
  await transaction(statements);
  return getDesignProject(actor, orderId);
}

export async function linkDesignAttachment(
  actor: AuthUser,
  orderId: string,
  input: DesignInput,
) {
  const row = await visibleDesign(actor, orderId);
  await assertModuleAction(actor, "orders", "design.files.upload");
  const attachmentId = clean(input.attachmentId, 100);
  const logicalName = clean(input.logicalName, 180);
  const category = clean(input.category, 40);
  const designStageId = clean(input.designStageId, 100);
  const previousVersionId = clean(input.previousVersionId, 100);
  if (!attachmentId || !logicalName || !category)
    throw new DesignError("Заполните название и категорию файла.");
  if (!DESIGN_FILE_CATEGORIES.some(([id]) => id === category))
    throw new DesignError("Некорректная категория файла.");
  if (designStageId) {
    const stage = await first<{ id: string }>(
      "SELECT id FROM design_project_stages WHERE id=$1 AND design_project_id=$2 AND archived_at IS NULL LIMIT 1",
      [designStageId, row.id],
    );
    if (!stage) throw new DesignError("Этап для файла не найден.", 404);
  }
  let attachment;
  try {
    attachment = await confirmAttachmentUpload(actor, attachmentId);
  } catch (error) {
    if (error instanceof FileError)
      throw new DesignError(error.message, error.status);
    throw error;
  }
  if (
    attachment.entity_type !==
      (designStageId ? "DesignStage" : "DesignProject") ||
    attachment.entity_id !== (designStageId || row.id) ||
    attachment.category !== category
  )
    throw new DesignError("Файл загружен для другой сущности.", 409);
  const current = await first<{ id: string; version: number }>(
    `SELECT id,version FROM attachments WHERE design_project_id=$1 AND category=$2 AND logical_name=$3
      AND is_current=1 AND archived_at IS NULL AND deleted_at IS NULL ORDER BY version DESC LIMIT 1`,
    [row.id, category, logicalName],
  );
  if (current || previousVersionId)
    await assertModuleAction(actor, "orders", "design.files.manageVersions");
  if (current && !previousVersionId)
    throw new DesignError(
      "Укажите, что это новая версия существующего файла.",
      409,
      {
        code: "FILE_VERSION_REQUIRED",
        currentVersionId: current.id,
      },
    );
  if (previousVersionId && current?.id !== previousVersionId)
    throw new DesignError(
      "Актуальная версия файла уже изменилась. Обновите карточку.",
      409,
    );
  const version = current ? current.version + 1 : 1;
  const timestamp = now();
  const statements: { text: string; params: unknown[] }[] = [];
  if (current)
    statements.push({
      text: "UPDATE attachments SET is_current=0,updated_at=$1 WHERE id=$2 AND is_current=1",
      params: [timestamp, current.id],
    });
  statements.push({
    text: `UPDATE attachments SET design_project_id=$1,design_stage_id=$2,previous_version_id=$3,logical_name=$4,version=$5,is_current=1,
      upload_status='LINKED',linked_at=$6,updated_at=$7 WHERE id=$8 AND uploaded_by_user_id=$9 AND upload_status='UPLOADED'`,
    params: [
      row.id,
      designStageId,
      current?.id ?? null,
      logicalName,
      version,
      timestamp,
      timestamp,
      attachmentId,
      actor.id,
    ],
  });
  const action = current
    ? "DESIGN_FILE_VERSION_CREATED"
    : "DESIGN_FILE_UPLOADED";
  await writeDesignAudit(
    actor,
    row,
    action,
    {
      attachmentId,
      logicalName,
      category,
      version,
      previousVersionId: current?.id ?? null,
    },
    statements,
    timestamp,
  );
  await transaction(statements);
  return getDesignProject(actor, orderId);
}

export async function archiveDesignAttachment(
  actor: AuthUser,
  orderId: string,
  attachmentId: string,
) {
  const row = await visibleDesign(actor, orderId);
  await assertModuleAction(actor, "orders", "design.files.archive");
  const file = await first<{ id: string; is_current: number }>(
    "SELECT id,is_current FROM attachments WHERE id=$1 AND design_project_id=$2 AND upload_status='LINKED' AND deleted_at IS NULL AND archived_at IS NULL LIMIT 1",
    [attachmentId, row.id],
  );
  if (!file) throw new DesignError("Файл не найден.", 404);
  const timestamp = now();
  const statements = [
    {
      text: "UPDATE attachments SET archived_at=$1,is_current=0,updated_at=$2 WHERE id=$3",
      params: [timestamp, timestamp, attachmentId],
    },
  ];
  await writeDesignAudit(
    actor,
    row,
    "DESIGN_FILE_ARCHIVED",
    { attachmentId },
    statements,
    timestamp,
  );
  await transaction(statements);
  return getDesignProject(actor, orderId);
}
