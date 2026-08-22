import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  unique,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
};

export const employees = pgTable(
  "employees",
  {
    id: text("id").primaryKey(),
    fullName: text("full_name").notNull(),
    phone: text("phone"),
    position: text("position"),
    contactsJson: text("contacts_json"),
    status: text("status").notNull().default("ACTIVE"),
    permissionsJson: text("permissions_json"),
    ...timestamps,
  },
  (table) => [index("idx_employees_status").on(table.status)],
);

export const clients = pgTable(
  "clients",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    phoneNormalized: text("phone_normalized").notNull(),
    secondaryPhone: text("secondary_phone"),
    email: text("email"),
    preferredContact: text("preferred_contact"),
    contactsJson: text("contacts_json"),
    source: text("source", {
      enum: ["WEBSITE", "FARPOST", "AVITO", "REFERRAL", "OTHER"],
    })
      .notNull()
      .default("OTHER"),
    comment: text("comment"),
    responsibleUserId: text("responsible_user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    ownerEmployeeId: text("owner_employee_id").references(() => employees.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    status: text("status", { enum: ["ACTIVE", "ARCHIVED"] })
      .notNull()
      .default("ACTIVE"),
    archivedAt: integer("archived_at"),
    ...timestamps,
  },
  (table) => [
    index("idx_clients_phone").on(table.phone),
    index("idx_clients_phone_normalized").on(table.phoneNormalized),
    index("idx_clients_owner").on(table.ownerEmployeeId),
    index("idx_clients_responsible_status_created").on(
      table.responsibleUserId,
      table.status,
      table.createdAt,
    ),
    index("idx_clients_source_status_created").on(
      table.source,
      table.status,
      table.createdAt,
    ),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: text("id").primaryKey(),
    number: text("number").notNull(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    type: text("type", {
      enum: ["INSPECTION", "DESIGN", "RENOVATION"],
    }).notNull(),
    title: text("title").notNull(),
    amountKopecks: integer("amount_kopecks").notNull(),
    status: text("status", {
      enum: ["NEW", "SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"],
    }).notNull(),
    responsibleUserId: text("responsible_user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    scheduledAt: integer("scheduled_at"),
    startedAt: integer("started_at"),
    completedAt: integer("completed_at"),
    cancelledAt: integer("cancelled_at"),
    comment: text("comment"),
    internalComment: text("internal_comment"),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    sourceLeadId: text("source_lead_id").references(
      (): AnyPgColumn => leads.id,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
    sourceOrderId: text("source_order_id").references(
      (): AnyPgColumn => orders.id,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
    ...timestamps,
  },
  (table) => [
    unique("orders_number_unique").on(table.number),
    index("idx_orders_client_created").on(table.clientId, table.createdAt),
    index("idx_orders_responsible_scheduled").on(
      table.responsibleUserId,
      table.scheduledAt,
    ),
    index("idx_orders_status_scheduled").on(table.status, table.scheduledAt),
    index("idx_orders_type").on(table.type),
    index("idx_orders_source_lead").on(table.sourceLeadId),
    index("idx_orders_source_order").on(table.sourceOrderId),
    check(
      "orders_type_check",
      sql`${table.type} IN ('INSPECTION','DESIGN','RENOVATION')`,
    ),
    check(
      "orders_status_check",
      sql`${table.status} IN ('NEW','SCHEDULED','IN_PROGRESS','COMPLETED','CANCELLED')`,
    ),
    check("orders_amount_check", sql`${table.amountKopecks} >= 0`),
  ],
);

export const designProjects = pgTable(
  "design_projects",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    residentialComplex: text("residential_complex"),
    residentialComplexId: text("residential_complex_id"),
    address: text("address").notNull(),
    apartmentNumber: text("apartment_number").notNull(),
    areaSqm: numeric("area_sqm", { precision: 10, scale: 2 }),
    designerEmployeeId: text("designer_employee_id").references(
      () => employees.id,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
    plannedStartDate: integer("planned_start_date"),
    plannedEndDate: integer("planned_end_date"),
    actualEndDate: integer("actual_end_date"),
    status: text("status", {
      enum: [
        "PLANNING",
        "IN_PROGRESS",
        "WAITING_CLIENT",
        "COMPLETED",
        "PAUSED",
        "CANCELLED",
      ],
    })
      .notNull()
      .default("PLANNING"),
    comment: text("comment"),
    ...timestamps,
  },
  (table) => [
    unique("design_projects_order_unique").on(table.orderId),
    index("idx_design_projects_designer").on(table.designerEmployeeId),
    index("idx_design_projects_status").on(table.status),
    index("idx_design_projects_planned_end").on(table.plannedEndDate),
    check(
      "design_projects_area_check",
      sql`${table.areaSqm} IS NULL OR ${table.areaSqm} > 0`,
    ),
    check(
      "design_projects_status_check",
      sql`${table.status} IN ('PLANNING','IN_PROGRESS','WAITING_CLIENT','COMPLETED','PAUSED','CANCELLED')`,
    ),
  ],
);

export const designProjectStages = pgTable(
  "design_project_stages",
  {
    id: text("id").primaryKey(),
    designProjectId: text("design_project_id")
      .notNull()
      .references(() => designProjects.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    status: text("status", {
      enum: ["NOT_STARTED", "IN_PROGRESS", "WAITING_CLIENT", "COMPLETED"],
    })
      .notNull()
      .default("NOT_STARTED"),
    plannedStartDate: integer("planned_start_date"),
    plannedEndDate: integer("planned_end_date"),
    completedAt: integer("completed_at"),
    responsibleUserId: text("responsible_user_id").references(() => users.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    comment: text("comment"),
    archivedAt: integer("archived_at"),
    ...timestamps,
  },
  (table) => [
    index("idx_design_stages_project_position").on(
      table.designProjectId,
      table.position,
    ),
    index("idx_design_stages_status").on(table.status),
    check("design_project_stages_position_check", sql`${table.position} >= 0`),
    check(
      "design_project_stages_status_check",
      sql`${table.status} IN ('NOT_STARTED','IN_PROGRESS','WAITING_CLIENT','COMPLETED')`,
    ),
  ],
);

export const designProjectEvents = pgTable(
  "design_project_events",
  {
    id: text("id").primaryKey(),
    designProjectId: text("design_project_id")
      .notNull()
      .references(() => designProjects.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    type: text("type").notNull(),
    occurredAt: integer("occurred_at").notNull(),
    metadataJson: jsonb("metadata_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (table) => [
    index("idx_design_events_project_time").on(
      table.designProjectId,
      table.occurredAt,
    ),
  ],
);

export const renovationOrderDetails = pgTable(
  "renovation_order_details",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    residentialComplex: text("residential_complex"),
    residentialComplexId: text("residential_complex_id"),
    address: text("address").notNull(),
    apartmentNumber: text("apartment_number").notNull(),
    areaSqm: numeric("area_sqm", { precision: 10, scale: 2 }),
    ...timestamps,
  },
  (table) => [
    unique("renovation_order_details_order_unique").on(table.orderId),
    check(
      "renovation_order_details_area_check",
      sql`${table.areaSqm} IS NULL OR ${table.areaSqm} > 0`,
    ),
  ],
);

export const inspections = pgTable(
  "inspections",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    residentialComplex: text("residential_complex"),
    address: text("address").notNull(),
    apartmentNumber: text("apartment_number").notNull(),
    areaSqm: numeric("area_sqm", { precision: 10, scale: 2 }),
    scheduledAt: integer("scheduled_at").notNull(),
    scheduledStartAt: integer("scheduled_start_at").notNull(),
    scheduledEndAt: integer("scheduled_end_at").notNull(),
    inspectorUserId: text("inspector_user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    resultComment: text("result_comment"),
    ...timestamps,
  },
  (table) => [
    unique("inspections_order_unique").on(table.orderId),
    index("idx_inspections_scheduled").on(table.scheduledAt),
    index("idx_inspections_inspector_schedule").on(
      table.inspectorUserId,
      table.scheduledStartAt,
      table.scheduledEndAt,
    ),
    check(
      "inspections_area_check",
      sql`${table.areaSqm} IS NULL OR ${table.areaSqm} > 0`,
    ),
    check(
      "inspections_schedule_range_check",
      sql`${table.scheduledEndAt} > ${table.scheduledStartAt}`,
    ),
  ],
);

export const inspectionDefects = pgTable(
  "inspection_defects",
  {
    id: text("id").primaryKey(),
    inspectionId: text("inspection_id")
      .notNull()
      .references(() => inspections.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    room: text("room").notNull(),
    category: text("category", {
      enum: [
        "WALLS",
        "FLOOR",
        "CEILING",
        "WINDOWS",
        "DOORS",
        "ELECTRICAL",
        "PLUMBING",
        "VENTILATION",
        "FINISHING",
        "OTHER",
      ],
    }).notNull(),
    description: text("description").notNull(),
    severity: text("severity", { enum: ["LOW", "MEDIUM", "HIGH"] }).notNull(),
    status: text("status", { enum: ["OPEN", "RESOLVED"] })
      .notNull()
      .default("OPEN"),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    ...timestamps,
  },
  (table) => [
    index("idx_inspection_defects_inspection_created").on(
      table.inspectionId,
      table.createdAt,
    ),
    check(
      "inspection_defects_category_check",
      sql`${table.category} IN ('WALLS','FLOOR','CEILING','WINDOWS','DOORS','ELECTRICAL','PLUMBING','VENTILATION','FINISHING','OTHER')`,
    ),
    check(
      "inspection_defects_severity_check",
      sql`${table.severity} IN ('LOW','MEDIUM','HIGH')`,
    ),
    check(
      "inspection_defects_status_check",
      sql`${table.status} IN ('OPEN','RESOLVED')`,
    ),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").references(() => orders.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    name: text("name").notNull(),
    residentialComplex: text("residential_complex"),
    address: text("address").notNull(),
    apartment: text("apartment").notNull(),
    areaSqm: numeric("area_sqm", { precision: 8, scale: 2 }),
    responsibleUserId: text("responsible_user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    managerEmployeeId: text("manager_employee_id").references(
      () => employees.id,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
    foremanEmployeeId: text("foreman_employee_id").references(
      () => employees.id,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
    status: text("status", {
      enum: ["PLANNING", "ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"],
    })
      .notNull()
      .default("PLANNING"),
    startDate: integer("start_date"),
    plannedEndDate: integer("planned_end_date"),
    forecastEndDate: integer("forecast_end_date"),
    actualEndDate: integer("actual_end_date"),
    contractAmountKopecks: integer("contract_amount_kopecks").notNull(),
    estimatedMaterialsBudgetKopecks: integer(
      "estimated_materials_budget_kopecks",
    )
      .notNull()
      .default(0),
    comment: text("comment"),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references((): AnyPgColumn => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    archivedAt: integer("archived_at"),
    ...timestamps,
  },
  (table) => [
    index("idx_projects_status_manager").on(
      table.status,
      table.managerEmployeeId,
    ),
    index("idx_projects_client").on(table.clientId),
    index("idx_projects_order").on(table.orderId),
    uniqueIndex("idx_projects_order_unique")
      .on(table.orderId)
      .where(sql`${table.orderId} IS NOT NULL`),
    index("idx_projects_manager").on(table.managerEmployeeId),
    index("idx_projects_foreman").on(table.foremanEmployeeId),
    index("idx_projects_responsible_status_created").on(
      table.responsibleUserId,
      table.status,
      table.createdAt,
    ),
    index("idx_projects_foreman_status").on(
      table.foremanEmployeeId,
      table.status,
    ),
  ],
);

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    authProvider: text("auth_provider", {
      enum: ["LOCAL", "SUPABASE", "EXTERNAL"],
    })
      .notNull()
      .default("LOCAL"),
    externalAuthId: text("external_auth_id"),
    email: text("email"),
    username: text("username").notNull(),
    usernameNormalized: text("username_normalized").notNull(),
    displayName: text("display_name").notNull(),
    role: text("role", { enum: ["OWNER", "EMPLOYEE", "CLIENT"] }).notNull(),
    employeeId: text("employee_id").references(() => employees.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    clientId: text("client_id").references(() => clients.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    status: text("status", { enum: ["ACTIVE", "BLOCKED"] })
      .notNull()
      .default("ACTIVE"),
    isProtectedOwner: integer("is_protected_owner").notNull().default(0),
    passwordHash: text("password_hash"),
    passwordSalt: text("password_salt"),
    passwordIterations: integer("password_iterations"),
    passwordChangedAt: integer("password_changed_at"),
    lastLoginAt: integer("last_login_at"),
    ...timestamps,
  },
  (table) => [
    unique("users_username_unique").on(table.username),
    unique("users_username_normalized_unique").on(table.usernameNormalized),
    unique("users_employee_id_unique").on(table.employeeId),
    uniqueIndex("idx_users_external_auth_id").on(table.externalAuthId),
    index("idx_users_client").on(table.clientId),
    index("idx_users_role_status").on(table.role, table.status),
  ],
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    tokenHash: text("token_hash").notNull(),
    createdAt: integer("created_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    revokedAt: integer("revoked_at"),
    userAgent: text("user_agent"),
  },
  (table) => [
    uniqueIndex("idx_auth_sessions_token_hash").on(table.tokenHash),
    index("idx_auth_sessions_user_expires").on(table.userId, table.expiresAt),
    index("idx_auth_sessions_expires").on(table.expiresAt),
  ],
);

export const authAttempts = pgTable(
  "auth_attempts",
  {
    id: text("id").primaryKey(),
    identifierHash: text("identifier_hash").notNull(),
    attemptedAt: integer("attempted_at").notNull(),
    succeeded: integer("succeeded").notNull(),
  },
  (table) => [
    index("idx_auth_attempts_identifier_time").on(
      table.identifierHash,
      table.attemptedAt,
    ),
  ],
);

export const userPermissions = pgTable(
  "user_permissions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    permission: text("permission").notNull(),
    scope: text("scope").notNull().default("COMPANY"),
    allowed: integer("allowed").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("idx_user_permission_scope").on(
      table.userId,
      table.permission,
      table.scope,
    ),
  ],
);

export const userProjectAccess = pgTable(
  "user_project_access",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    accessLevel: text("access_level").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("idx_user_project_access").on(table.userId, table.projectId),
    index("idx_user_project_access_project").on(table.projectId),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    occurredAt: integer("occurred_at").notNull(),
    metadataJson: text("metadata_json").notNull().default("{}"),
  },
  (table) => [
    index("idx_audit_actor_time").on(table.actorUserId, table.occurredAt),
    index("idx_audit_entity_time").on(
      table.entityType,
      table.entityId,
      table.occurredAt,
    ),
    index("idx_audit_created_at").on(table.occurredAt),
  ],
);

export const leads = pgTable(
  "leads",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    source: text("source").notNull(),
    ownerEmployeeId: text("owner_employee_id").references(() => employees.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    status: text("status").notNull(),
    notes: text("notes"),
    nextAction: text("next_action"),
    nextContactAt: integer("next_contact_at"),
    ...timestamps,
  },
  (table) => [
    index("idx_leads_status_next_contact").on(
      table.status,
      table.nextContactAt,
    ),
    index("idx_leads_client").on(table.clientId),
  ],
);

export const cashboxes = pgTable(
  "cashboxes",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id").references(() => users.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    name: text("name").notNull(),
    type: text("type").notNull().default("PERSONAL"),
    ownerEmployeeId: text("owner_employee_id").references(() => employees.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    currency: text("currency").notNull().default("RUB"),
    status: text("status", { enum: ["ACTIVE", "INACTIVE"] })
      .notNull()
      .default("ACTIVE"),
    openingBalanceKopecks: integer("opening_balance_kopecks")
      .notNull()
      .default(0),
    balanceKopecks: integer("balance_kopecks").notNull().default(0),
    isActive: integer("is_active").notNull().default(1),
    deactivatedAt: integer("deactivated_at"),
    deactivatedByUserId: text("deactivated_by_user_id").references(
      () => users.id,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
    ...timestamps,
  },
  (table) => [
    unique("cashboxes_owner_user_id_unique").on(table.ownerUserId),
    index("idx_cashboxes_status").on(table.status),
    index("idx_cashboxes_owner_employee").on(table.ownerEmployeeId),
    index("idx_cashboxes_deactivated_by").on(table.deactivatedByUserId),
  ],
);

export const financialTransactions = pgTable(
  "financial_transactions",
  {
    id: text("id").primaryKey(),
    amountKopecks: integer("amount_kopecks").notNull(),
    transactionDate: integer("transaction_date").notNull(),
    type: text("type", {
      enum: ["INCOME", "EXPENSE", "TRANSFER", "REFUND", "OWNER_PAYOUT"],
    }).notNull(),
    expenseType: text("expense_type", { enum: ["PROJECT", "ADMIN"] }),
    authorUserId: text("author_user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    cashboxId: text("cashbox_id")
      .notNull()
      .references(() => cashboxes.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    destinationCashboxId: text("destination_cashbox_id").references(
      () => cashboxes.id,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
    originalTransactionId: text("original_transaction_id"),
    clientId: text("client_id").references(() => clients.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    orderId: text("order_id").references(() => orders.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    category: text("category").notNull(),
    subcategory: text("subcategory"),
    source: text("source"),
    purpose: text("purpose", {
      enum: ["MATERIALS", "WORKS", "ADDITIONAL_WORKS", "OTHER"],
    }),
    title: text("title").notNull(),
    comment: text("comment"),
    showToClient: integer("show_to_client").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      name: "financial_transactions_original_transaction_id_fkey",
      columns: [table.originalTransactionId],
      foreignColumns: [table.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    index("idx_transactions_cashbox_date").on(
      table.cashboxId,
      table.transactionDate,
    ),
    index("idx_transactions_destination_date").on(
      table.destinationCashboxId,
      table.transactionDate,
    ),
    index("idx_transactions_project_date").on(
      table.projectId,
      table.transactionDate,
    ),
    index("idx_transactions_client_purpose").on(table.clientId, table.purpose),
    index("idx_transactions_original").on(table.originalTransactionId),
    index("idx_transactions_author").on(table.authorUserId),
    index("idx_transactions_order").on(table.orderId),
    index("idx_transactions_created_at").on(table.createdAt),
    index("idx_transactions_type_date").on(table.type, table.transactionDate),
    index("idx_transactions_category_date").on(
      table.category,
      table.transactionDate,
    ),
  ],
);

export const transactionAllocations = pgTable(
  "transaction_allocations",
  {
    id: text("id").primaryKey(),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => financialTransactions.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    orderId: text("order_id").references(() => orders.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    amountKopecks: integer("amount_kopecks").notNull(),
    purpose: text("purpose").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("idx_allocations_transaction_project").on(
      table.transactionId,
      table.projectId,
    ),
    index("idx_allocations_transaction").on(table.transactionId),
    index("idx_allocations_project").on(table.projectId),
    index("idx_allocations_order").on(table.orderId),
    check(
      "transaction_allocations_amount_check",
      sql`${table.amountKopecks} > 0`,
    ),
  ],
);

export const attachments = pgTable(
  "attachments",
  {
    id: text("id").primaryKey(),
    transactionId: text("transaction_id").references(
      () => financialTransactions.id,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    designProjectId: text("design_project_id").references(
      () => designProjects.id,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
    designStageId: text("design_stage_id").references(
      () => designProjectStages.id,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
    previousVersionId: text("previous_version_id").references(
      (): AnyPgColumn => attachments.id,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
    logicalName: text("logical_name"),
    version: integer("version").notNull().default(1),
    isCurrent: integer("is_current").notNull().default(1),
    archivedAt: integer("archived_at"),
    storageProvider: text("storage_provider").notNull().default("VERCEL_BLOB"),
    storageKey: text("storage_key").notNull(),
    blobUrl: text("blob_url"),
    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),
    checksumSha256: text("checksum_sha256"),
    uploadedByUserId: text("uploaded_by_user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    category: text("category").notNull(),
    visibility: text("visibility").notNull().default("INTERNAL"),
    uploadStatus: text("upload_status").notNull().default("PENDING"),
    metadataJson: jsonb("metadata_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    completedAt: integer("completed_at"),
    linkedAt: integer("linked_at"),
    deletedAt: integer("deleted_at"),
    deletedByUserId: text("deleted_by_user_id").references(() => users.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    ...timestamps,
  },
  (table) => [
    unique("attachments_storage_key_unique").on(table.storageKey),
    index("idx_attachments_transaction").on(table.transactionId),
    index("idx_attachments_project").on(table.projectId),
    index("idx_attachments_design_project").on(
      table.designProjectId,
      table.category,
      table.logicalName,
      table.version,
    ),
    index("idx_attachments_design_stage").on(table.designStageId),
    uniqueIndex("idx_attachments_design_version_unique")
      .on(
        table.designProjectId,
        table.category,
        table.logicalName,
        table.version,
      )
      .where(sql`${table.designProjectId} IS NOT NULL`),
    uniqueIndex("idx_attachments_design_current_unique")
      .on(table.designProjectId, table.category, table.logicalName)
      .where(
        sql`${table.designProjectId} IS NOT NULL AND ${table.isCurrent}=1 AND ${table.archivedAt} IS NULL AND ${table.deletedAt} IS NULL`,
      ),
    index("idx_attachments_entity").on(table.entityType, table.entityId),
    index("idx_attachments_uploaded_by").on(table.uploadedByUserId),
    index("idx_attachments_created_at").on(table.createdAt),
    index("idx_attachments_status_created").on(
      table.uploadStatus,
      table.createdAt,
    ),
    check(
      "attachments_provider_check",
      sql`${table.storageProvider} = 'VERCEL_BLOB'`,
    ),
    check(
      "attachments_category_check",
      sql`${table.category} IN ('RECEIPT','PROJECT_PHOTO','DAILY_REPORT','HIDDEN_WORK','CONTRACT','ACT','ESTIMATE','INSPECTION','WARRANTY','MEASUREMENT_PLAN','LAYOUT','CONCEPT','VISUALIZATION','WORKING_DRAWINGS','SPECIFICATION','FINAL_ALBUM','OTHER')`,
    ),
    check(
      "attachments_visibility_check",
      sql`${table.visibility} IN ('INTERNAL','PROJECT','CLIENT')`,
    ),
    check("attachments_version_check", sql`${table.version} > 0`),
    check(
      "attachments_is_current_check",
      sql`${table.isCurrent} IN (0,1)`,
    ),
    check(
      "attachments_status_check",
      sql`${table.uploadStatus} IN ('PENDING','UPLOADED','LINKED','FAILED','DELETED')`,
    ),
    check("attachments_size_check", sql`${table.sizeBytes} >= 0`),
  ],
);

export const projectStages = pgTable(
  "project_stages",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    name: text("name").notNull(),
    plannedStart: integer("planned_start"),
    plannedEnd: integer("planned_end"),
    actualStart: integer("actual_start"),
    actualEnd: integer("actual_end"),
    status: text("status").notNull(),
    responsibleEmployeeId: text("responsible_employee_id").references(
      () => employees.id,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
    sortOrder: integer("sort_order").notNull(),
    ...timestamps,
  },
  (table) => [
    index("idx_stages_project_order").on(table.projectId, table.sortOrder),
    index("idx_stages_responsible").on(table.responsibleEmployeeId),
  ],
);

export const projectDelays = pgTable(
  "project_delays",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    stageId: text("stage_id").references(() => projectStages.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    reason: text("reason").notNull(),
    startDate: integer("start_date").notNull(),
    endDate: integer("end_date"),
    days: integer("days").notNull(),
    comment: text("comment"),
    ...timestamps,
  },
  (table) => [
    index("idx_delays_project_start").on(table.projectId, table.startDate),
    index("idx_delays_stage").on(table.stageId),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    assigneeEmployeeId: text("assignee_employee_id").references(
      () => employees.id,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    clientId: text("client_id").references(() => clients.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    leadId: text("lead_id").references(() => leads.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    deadline: integer("deadline"),
    status: text("status").notNull(),
    comment: text("comment"),
    ...timestamps,
  },
  (table) => [
    index("idx_tasks_assignee_status_deadline").on(
      table.assigneeEmployeeId,
      table.status,
      table.deadline,
    ),
    index("idx_tasks_project").on(table.projectId),
    index("idx_tasks_client").on(table.clientId),
    index("idx_tasks_lead").on(table.leadId),
    index("idx_tasks_creator").on(table.createdByUserId),
    index("idx_tasks_due_date").on(table.deadline),
  ],
);

export const contractors = pgTable(
  "contractors",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    specialization: text("specialization").notNull(),
    phone: text("phone"),
    contactsJson: text("contacts_json"),
    comment: text("comment"),
    status: text("status").notNull(),
    ...timestamps,
  },
  (table) => [
    index("idx_contractors_specialization_status").on(
      table.specialization,
      table.status,
    ),
  ],
);

export const contractorAgreements = pgTable(
  "contractor_agreements",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    contractorId: text("contractor_id")
      .notNull()
      .references(() => contractors.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    workTitle: text("work_title").notNull(),
    agreedAmountKopecks: integer("agreed_amount_kopecks").notNull(),
    status: text("status").notNull(),
    ...timestamps,
  },
  (table) => [
    index("idx_agreements_project_contractor").on(
      table.projectId,
      table.contractorId,
    ),
    index("idx_agreements_contractor").on(table.contractorId),
  ],
);

export const estimateVersions = pgTable(
  "estimate_versions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    version: integer("version").notNull(),
    totalKopecks: integer("total_kopecks").notNull(),
    changeReason: text("change_reason"),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("idx_estimate_project_version").on(
      table.projectId,
      table.version,
    ),
    index("idx_estimate_creator").on(table.createdByUserId),
  ],
);

export const additionalWorkVersions = pgTable(
  "additional_work_versions",
  {
    id: text("id").primaryKey(),
    additionalWorkId: text("additional_work_id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    amountKopecks: integer("amount_kopecks").notNull(),
    scheduleDeltaDays: integer("schedule_delta_days").notNull().default(0),
    status: text("status").notNull(),
    approvedByClientId: text("approved_by_client_id").references(
      () => clients.id,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
    approvedByUserId: text("approved_by_user_id").references(() => users.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    approvedAt: integer("approved_at"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("idx_additional_work_version").on(
      table.additionalWorkId,
      table.version,
    ),
    index("idx_additional_work_project").on(table.projectId),
    index("idx_additional_work_client_approver").on(table.approvedByClientId),
    index("idx_additional_work_user_approver").on(table.approvedByUserId),
  ],
);

export const dailyReports = pgTable(
  "daily_reports",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    reportDate: integer("report_date").notNull(),
    authorEmployeeId: text("author_employee_id")
      .notNull()
      .references(() => employees.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    workersJson: text("workers_json"),
    workCompleted: text("work_completed").notNull(),
    comment: text("comment"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("idx_daily_report_project_date").on(
      table.projectId,
      table.reportDate,
    ),
    index("idx_daily_report_author").on(table.authorEmployeeId),
    index("idx_daily_report_creator").on(table.createdByUserId),
  ],
);

export const obligations = pgTable(
  "obligations",
  {
    id: text("id").primaryKey(),
    direction: text("direction").notNull(),
    counterpartyType: text("counterparty_type").notNull(),
    counterpartyId: text("counterparty_id").notNull(),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    amountKopecks: integer("amount_kopecks").notNull(),
    paidKopecks: integer("paid_kopecks").notNull().default(0),
    dueDate: integer("due_date"),
    status: text("status").notNull(),
    ...timestamps,
  },
  (table) => [
    index("idx_obligations_status_due").on(table.status, table.dueDate),
    index("idx_obligations_counterparty").on(
      table.counterpartyType,
      table.counterpartyId,
    ),
    index("idx_obligations_project").on(table.projectId),
  ],
);
