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

export const residentialComplexes = pgTable(
  "residential_complexes",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    city: text("city").notNull(),
    developer: text("developer"),
    comment: text("comment"),
    status: text("status", { enum: ["ACTIVE", "ARCHIVED"] })
      .notNull()
      .default("ACTIVE"),
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
    index("idx_residential_complexes_name").on(table.name),
    index("idx_residential_complexes_normalized_name").on(table.normalizedName),
    index("idx_residential_complexes_status").on(table.status),
    index("idx_residential_complexes_city").on(table.city),
    check(
      "residential_complexes_status_check",
      sql`${table.status} IN ('ACTIVE','ARCHIVED')`,
    ),
  ],
);

export const residentialComplexAddresses = pgTable(
  "residential_complex_addresses",
  {
    id: text("id").primaryKey(),
    residentialComplexId: text("residential_complex_id")
      .notNull()
      .references(() => residentialComplexes.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    address: text("address").notNull(),
    normalizedAddress: text("normalized_address").notNull(),
    position: integer("position").notNull(),
    ...timestamps,
  },
  (table) => [
    index("idx_residential_complex_addresses_complex").on(
      table.residentialComplexId,
      table.position,
      table.id,
    ),
    index("idx_residential_complex_addresses_search").on(
      table.normalizedAddress,
    ),
    unique("residential_complex_addresses_value_unique").on(
      table.residentialComplexId,
      table.normalizedAddress,
    ),
    unique("residential_complex_addresses_identity_unique").on(
      table.id,
      table.residentialComplexId,
    ),
    unique("residential_complex_addresses_position_unique").on(
      table.residentialComplexId,
      table.position,
    ),
    check(
      "residential_complex_addresses_address_check",
      sql`length(trim(${table.address})) > 0`,
    ),
    check(
      "residential_complex_addresses_normalized_check",
      sql`length(trim(${table.normalizedAddress})) > 0`,
    ),
    check(
      "residential_complex_addresses_position_check",
      sql`${table.position} >= 0`,
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
    residentialComplexId: text("residential_complex_id").references(
      () => residentialComplexes.id,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
    residentialComplexAddressId: text(
      "residential_complex_address_id",
    ).references(() => residentialComplexAddresses.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
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
    index("idx_design_projects_residential_complex").on(
      table.residentialComplexId,
    ),
    index("idx_design_projects_residential_complex_address").on(
      table.residentialComplexAddressId,
    ),
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
    residentialComplexId: text("residential_complex_id").references(
      () => residentialComplexes.id,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
    residentialComplexAddressId: text(
      "residential_complex_address_id",
    ).references(() => residentialComplexAddresses.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    address: text("address").notNull(),
    apartmentNumber: text("apartment_number").notNull(),
    areaSqm: numeric("area_sqm", { precision: 10, scale: 2 }),
    approvedEstimateVersionId: text("approved_estimate_version_id").references(
      (): AnyPgColumn => estimateVersions.id,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
    ...timestamps,
  },
  (table) => [
    unique("renovation_order_details_order_unique").on(table.orderId),
    index("idx_renovation_order_details_residential_complex").on(
      table.residentialComplexId,
    ),
    index("idx_renovation_order_details_residential_complex_address").on(
      table.residentialComplexAddressId,
    ),
    uniqueIndex("idx_renovation_estimate_version_unique")
      .on(table.approvedEstimateVersionId)
      .where(sql`${table.approvedEstimateVersionId} IS NOT NULL`),
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
    residentialComplexId: text("residential_complex_id").references(
      () => residentialComplexes.id,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
    residentialComplexAddressId: text(
      "residential_complex_address_id",
    ).references(() => residentialComplexAddresses.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
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
    index("idx_inspections_residential_complex").on(
      table.residentialComplexId,
    ),
    index("idx_inspections_residential_complex_address").on(
      table.residentialComplexAddressId,
    ),
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
    residentialComplexId: text("residential_complex_id").references(
      () => residentialComplexes.id,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
    residentialComplexAddressId: text(
      "residential_complex_address_id",
    ).references(() => residentialComplexAddresses.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
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
    approvedEstimateVersionId: text("approved_estimate_version_id").references(
      (): AnyPgColumn => estimateVersions.id,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
    contractId: text("contract_id").references(
      (): AnyPgColumn => contracts.id,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
    internalForecastEndDate: integer("internal_forecast_end_date"),
    publishedForecastEndDate: integer("published_forecast_end_date"),
    dailyReportResponsibleUserId: text("daily_report_responsible_user_id").references((): AnyPgColumn => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    paymentPlanVersion: integer("payment_plan_version").notNull().default(0),
    paymentPlanActivatedAt: integer("payment_plan_activated_at"),
    paymentPlanActivatedByUserId: text("payment_plan_activated_by_user_id").references((): AnyPgColumn => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
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
    index("idx_projects_residential_complex").on(table.residentialComplexId),
    index("idx_projects_residential_complex_address").on(
      table.residentialComplexAddressId,
    ),
    index("idx_projects_approved_estimate_version").on(table.approvedEstimateVersionId),
    index("idx_projects_contract").on(table.contractId),
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
    linkedClientId: text("linked_client_id")
      .references(() => clients.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    source: text("source", { enum: ["WEBSITE", "FARPOST", "AVITO", "REFERRAL", "OTHER"] }).notNull(),
    ownerEmployeeId: text("owner_employee_id").references(() => employees.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    stage: text("stage", { enum: ["NEW", "CONTACTED", "INSPECTION", "CALCULATION", "PROPOSAL", "CONTRACT", "WON", "LOST"] }).notNull().default("NEW"),
    comment: text("comment"),
    nextActionType: text("next_action_type"),
    nextActionAt: integer("next_action_at"),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    normalizedPhone: text("normalized_phone").notNull(),
    secondaryPhone: text("secondary_phone"),
    email: text("email"),
    preferredContact: text("preferred_contact"),
    responsibleUserId: text("responsible_user_id").notNull().references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    nextActionComment: text("next_action_comment"),
    lostReason: text("lost_reason"),
    lostComment: text("lost_comment"),
    createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    closedAt: integer("closed_at"),
    ...timestamps,
  },
  (table) => [
    index("idx_leads_status_next_contact").on(
      table.stage,
      table.nextActionAt,
    ),
    index("idx_leads_normalized_phone").on(table.normalizedPhone),
    index("idx_leads_stage_created").on(table.stage, table.createdAt.desc()),
    index("idx_leads_responsible_created").on(table.responsibleUserId, table.createdAt.desc()),
    index("idx_leads_linked_client").on(table.linkedClientId),
    index("idx_leads_source_created").on(table.source, table.createdAt.desc()),
    index("idx_leads_next_action").on(table.nextActionAt).where(sql`${table.nextActionAt} IS NOT NULL`),
    check("leads_source_check", sql`${table.source} IN ('WEBSITE','FARPOST','AVITO','REFERRAL','OTHER')`),
    check("leads_stage_check", sql`${table.stage} IN ('NEW','CONTACTED','INSPECTION','CALCULATION','PROPOSAL','CONTRACT','WON','LOST')`),
  ],
);

export const leadActivities = pgTable(
  "lead_activities",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "restrict", onUpdate: "cascade" }),
    type: text("type").notNull(),
    status: text("status", { enum: ["SCHEDULED", "COMPLETED", "CANCELLED"] }).notNull().default("SCHEDULED"),
    scheduledAt: integer("scheduled_at"),
    completedAt: integer("completed_at"),
    comment: text("comment"),
    createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    completedByUserId: text("completed_by_user_id").references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    ...timestamps,
  },
  (table) => [
    index("idx_lead_activities_lead_created").on(table.leadId, table.createdAt.desc()),
    index("idx_lead_activities_scheduled_status").on(table.scheduledAt, table.status),
    check("lead_activities_status_check", sql`${table.status} IN ('SCHEDULED','COMPLETED','CANCELLED')`),
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
    type: text("type").notNull(),
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

export const investmentAccounts = pgTable(
  "investment_accounts",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    name: text("name").notNull(),
    currency: text("currency").notNull().default("RUB"),
    status: text("status", { enum: ["ACTIVE", "INACTIVE"] })
      .notNull()
      .default("ACTIVE"),
    ...timestamps,
  },
  (table) => [
    unique("investment_accounts_owner_user_id_unique").on(table.ownerUserId),
    index("idx_investment_accounts_status").on(table.status),
  ],
);

export const financialTransactions = pgTable(
  "financial_transactions",
  {
    id: text("id").primaryKey(),
    amountKopecks: integer("amount_kopecks").notNull(),
    transactionDate: integer("transaction_date").notNull(),
    type: text("type", {
      enum: ["INCOME", "EXPENSE", "TRANSFER", "REFUND", "OWNER_PAYOUT", "INVESTMENT_REPAYMENT"],
    }).notNull(),
    expenseType: text("expense_type", { enum: ["PROJECT", "ADMIN"] }),
    authorUserId: text("author_user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    cashboxId: text("cashbox_id")
      .references(() => cashboxes.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    investmentAccountId: text("investment_account_id").references(
      () => investmentAccounts.id,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
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
    clientPaymentClaimId: text("client_payment_claim_id").references(
      (): AnyPgColumn => clientPaymentClaims.id,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
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
    index("idx_transactions_investment_date").on(
      table.investmentAccountId,
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
    uniqueIndex("financial_transactions_payment_claim_unique")
      .on(table.clientPaymentClaimId)
      .where(sql`${table.clientPaymentClaimId} IS NOT NULL`),
    index("idx_transactions_created_at").on(table.createdAt),
    index("idx_transactions_type_date").on(table.type, table.transactionDate),
    index("idx_transactions_category_date").on(
      table.category,
      table.transactionDate,
    ),
  ],
);

export const financeAttentionAcknowledgements = pgTable(
  "finance_attention_acknowledgements",
  {
    id: text("id").primaryKey(),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => financialTransactions.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    issueType: text("issue_type").notNull(),
    status: text("status", { enum: ["OPEN", "ACCEPTED"] }).notNull(),
    previousStatus: text("previous_status", { enum: ["OPEN", "ACCEPTED"] }).notNull(),
    acceptedByUserId: text("accepted_by_user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    acceptedAt: integer("accepted_at").notNull(),
    acceptanceComment: text("acceptance_comment"),
    revertedByUserId: text("reverted_by_user_id").references(() => users.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    revertedAt: integer("reverted_at"),
    ...timestamps,
  },
  (table) => [
    unique("finance_attention_acknowledgements_transaction_issue_unique").on(table.transactionId, table.issueType),
    index("idx_finance_attention_acknowledgements_transaction").on(table.transactionId),
    index("idx_finance_attention_acknowledgements_status").on(table.status, table.issueType),
    check("finance_attention_acknowledgements_status_check", sql`${table.status} IN ('OPEN','ACCEPTED')`),
    check("finance_attention_acknowledgements_previous_status_check", sql`${table.previousStatus} IN ('OPEN','ACCEPTED')`),
    check("finance_attention_acknowledgements_comment_check", sql`${table.acceptanceComment} IS NULL OR length(${table.acceptanceComment}) <= 1000`),
    check(
      "finance_attention_acknowledgements_state_check",
      sql`(${table.status} = 'ACCEPTED' AND ${table.revertedByUserId} IS NULL AND ${table.revertedAt} IS NULL) OR (${table.status} = 'OPEN' AND ${table.revertedByUserId} IS NOT NULL AND ${table.revertedAt} IS NOT NULL)`,
    ),
  ],
);

export const investmentMovements = pgTable(
  "investment_movements",
  {
    id: text("id").primaryKey(),
    investmentAccountId: text("investment_account_id")
      .notNull()
      .references(() => investmentAccounts.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    financialTransactionId: text("financial_transaction_id")
      .notNull()
      .references(() => financialTransactions.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    type: text("type", { enum: ["CONTRIBUTION", "REPAYMENT"] }).notNull(),
    amountKopecks: integer("amount_kopecks").notNull(),
    transactionDate: integer("transaction_date").notNull(),
    sourceCashboxId: text("source_cashbox_id").references(() => cashboxes.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    note: text("note"),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    ...timestamps,
  },
  (table) => [
    unique("investment_movements_transaction_unique").on(table.financialTransactionId),
    index("idx_investment_movements_account_date").on(table.investmentAccountId, table.transactionDate),
    index("idx_investment_movements_source_cashbox").on(table.sourceCashboxId),
    check("investment_movements_amount_check", sql`${table.amountKopecks} > 0`),
    check(
      "investment_movements_shape_check",
      sql`(${table.type} = 'CONTRIBUTION' AND ${table.sourceCashboxId} IS NULL) OR (${table.type} = 'REPAYMENT' AND ${table.sourceCashboxId} IS NOT NULL)`,
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
    contractVersionId: text("contract_version_id").references(
      (): AnyPgColumn => contractVersions.id,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
    additionalWorkVersionId: text("additional_work_version_id").references(
      (): AnyPgColumn => additionalWorkVersions.id,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
    handoverId: text("handover_id").references((): AnyPgColumn => projectHandovers.id, { onDelete: "restrict", onUpdate: "cascade" }),
    handoverRoundId: text("handover_round_id").references((): AnyPgColumn => projectHandoverRounds.id, { onDelete: "restrict", onUpdate: "cascade" }),
    handoverDefectId: text("handover_defect_id").references((): AnyPgColumn => projectHandoverDefects.id, { onDelete: "restrict", onUpdate: "cascade" }),
    photoRequirementId: text("photo_requirement_id"),
    clientPaymentClaimId: text("client_payment_claim_id").references(
      (): AnyPgColumn => clientPaymentClaims.id,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
    clientVisible: integer("client_visible").notNull().default(0),
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
    index("idx_attachments_contract_version").on(
      table.contractVersionId,
      table.createdAt,
    ),
    index("idx_attachments_payment_claim").on(table.clientPaymentClaimId),
    index("idx_attachments_additional_work_version").on(table.additionalWorkVersionId, table.createdAt),
    index("idx_attachments_handover").on(table.handoverId, table.createdAt),
    index("idx_attachments_handover_defect").on(table.handoverDefectId, table.createdAt),
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
      sql`${table.category} IN ('RECEIPT','PROJECT_PHOTO','DAILY_REPORT','HIDDEN_WORK','CONTRACT','ACT','ESTIMATE','INSPECTION','WARRANTY','MEASUREMENT_PLAN','LAYOUT','CONCEPT','VISUALIZATION','WORKING_DRAWINGS','SPECIFICATION','FINAL_ALBUM','CONTRACT_DOCX','CONTRACT_PDF','SIGNED_CONTRACT','CONTRACT_OTHER','ADDITIONAL_WORK','HANDOVER_PHOTO','HANDOVER_DEFECT','HANDOVER_DEFECT_RESOLUTION','HANDOVER_DOCUMENT','OTHER')`,
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

export const productionPlans = pgTable("production_plans", {
  id: text("id").primaryKey(), projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "restrict", onUpdate: "cascade" }),
  status: text("status").notNull().default("ACTIVE"), sourceTemplateId: text("source_template_id"), sourceTemplateVersion: integer("source_template_version"),
  designWeight: numeric("design_weight", { precision: 5, scale: 2 }).notNull().default("0"), productionWeight: numeric("production_weight", { precision: 5, scale: 2 }).notNull().default("100"),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }), ...timestamps,
}, table => [unique("production_plans_project_id_key").on(table.projectId), index("idx_production_plans_project").on(table.projectId)]);

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
    productionPlanId: text("production_plan_id").references(() => productionPlans.id, { onDelete: "restrict", onUpdate: "cascade" }),
    name: text("name").notNull(),
    plannedStart: integer("planned_start"),
    plannedEnd: integer("planned_end"),
    actualStart: integer("actual_start"),
    actualEnd: integer("actual_end"),
    status: text("status").notNull(),
    weightWithinProject: numeric("weight_within_project", { precision: 5, scale: 2 }).notNull().default("0"),
    responsibleUserId: text("responsible_user_id").references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    clientAcceptanceRequired: integer("client_acceptance_required").notNull().default(0),
    acceptanceStatus: text("acceptance_status").notNull().default("NOT_REQUIRED"),
    stageCommercialAmountKopecks: integer("stage_commercial_amount_kopecks"),
    acceptanceComment: text("acceptance_comment"), acceptedAt: integer("accepted_at"), rejectedAt: integer("rejected_at"), acceptanceByClientId: text("acceptance_by_client_id"), archivedAt: integer("archived_at"),
    acceptedByClientPortalUserId: text("accepted_by_client_portal_user_id").references((): AnyPgColumn => clientPortalUsers.id, { onDelete: "restrict", onUpdate: "cascade" }),
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
    taskId: text("task_id"),
    category: text("category").notNull().default("OTHER"),
    reason: text("reason").notNull(),
    startDate: integer("start_date").notNull(),
    endDate: integer("end_date"),
    days: integer("days").notNull(),
    comment: text("comment"),
    internalComment: text("internal_comment"), clientComment: text("client_comment"), clientVisible: integer("client_visible").notNull().default(0),
    createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
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
    productionPlanId: text("production_plan_id").references(() => productionPlans.id, { onDelete: "restrict", onUpdate: "cascade" }), stageId: text("stage_id").references(() => projectStages.id, { onDelete: "restrict", onUpdate: "cascade" }),
    description: text("description"), position: integer("position").notNull().default(0), progressType: text("progress_type"), unit: text("unit"),
    plannedQuantity: numeric("planned_quantity", { precision: 14, scale: 2 }), completedQuantity: numeric("completed_quantity", { precision: 14, scale: 2 }),
    weightWithinStage: numeric("weight_within_stage", { precision: 5, scale: 2 }), plannedStartDate: integer("planned_start_date"), plannedEndDate: integer("planned_end_date"), actualStartDate: integer("actual_start_date"), actualEndDate: integer("actual_end_date"),
    responsibleUserId: text("responsible_user_id").references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }), plannedDurationDays: integer("planned_duration_days"), clientVisible: integer("client_visible").notNull().default(1), archivedAt: integer("archived_at"),
    additionalWorkId: text("additional_work_id").references((): AnyPgColumn => additionalWorks.id, { onDelete: "restrict", onUpdate: "cascade" }),
    additionalWorkVersionId: text("additional_work_version_id").references((): AnyPgColumn => additionalWorkVersions.id, { onDelete: "restrict", onUpdate: "cascade" }),
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
    index("idx_tasks_additional_work").on(table.additionalWorkId, table.additionalWorkVersionId),
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

export const estimates = pgTable(
  "estimates",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull().references(() => clients.id, { onDelete: "restrict", onUpdate: "cascade" }),
    responsibleUserId: text("responsible_user_id").notNull().references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    residentialComplexId: text("residential_complex_id").references(() => residentialComplexes.id, { onDelete: "restrict", onUpdate: "cascade" }),
    residentialComplexAddressId: text("residential_complex_address_id").references(() => residentialComplexAddresses.id, { onDelete: "restrict", onUpdate: "cascade" }),
    address: text("address").notNull(),
    apartmentNumber: text("apartment_number"),
    areaSqm: numeric("area_sqm", { precision: 10, scale: 2 }),
    sourceLeadId: text("source_lead_id").references(() => leads.id, { onDelete: "restrict", onUpdate: "cascade" }),
    sourceOrderId: text("source_order_id").references(() => orders.id, { onDelete: "restrict", onUpdate: "cascade" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "restrict", onUpdate: "cascade" }),
    status: text("status", { enum: ["ACTIVE", "CLOSED"] }).notNull().default("ACTIVE"),
    currentVersionId: text("current_version_id").references(
      (): AnyPgColumn => estimateVersions.id,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
    approvedVersionId: text("approved_version_id").references(
      (): AnyPgColumn => estimateVersions.id,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
    createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    archivedAt: integer("archived_at"),
    ...timestamps,
  },
  (table) => [
    index("idx_estimates_client").on(table.clientId),
    index("idx_estimates_responsible").on(table.responsibleUserId),
    index("idx_estimates_residential_complex").on(table.residentialComplexId),
    index("idx_estimates_residential_complex_address").on(table.residentialComplexAddressId),
    index("idx_estimates_source_lead").on(table.sourceLeadId),
    index("idx_estimates_source_order").on(table.sourceOrderId),
    index("idx_estimates_project").on(table.projectId),
    index("idx_estimates_created").on(table.createdAt),
    check("estimates_status_check", sql`${table.status} IN ('ACTIVE','CLOSED')`),
    check("estimates_area_check", sql`${table.areaSqm} IS NULL OR ${table.areaSqm} > 0`),
  ],
);

export const estimateVersions = pgTable(
  "estimate_versions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .references(() => projects.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    estimateId: text("estimate_id").references(() => estimates.id, { onDelete: "restrict", onUpdate: "cascade" }),
    version: integer("version").notNull(),
    totalKopecks: integer("total_kopecks").notNull(),
    changeReason: text("change_reason"),
    status: text("status", { enum: ["DRAFT", "SENT", "APPROVED", "REJECTED", "SUPERSEDED"] }).notNull().default("DRAFT"),
    estimatedMaterialsBudgetKopecks: integer("estimated_materials_budget_kopecks"),
    plannedDuration: text("planned_duration"),
    clientComment: text("client_comment"),
    internalComment: text("internal_comment"),
    sentAt: integer("sent_at"),
    sentByUserId: text("sent_by_user_id").references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    approvedAt: integer("approved_at"),
    approvedByUserId: text("approved_by_user_id").references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    approvalComment: text("approval_comment"),
    rejectedAt: integer("rejected_at"),
    rejectedByUserId: text("rejected_by_user_id").references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    rejectionReason: text("rejection_reason"),
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
    uniqueIndex("idx_estimate_version_number").on(table.estimateId, table.version).where(sql`${table.estimateId} IS NOT NULL`),
    index("idx_estimate_version_estimate_status").on(table.estimateId, table.status),
  ],
);

export const estimateSections = pgTable("estimate_sections", {
  id: text("id").primaryKey(),
  versionId: text("version_id").notNull().references(() => estimateVersions.id, { onDelete: "restrict", onUpdate: "cascade" }),
  name: text("name").notNull(),
  position: integer("position").notNull(),
  ...timestamps,
}, (table) => [index("idx_estimate_sections_version_position").on(table.versionId, table.position)]);

export const estimateItems = pgTable("estimate_items", {
  id: text("id").primaryKey(),
  sectionId: text("section_id").notNull().references(() => estimateSections.id, { onDelete: "restrict", onUpdate: "cascade" }),
  name: text("name").notNull(),
  unit: text("unit").notNull(),
  quantity: numeric("quantity", { precision: 14, scale: 2 }).notNull(),
  clientPriceKopecks: integer("client_price_kopecks").notNull(),
  internalCostKopecks: integer("internal_cost_kopecks"),
  position: integer("position").notNull(),
  ...timestamps,
}, (table) => [index("idx_estimate_items_section_position").on(table.sectionId, table.position)]);

export const estimateEvents = pgTable("estimate_events", {
  id: text("id").primaryKey(),
  estimateId: text("estimate_id").notNull().references(() => estimates.id, { onDelete: "restrict", onUpdate: "cascade" }),
  versionId: text("version_id").references(() => estimateVersions.id, { onDelete: "restrict", onUpdate: "cascade" }),
  actorUserId: text("actor_user_id").notNull().references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
  type: text("type").notNull(),
  occurredAt: integer("occurred_at").notNull(),
  metadataJson: jsonb("metadata_json").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
}, (table) => [index("idx_estimate_events_estimate_time").on(table.estimateId, table.occurredAt)]);

export const companySettings = pgTable("company_settings", {
  id: text("id").primaryKey(),
  legalName: text("legal_name"), tradeName: text("trade_name"), inn: text("inn"), kpp: text("kpp"), ogrn: text("ogrn"),
  legalAddress: text("legal_address"), postalAddress: text("postal_address"), bankName: text("bank_name"), bankAccount: text("bank_account"),
  correspondentAccount: text("correspondent_account"), bik: text("bik"), directorName: text("director_name"), directorTitle: text("director_title"),
  actingBasis: text("acting_basis"), phone: text("phone"), email: text("email"),
  updatedByUserId: text("updated_by_user_id").notNull().references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
  ...timestamps,
});

export const contractTemplates = pgTable("contract_templates", {
  id: text("id").primaryKey(), name: text("name").notNull(), contractType: text("contract_type").notNull().default("RENOVATION"),
  status: text("status").notNull().default("DRAFT"), currentVersionId: text("current_version_id").references((): AnyPgColumn => contractTemplateVersions.id, { onDelete: "restrict", onUpdate: "cascade" }),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }), archivedAt: integer("archived_at"), ...timestamps,
}, (table) => [check("contract_templates_type_check", sql`${table.contractType} IN ('RENOVATION','DESIGN','OTHER')`), check("contract_templates_status_check", sql`${table.status} IN ('DRAFT','ACTIVE','ARCHIVED')`)]);

export const contractTemplateVersions = pgTable("contract_template_versions", {
  id: text("id").primaryKey(), templateId: text("template_id").notNull().references(() => contractTemplates.id, { onDelete: "restrict", onUpdate: "cascade" }),
  version: integer("version").notNull(), status: text("status").notNull().default("DRAFT"), bodyJson: jsonb("body_json").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  changeReason: text("change_reason"), createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
  publishedAt: integer("published_at"), ...timestamps,
}, (table) => [unique("contract_template_versions_number_unique").on(table.templateId, table.version), index("idx_contract_template_versions_template").on(table.templateId, table.version), check("contract_template_versions_version_check", sql`${table.version} > 0`), check("contract_template_versions_status_check", sql`${table.status} IN ('DRAFT','ACTIVE','SUPERSEDED')`)]);

export const contracts = pgTable("contracts", {
  id: text("id").primaryKey(), contractNumber: text("contract_number").notNull(),
  clientId: text("client_id").notNull().references(() => clients.id, { onDelete: "restrict", onUpdate: "cascade" }),
  orderId: text("order_id").notNull().references(() => orders.id, { onDelete: "restrict", onUpdate: "cascade" }),
  projectId: text("project_id").references(() => projects.id, { onDelete: "restrict", onUpdate: "cascade" }),
  type: text("type").notNull().default("RENOVATION"), status: text("status").notNull().default("DRAFT"),
  responsibleUserId: text("responsible_user_id").notNull().references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
  currentVersionId: text("current_version_id").references((): AnyPgColumn => contractVersions.id, { onDelete: "restrict", onUpdate: "cascade" }),
  signedVersionId: text("signed_version_id").references((): AnyPgColumn => contractVersions.id, { onDelete: "restrict", onUpdate: "cascade" }),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
  cancelledAt: integer("cancelled_at"), cancelledByUserId: text("cancelled_by_user_id").references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
  cancellationReason: text("cancellation_reason"), archivedAt: integer("archived_at"), ...timestamps,
}, (table) => [unique("contracts_number_unique").on(table.contractNumber), unique("contracts_order_unique").on(table.orderId), index("idx_contracts_client").on(table.clientId), index("idx_contracts_responsible_status_created").on(table.responsibleUserId, table.status, table.createdAt), index("idx_contracts_project").on(table.projectId), check("contracts_type_check", sql`${table.type} IN ('RENOVATION','DESIGN','OTHER')`), check("contracts_status_check", sql`${table.status} IN ('DRAFT','READY','SENT','SIGNED','CANCELLED','SUPERSEDED')`)]);

export const contractVersions = pgTable("contract_versions", {
  id: text("id").primaryKey(), contractId: text("contract_id").notNull().references(() => contracts.id, { onDelete: "restrict", onUpdate: "cascade" }), version: integer("version").notNull(),
  status: text("status").notNull().default("DRAFT"), contractDate: integer("contract_date"), estimateVersionId: text("estimate_version_id").references(() => estimateVersions.id, { onDelete: "restrict", onUpdate: "cascade" }),
  templateVersionId: text("template_version_id").references(() => contractTemplateVersions.id, { onDelete: "restrict", onUpdate: "cascade" }), templateVersionNumber: integer("template_version_number"),
  contractAmountKopecks: integer("contract_amount_kopecks").notNull(), estimatedMaterialsBudgetKopecks: integer("estimated_materials_budget_kopecks"),
  plannedStartDate: integer("planned_start_date"), plannedEndDate: integer("planned_end_date"), plannedDuration: text("planned_duration"), paymentTermsText: text("payment_terms_text"), warrantyTerm: text("warranty_term"),
  clientSnapshotJson: jsonb("client_snapshot_json").$type<Record<string, unknown>>().notNull(), companySnapshotJson: jsonb("company_snapshot_json").$type<Record<string, unknown>>().notNull(),
  propertySnapshotJson: jsonb("property_snapshot_json").$type<Record<string, unknown>>().notNull(), termsSnapshotJson: jsonb("terms_snapshot_json").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  documentSnapshotJson: jsonb("document_snapshot_json").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`), changeReason: text("change_reason"),
  sentAt: integer("sent_at"), sentByUserId: text("sent_by_user_id").references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
  signedAt: integer("signed_at"), signedByUserId: text("signed_by_user_id").references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }), signatureNote: text("signature_note"),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }), ...timestamps,
}, (table) => [unique("contract_versions_number_unique").on(table.contractId, table.version), index("idx_contract_versions_contract_created").on(table.contractId, table.version), index("idx_contract_versions_estimate").on(table.estimateVersionId), check("contract_versions_version_check", sql`${table.version} > 0`), check("contract_versions_status_check", sql`${table.status} IN ('DRAFT','READY','SENT','SIGNED','SUPERSEDED')`), check("contract_versions_amount_check", sql`${table.contractAmountKopecks} >= 0`), check("contract_versions_materials_check", sql`${table.estimatedMaterialsBudgetKopecks} IS NULL OR ${table.estimatedMaterialsBudgetKopecks} >= 0`)]);

export const contractEvents = pgTable("contract_events", {
  id: text("id").primaryKey(), contractId: text("contract_id").notNull().references(() => contracts.id, { onDelete: "restrict", onUpdate: "cascade" }),
  versionId: text("version_id").references(() => contractVersions.id, { onDelete: "restrict", onUpdate: "cascade" }), actorUserId: text("actor_user_id").notNull().references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
  type: text("type").notNull(), occurredAt: integer("occurred_at").notNull(), metadataJson: jsonb("metadata_json").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
}, (table) => [index("idx_contract_events_contract_time").on(table.contractId, table.occurredAt)]);

export const additionalWorks = pgTable("additional_works", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "restrict", onUpdate: "cascade" }),
  clientId: text("client_id").notNull().references(() => clients.id, { onDelete: "restrict", onUpdate: "cascade" }),
  orderId: text("order_id").references(() => orders.id, { onDelete: "restrict", onUpdate: "cascade" }),
  contractId: text("contract_id").references(() => contracts.id, { onDelete: "restrict", onUpdate: "cascade" }),
  stageId: text("stage_id").references(() => projectStages.id, { onDelete: "restrict", onUpdate: "cascade" }),
  number: text("number").notNull(), title: text("title").notNull(), status: text("status").notNull().default("DRAFT"),
  responsibleUserId: text("responsible_user_id").notNull().references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
  currentVersionId: text("current_version_id").references((): AnyPgColumn => additionalWorkVersions.id, { onDelete: "restrict", onUpdate: "cascade" }),
  approvedVersionId: text("approved_version_id").references((): AnyPgColumn => additionalWorkVersions.id, { onDelete: "restrict", onUpdate: "cascade" }),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
  approvedByClientPortalUserId: text("approved_by_client_portal_user_id").references((): AnyPgColumn => clientPortalUsers.id, { onDelete: "restrict", onUpdate: "cascade" }),
  cancelledAt: integer("cancelled_at"), cancellationReason: text("cancellation_reason"), ...timestamps,
}, table => [
  unique("additional_works_number_unique").on(table.number),
  index("idx_additional_works_project_created").on(table.projectId, table.createdAt),
  index("idx_additional_works_client_status").on(table.clientId, table.status),
  index("idx_additional_works_responsible_status").on(table.responsibleUserId, table.status),
  check("additional_works_status_check", sql`${table.status} IN ('DRAFT','READY','SENT','AWAITING_CLIENT_APPROVAL','APPROVED','REJECTED','CANCELLED','SUPERSEDED')`),
]);

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
    reason: text("reason").notNull().default("OTHER"), clientDescription: text("client_description").notNull().default(""), internalComment: text("internal_comment"),
    scheduleImpactType: text("schedule_impact_type").notNull().default("NO_IMPACT"), sentAt: integer("sent_at"),
    sentByUserId: text("sent_by_user_id").references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }), rejectedAt: integer("rejected_at"),
    clientDecisionComment: text("client_decision_comment"), approvedByClientPortalUserId: text("approved_by_client_portal_user_id").references((): AnyPgColumn => clientPortalUsers.id, { onDelete: "restrict", onUpdate: "cascade" }),
    manualApprovalReason: text("manual_approval_reason"), taskCreationMode: text("task_creation_mode").notNull().default("NONE"), paymentDueDate: integer("payment_due_date"),
    scheduleAppliedAt: integer("schedule_applied_at"), scheduleAppliedByUserId: text("schedule_applied_by_user_id").references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
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
    index("idx_additional_work_versions_container_status").on(table.additionalWorkId, table.status, table.version),
  ],
);

export const additionalWorkItems = pgTable("additional_work_items", {
  id: text("id").primaryKey(), additionalWorkVersionId: text("additional_work_version_id").notNull().references(() => additionalWorkVersions.id, { onDelete: "restrict", onUpdate: "cascade" }),
  position: integer("position").notNull(), name: text("name").notNull(), description: text("description"), quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(), unit: text("unit").notNull(),
  clientUnitPriceKopecks: integer("client_unit_price_kopecks").notNull(), clientTotalKopecks: integer("client_total_kopecks").notNull(), internalUnitCostKopecks: integer("internal_unit_cost_kopecks"), ...timestamps,
}, table => [unique("additional_work_items_position_unique").on(table.additionalWorkVersionId, table.position), index("idx_additional_work_items_version").on(table.additionalWorkVersionId, table.position)]);

export const additionalWorkEvents = pgTable("additional_work_events", {
  id: text("id").primaryKey(), additionalWorkId: text("additional_work_id").notNull().references(() => additionalWorks.id, { onDelete: "restrict", onUpdate: "cascade" }),
  additionalWorkVersionId: text("additional_work_version_id").references(() => additionalWorkVersions.id, { onDelete: "restrict", onUpdate: "cascade" }), type: text("type").notNull(),
  employeeUserId: text("employee_user_id").references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }), clientPortalUserId: text("client_portal_user_id").references((): AnyPgColumn => clientPortalUsers.id, { onDelete: "restrict", onUpdate: "cascade" }),
  comment: text("comment"), metadataJson: jsonb("metadata_json").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`), occurredAt: integer("occurred_at").notNull(),
}, table => [index("idx_additional_work_events_work_time").on(table.additionalWorkId, table.occurredAt)]);

export const additionalWorkProposedTasks = pgTable("additional_work_proposed_tasks", {
  id: text("id").primaryKey(), additionalWorkVersionId: text("additional_work_version_id").notNull().references(() => additionalWorkVersions.id, { onDelete: "restrict", onUpdate: "cascade" }),
  stageId: text("stage_id").references(() => projectStages.id, { onDelete: "restrict", onUpdate: "cascade" }), position: integer("position").notNull(), title: text("title").notNull(), description: text("description"),
  progressType: text("progress_type").notNull().default("BINARY"), quantity: numeric("quantity", { precision: 14, scale: 3 }), unit: text("unit"), typicalDurationDays: integer("typical_duration_days"), clientVisible: integer("client_visible").notNull().default(1), ...timestamps,
}, table => [unique("additional_work_proposed_tasks_position_unique").on(table.additionalWorkVersionId, table.position), index("idx_additional_work_proposed_tasks_version").on(table.additionalWorkVersionId, table.position)]);

export const additionalWorkTaskLinks = pgTable("additional_work_task_links", {
  id: text("id").primaryKey(), additionalWorkId: text("additional_work_id").notNull().references(() => additionalWorks.id, { onDelete: "restrict", onUpdate: "cascade" }),
  additionalWorkVersionId: text("additional_work_version_id").notNull().references(() => additionalWorkVersions.id, { onDelete: "restrict", onUpdate: "cascade" }), proposedTaskId: text("proposed_task_id").notNull().references(() => additionalWorkProposedTasks.id, { onDelete: "restrict", onUpdate: "cascade" }),
  taskId: text("task_id").notNull().references(() => tasks.id, { onDelete: "restrict", onUpdate: "cascade" }), createdAt: integer("created_at").notNull(),
}, table => [unique("additional_work_task_links_proposed_unique").on(table.proposedTaskId), unique("additional_work_task_links_task_unique").on(table.taskId), index("idx_additional_work_task_links_version").on(table.additionalWorkVersionId)]);

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
    authorUserId: text("author_user_id").references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    commentClientVisible: integer("comment_client_visible").notNull().default(0),
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

export const taskDependencies = pgTable("task_dependencies", {
  id:text("id").primaryKey(), projectId:text("project_id").notNull().references(()=>projects.id,{onDelete:"restrict",onUpdate:"cascade"}),
  predecessorTaskId:text("predecessor_task_id").notNull().references(()=>tasks.id,{onDelete:"restrict",onUpdate:"cascade"}), successorTaskId:text("successor_task_id").notNull().references(()=>tasks.id,{onDelete:"restrict",onUpdate:"cascade"}),
  type:text("type").notNull().default("FINISH_TO_START"), lagDays:integer("lag_days").notNull().default(0), createdByUserId:text("created_by_user_id").notNull().references(()=>users.id,{onDelete:"restrict",onUpdate:"cascade"}), createdAt:integer("created_at").notNull(),
},table=>[uniqueIndex("task_dependencies_unique").on(table.predecessorTaskId,table.successorTaskId),index("idx_task_dependencies_predecessor").on(table.predecessorTaskId),index("idx_task_dependencies_successor").on(table.successorTaskId)]);

export const taskContractors = pgTable("task_contractors", {
  id:text("id").primaryKey(),taskId:text("task_id").notNull().references(()=>tasks.id,{onDelete:"restrict",onUpdate:"cascade"}),contractorAgreementId:text("contractor_agreement_id").notNull().references(()=>contractorAgreements.id,{onDelete:"restrict",onUpdate:"cascade"}),createdAt:integer("created_at").notNull(),
},table=>[uniqueIndex("task_contractors_unique").on(table.taskId,table.contractorAgreementId)]);

export const dailyReportWorkers = pgTable("daily_report_workers", {
  id:text("id").primaryKey(),dailyReportId:text("daily_report_id").notNull().references(()=>dailyReports.id,{onDelete:"restrict",onUpdate:"cascade"}),workerType:text("worker_type").notNull(),employeeId:text("employee_id").references(()=>employees.id,{onDelete:"restrict",onUpdate:"cascade"}),contractorId:text("contractor_id").references(()=>contractors.id,{onDelete:"restrict",onUpdate:"cascade"}),createdAt:integer("created_at").notNull(),
},table=>[index("idx_daily_report_workers_report").on(table.dailyReportId)]);

export const dailyReportTasks = pgTable("daily_report_tasks", {
  id:text("id").primaryKey(),dailyReportId:text("daily_report_id").notNull().references(()=>dailyReports.id,{onDelete:"restrict",onUpdate:"cascade"}),taskId:text("task_id").notNull().references(()=>tasks.id,{onDelete:"restrict",onUpdate:"cascade"}),createdAt:integer("created_at").notNull(),
},table=>[uniqueIndex("daily_report_tasks_unique").on(table.dailyReportId,table.taskId)]);

export const taskPhotoRequirements = pgTable("task_photo_requirements", {
  id:text("id").primaryKey(),taskId:text("task_id").notNull().references(()=>tasks.id,{onDelete:"restrict",onUpdate:"cascade"}),name:text("name").notNull(),description:text("description"),type:text("type").notNull().default("HIDDEN_WORK"),requiredBeforeCompletion:integer("required_before_completion").notNull().default(1),position:integer("position").notNull(),...timestamps,
},table=>[index("idx_photo_requirements_task").on(table.taskId,table.position)]);

export const productionPlanTemplates = pgTable("production_plan_templates", {
  id:text("id").primaryKey(),name:text("name").notNull(),status:text("status").notNull().default("ACTIVE"),version:integer("version").notNull().default(1),createdByUserId:text("created_by_user_id").notNull().references(()=>users.id,{onDelete:"restrict",onUpdate:"cascade"}),archivedAt:integer("archived_at"),...timestamps,
},table=>[index("idx_production_templates_status").on(table.status)]);

export const productionStageTemplates = pgTable("production_stage_templates", {
  id:text("id").primaryKey(),templateId:text("template_id").notNull().references(()=>productionPlanTemplates.id,{onDelete:"restrict",onUpdate:"cascade"}),name:text("name").notNull(),position:integer("position").notNull(),weight:numeric("weight",{precision:5,scale:2}).notNull(),clientAcceptanceRequired:integer("client_acceptance_required").notNull().default(0),...timestamps,
});

export const productionTaskTemplates = pgTable("production_task_templates", {
  id:text("id").primaryKey(),stageTemplateId:text("stage_template_id").notNull().references(()=>productionStageTemplates.id,{onDelete:"restrict",onUpdate:"cascade"}),name:text("name").notNull(),description:text("description"),position:integer("position").notNull(),weight:numeric("weight",{precision:5,scale:2}).notNull(),progressType:text("progress_type").notNull(),unit:text("unit"),typicalQuantity:numeric("typical_quantity",{precision:14,scale:2}),typicalDurationDays:integer("typical_duration_days").notNull(),clientVisible:integer("client_visible").notNull().default(1),...timestamps,
});

export const productionTaskDependencyTemplates = pgTable("production_task_dependency_templates", {
  id:text("id").primaryKey(),templateId:text("template_id").notNull().references(()=>productionPlanTemplates.id,{onDelete:"restrict",onUpdate:"cascade"}),predecessorTaskTemplateId:text("predecessor_task_template_id").notNull().references(()=>productionTaskTemplates.id,{onDelete:"restrict",onUpdate:"cascade"}),successorTaskTemplateId:text("successor_task_template_id").notNull().references(()=>productionTaskTemplates.id,{onDelete:"restrict",onUpdate:"cascade"}),lagDays:integer("lag_days").notNull().default(0),createdAt:integer("created_at").notNull(),
});

export const productionPhotoRequirementTemplates = pgTable("production_photo_requirement_templates", {
  id:text("id").primaryKey(),taskTemplateId:text("task_template_id").notNull().references(()=>productionTaskTemplates.id,{onDelete:"restrict",onUpdate:"cascade"}),name:text("name").notNull(),description:text("description"),position:integer("position").notNull(),requiredBeforeCompletion:integer("required_before_completion").notNull().default(1),createdAt:integer("created_at").notNull(),
});

export const projectScheduleEvents = pgTable("project_schedule_events", {
  id:text("id").primaryKey(),projectId:text("project_id").notNull().references(()=>projects.id,{onDelete:"restrict",onUpdate:"cascade"}),actorUserId:text("actor_user_id").notNull().references(()=>users.id,{onDelete:"restrict",onUpdate:"cascade"}),type:text("type").notNull(),previousForecastEndDate:integer("previous_forecast_end_date"),newForecastEndDate:integer("new_forecast_end_date"),reason:text("reason"),metadataJson:jsonb("metadata_json").notNull().default({}),occurredAt:integer("occurred_at").notNull(),
},table=>[index("idx_schedule_events_project_time").on(table.projectId,table.occurredAt)]);

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
    obligationType: text("obligation_type"),
    stageId: text("stage_id").references(() => projectStages.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    paymentPlanVersion: integer("payment_plan_version").notNull().default(1),
    sourceKey: text("source_key"),
    currency: text("currency").notNull().default("RUB"),
    cancelledAt: integer("cancelled_at"),
    additionalWorkId: text("additional_work_id").references(() => additionalWorks.id, { onDelete: "restrict", onUpdate: "cascade" }),
    additionalWorkVersionId: text("additional_work_version_id").references(() => additionalWorkVersions.id, { onDelete: "restrict", onUpdate: "cascade" }),
    ...timestamps,
  },
  (table) => [
    index("idx_obligations_status_due").on(table.status, table.dueDate),
    index("idx_obligations_counterparty").on(
      table.counterpartyType,
      table.counterpartyId,
    ),
    index("idx_obligations_project").on(table.projectId),
    index("idx_obligations_stage").on(table.stageId),
    index("idx_obligations_additional_work").on(table.additionalWorkId, table.additionalWorkVersionId),
    uniqueIndex("obligations_source_key_unique").on(table.sourceKey).where(sql`${table.sourceKey} IS NOT NULL`),
  ],
);

export const clientPortalUsers = pgTable("client_portal_users", {
  id: text("id").primaryKey(), clientId: text("client_id").notNull().references(() => clients.id, { onDelete: "restrict", onUpdate: "cascade" }),
  loginIdentifier: text("login_identifier").notNull(), loginIdentifierNormalized: text("login_identifier_normalized").notNull(),
  passwordHash: text("password_hash").notNull(), passwordSalt: text("password_salt").notNull(), passwordIterations: integer("password_iterations").notNull(),
  status: text("status").notNull().default("ACTIVE"), lastLoginAt: integer("last_login_at"), ...timestamps,
}, table => [uniqueIndex("client_portal_users_client_unique").on(table.clientId), uniqueIndex("client_portal_users_login_unique").on(table.loginIdentifierNormalized)]);

export const clientPortalSessions = pgTable("client_portal_sessions", {
  id: text("id").primaryKey(), portalUserId: text("portal_user_id").notNull().references(() => clientPortalUsers.id, { onDelete: "restrict", onUpdate: "cascade" }),
  tokenHash: text("token_hash").notNull(), createdAt: integer("created_at").notNull(), lastSeenAt: integer("last_seen_at").notNull(), expiresAt: integer("expires_at").notNull(), revokedAt: integer("revoked_at"), userAgent: text("user_agent"),
}, table => [uniqueIndex("client_portal_sessions_token_unique").on(table.tokenHash), index("idx_client_portal_sessions_user_expires").on(table.portalUserId, table.expiresAt)]);

export const clientPortalInvites = pgTable("client_portal_invites", {
  id: text("id").primaryKey(), clientId: text("client_id").notNull().references(() => clients.id, { onDelete: "restrict", onUpdate: "cascade" }), tokenHash: text("token_hash").notNull(), loginIdentifier: text("login_identifier").notNull(), expiresAt: integer("expires_at").notNull(), usedAt: integer("used_at"), revokedAt: integer("revoked_at"), createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }), createdAt: integer("created_at").notNull(),
}, table => [uniqueIndex("client_portal_invites_token_unique").on(table.tokenHash), index("idx_client_portal_invites_client_created").on(table.clientId, table.createdAt)]);

export const clientPortalAuditEvents = pgTable("client_portal_audit_events", {
  id: text("id").primaryKey(), action: text("action").notNull(), entityType: text("entity_type").notNull(), entityId: text("entity_id").notNull(), clientId: text("client_id").references(() => clients.id, { onDelete: "restrict", onUpdate: "cascade" }), clientPortalUserId: text("client_portal_user_id").references(() => clientPortalUsers.id, { onDelete: "restrict", onUpdate: "cascade" }), employeeUserId: text("employee_user_id").references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }), metadataJson: jsonb("metadata_json").notNull().default({}), occurredAt: integer("occurred_at").notNull(),
}, table => [index("idx_client_portal_audit_entity_time").on(table.entityType, table.entityId, table.occurredAt)]);

export const projectHandovers = pgTable("project_handovers", {
  id: text("id").primaryKey(), projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "restrict", onUpdate: "cascade" }),
  status: text("status").notNull().default("NOT_READY"), currentRoundId: text("current_round_id"), preparedAt: integer("prepared_at"), preparedByUserId: text("prepared_by_user_id").references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
  sentAt: integer("sent_at"), sentByUserId: text("sent_by_user_id").references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }), acceptedAt: integer("accepted_at"),
  acceptedByClientPortalUserId: text("accepted_by_client_portal_user_id").references(() => clientPortalUsers.id, { onDelete: "restrict", onUpdate: "cascade" }), manuallyAcceptedByUserId: text("manually_accepted_by_user_id").references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
  manualAcceptanceReason: text("manual_acceptance_reason"), actualHandoverAt: integer("actual_handover_at"), warrantyStartsAt: integer("warranty_starts_at"), cancelledAt: integer("cancelled_at"), cancelledByUserId: text("cancelled_by_user_id").references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }), cancellationReason: text("cancellation_reason"), finalSnapshotJson: jsonb("final_snapshot_json"), ...timestamps,
}, table => [uniqueIndex("project_handovers_project_unique").on(table.projectId), index("idx_project_handovers_status_updated").on(table.status, table.updatedAt)]);

export const projectHandoverRounds = pgTable("project_handover_rounds", {
  id: text("id").primaryKey(), handoverId: text("handover_id").notNull().references(() => projectHandovers.id, { onDelete: "restrict", onUpdate: "cascade" }), projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "restrict", onUpdate: "cascade" }), roundNumber: integer("round_number").notNull(), status: text("status").notNull().default("OPEN"), openedAt: integer("opened_at").notNull(), openedByUserId: text("opened_by_user_id").references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }), openedByClientPortalUserId: text("opened_by_client_portal_user_id").references(() => clientPortalUsers.id, { onDelete: "restrict", onUpdate: "cascade" }), submittedAt: integer("submitted_at"), submittedByClientPortalUserId: text("submitted_by_client_portal_user_id").references(() => clientPortalUsers.id, { onDelete: "restrict", onUpdate: "cascade" }), acceptedAt: integer("accepted_at"), acceptedByClientPortalUserId: text("accepted_by_client_portal_user_id").references(() => clientPortalUsers.id, { onDelete: "restrict", onUpdate: "cascade" }), supersededAt: integer("superseded_at"), clientComment: text("client_comment"), ...timestamps,
}, table => [unique("project_handover_rounds_number_unique").on(table.handoverId, table.roundNumber), uniqueIndex("project_handover_rounds_open_unique").on(table.handoverId).where(sql`${table.status}='OPEN'`), index("idx_project_handover_rounds_project_time").on(table.projectId, table.createdAt)]);

export const projectHandoverDefects = pgTable("project_handover_defects", {
  id: text("id").primaryKey(), handoverId: text("handover_id").notNull().references(() => projectHandovers.id, { onDelete: "restrict", onUpdate: "cascade" }), roundId: text("round_id").notNull().references(() => projectHandoverRounds.id, { onDelete: "restrict", onUpdate: "cascade" }), projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "restrict", onUpdate: "cascade" }), defectNumber: integer("defect_number").notNull(), title: text("title").notNull(), description: text("description").notNull(), location: text("location"), priority: text("priority").notNull().default("NORMAL"), status: text("status").notNull().default("OPEN"), createdByClientPortalUserId: text("created_by_client_portal_user_id").references(() => clientPortalUsers.id, { onDelete: "restrict", onUpdate: "cascade" }), createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }), assignedToUserId: text("assigned_to_user_id").references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }), internalComment: text("internal_comment"), resolutionComment: text("resolution_comment"), resolvedAt: integer("resolved_at"), resolvedByUserId: text("resolved_by_user_id").references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }), acceptedAt: integer("accepted_at"), acceptedByClientPortalUserId: text("accepted_by_client_portal_user_id").references(() => clientPortalUsers.id, { onDelete: "restrict", onUpdate: "cascade" }), disputedAt: integer("disputed_at"), disputeComment: text("dispute_comment"), cancelledAt: integer("cancelled_at"), cancelledByUserId: text("cancelled_by_user_id").references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }), ...timestamps,
}, table => [unique("project_handover_defects_number_unique").on(table.projectId, table.defectNumber), index("idx_project_handover_defects_handover_status").on(table.handoverId, table.status, table.createdAt), index("idx_project_handover_defects_round").on(table.roundId, table.createdAt), index("idx_project_handover_defects_assignee").on(table.assignedToUserId, table.status)]);

export const projectHandoverEvents = pgTable("project_handover_events", { id: text("id").primaryKey(), handoverId: text("handover_id").notNull().references(() => projectHandovers.id, { onDelete: "restrict", onUpdate: "cascade" }), projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "restrict", onUpdate: "cascade" }), roundId: text("round_id").references(() => projectHandoverRounds.id, { onDelete: "restrict", onUpdate: "cascade" }), type: text("type").notNull(), employeeUserId: text("employee_user_id").references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }), clientPortalUserId: text("client_portal_user_id").references(() => clientPortalUsers.id, { onDelete: "restrict", onUpdate: "cascade" }), comment: text("comment"), metadataJson: jsonb("metadata_json").notNull().default({}), occurredAt: integer("occurred_at").notNull() }, table => [index("idx_project_handover_events_handover_time").on(table.handoverId, table.occurredAt)]);

export const projectHandoverDefectEvents = pgTable("project_handover_defect_events", { id: text("id").primaryKey(), defectId: text("defect_id").notNull().references(() => projectHandoverDefects.id, { onDelete: "restrict", onUpdate: "cascade" }), handoverId: text("handover_id").notNull().references(() => projectHandovers.id, { onDelete: "restrict", onUpdate: "cascade" }), projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "restrict", onUpdate: "cascade" }), type: text("type").notNull(), employeeUserId: text("employee_user_id").references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }), clientPortalUserId: text("client_portal_user_id").references(() => clientPortalUsers.id, { onDelete: "restrict", onUpdate: "cascade" }), comment: text("comment"), metadataJson: jsonb("metadata_json").notNull().default({}), occurredAt: integer("occurred_at").notNull() }, table => [index("idx_project_handover_defect_events_defect_time").on(table.defectId, table.occurredAt)]);

export const handoverChecklistTemplates = pgTable("handover_checklist_templates", { id: text("id").primaryKey(), name: text("name").notNull(), version: integer("version").notNull(), status: text("status").notNull().default("ACTIVE"), createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }), ...timestamps });

export const handoverChecklistTemplateItems = pgTable("handover_checklist_template_items", { id: text("id").primaryKey(), templateId: text("template_id").notNull().references(() => handoverChecklistTemplates.id, { onDelete: "restrict", onUpdate: "cascade" }), position: integer("position").notNull(), title: text("title").notNull(), required: integer("required").notNull().default(1), ...timestamps }, table => [unique("handover_checklist_template_items_position_unique").on(table.templateId, table.position)]);

export const projectHandoverRoundChecklistItems = pgTable("project_handover_round_checklist_items", { id: text("id").primaryKey(), roundId: text("round_id").notNull().references(() => projectHandoverRounds.id, { onDelete: "restrict", onUpdate: "cascade" }), templateItemId: text("template_item_id").references(() => handoverChecklistTemplateItems.id, { onDelete: "restrict", onUpdate: "cascade" }), position: integer("position").notNull(), title: text("title").notNull(), required: integer("required").notNull().default(1), checked: integer("checked").notNull().default(0), comment: text("comment"), ...timestamps }, table => [unique("project_handover_round_checklist_position_unique").on(table.roundId, table.position)]);

export const handoverDefectTaskLinks = pgTable("handover_defect_task_links", { id: text("id").primaryKey(), defectId: text("defect_id").notNull().references(() => projectHandoverDefects.id, { onDelete: "restrict", onUpdate: "cascade" }), taskId: text("task_id").notNull().references(() => tasks.id, { onDelete: "restrict", onUpdate: "cascade" }), createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }), createdAt: integer("created_at").notNull() }, table => [unique("handover_defect_task_links_defect_task_unique").on(table.defectId, table.taskId), index("idx_handover_defect_task_links_task").on(table.taskId)]);

export const apartmentPassports = pgTable("apartment_passports", {
  id: text("id").primaryKey(), projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "restrict", onUpdate: "cascade" }), clientId: text("client_id").notNull().references(() => clients.id, { onDelete: "restrict", onUpdate: "cascade" }), status: text("status").notNull().default("DRAFT"),
  currentPublishedVersionId: text("current_published_version_id"), coverAttachmentId: text("cover_attachment_id").references(() => attachments.id, { onDelete: "restrict", onUpdate: "cascade" }), customNote: text("custom_note"), financialSummaryEnabled: integer("financial_summary_enabled").notNull().default(1), excludedAttachmentIdsJson: jsonb("excluded_attachment_ids_json").$type<string[]>().notNull().default([]), attachmentCaptionsJson: jsonb("attachment_captions_json").$type<Record<string,string>>().notNull().default({}), publishedAt: integer("published_at"), publishedByUserId: text("published_by_user_id").references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }), archivedAt: integer("archived_at"), archivedByUserId: text("archived_by_user_id").references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }), archiveReason: text("archive_reason"), ...timestamps,
}, table => [uniqueIndex("apartment_passports_project_unique").on(table.projectId), index("idx_apartment_passports_client_status").on(table.clientId, table.status, table.updatedAt)]);

export const apartmentPassportSections = pgTable("apartment_passport_sections", {
  id: text("id").primaryKey(), passportId: text("passport_id").notNull().references(() => apartmentPassports.id, { onDelete: "restrict", onUpdate: "cascade" }), sectionKey: text("section_key").notNull(), enabled: integer("enabled").notNull().default(1), position: integer("position").notNull(), ...timestamps,
}, table => [unique("apartment_passport_sections_unique").on(table.passportId, table.sectionKey), unique("apartment_passport_sections_position_unique").on(table.passportId, table.position)]);

export const apartmentPassportVersions = pgTable("apartment_passport_versions", {
  id: text("id").primaryKey(), passportId: text("passport_id").notNull().references(() => apartmentPassports.id, { onDelete: "restrict", onUpdate: "cascade" }), versionNumber: integer("version_number").notNull(), snapshotJson: jsonb("snapshot_json").$type<Record<string, unknown>>().notNull(), sourceManifestJson: jsonb("source_manifest_json").$type<Record<string, unknown>>().notNull(), sourceHash: text("source_hash").notNull(), releaseNote: text("release_note"), publishedByUserId: text("published_by_user_id").notNull().references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }), publishedAt: integer("published_at").notNull(), createdAt: integer("created_at").notNull(),
}, table => [unique("apartment_passport_versions_number_unique").on(table.passportId, table.versionNumber), unique("apartment_passport_versions_identity_unique").on(table.id, table.passportId), index("idx_apartment_passport_versions_passport_published").on(table.passportId, table.publishedAt)]);

export const apartmentPassportVersionAttachments = pgTable("apartment_passport_version_attachments", {
  id: text("id").primaryKey(), passportVersionId: text("passport_version_id").notNull().references(() => apartmentPassportVersions.id, { onDelete: "restrict", onUpdate: "cascade" }), attachmentId: text("attachment_id").notNull().references(() => attachments.id, { onDelete: "restrict", onUpdate: "cascade" }), sectionKey: text("section_key").notNull(), position: integer("position").notNull(), caption: text("caption"), displayNameSnapshot: text("display_name_snapshot").notNull(), mimeTypeSnapshot: text("mime_type_snapshot").notNull(), sizeBytesSnapshot: integer("size_bytes_snapshot").notNull(), createdAt: integer("created_at").notNull(),
}, table => [unique("apartment_passport_version_attachment_unique").on(table.passportVersionId, table.attachmentId, table.sectionKey), index("idx_apartment_passport_version_attachments_page").on(table.passportVersionId, table.sectionKey, table.position, table.id)]);

export const apartmentPassportEvents = pgTable("apartment_passport_events", {
  id: text("id").primaryKey(), passportId: text("passport_id").notNull().references(() => apartmentPassports.id, { onDelete: "restrict", onUpdate: "cascade" }), passportVersionId: text("passport_version_id").references(() => apartmentPassportVersions.id, { onDelete: "restrict", onUpdate: "cascade" }), projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "restrict", onUpdate: "cascade" }), type: text("type").notNull(), employeeUserId: text("employee_user_id").notNull().references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }), comment: text("comment"), metadataJson: jsonb("metadata_json").$type<Record<string, unknown>>().notNull().default({}), occurredAt: integer("occurred_at").notNull(),
}, table => [index("idx_apartment_passport_events_passport_time").on(table.passportId, table.occurredAt)]);

export const stageAcceptanceEvents = pgTable("stage_acceptance_events", {
  id: text("id").primaryKey(), projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "restrict", onUpdate: "cascade" }), stageId: text("stage_id").notNull().references(() => projectStages.id, { onDelete: "restrict", onUpdate: "cascade" }), type: text("type").notNull(), clientPortalUserId: text("client_portal_user_id").references(() => clientPortalUsers.id, { onDelete: "restrict", onUpdate: "cascade" }), employeeUserId: text("employee_user_id").references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }), comment: text("comment"), createdAt: integer("created_at").notNull(),
}, table => [index("idx_stage_acceptance_events_stage_time").on(table.stageId, table.createdAt)]);

export const projectStagePaymentTerms = pgTable("project_stage_payment_terms", {
  id: text("id").primaryKey(), projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "restrict", onUpdate: "cascade" }), stageId: text("stage_id").notNull().references(() => projectStages.id, { onDelete: "restrict", onUpdate: "cascade" }), stageAmountKopecks: integer("stage_amount_kopecks").notNull(), requiredAdvanceKopecks: integer("required_advance_kopecks").notNull().default(0), currency: text("currency").notNull().default("RUB"), position: integer("position").notNull(), paymentPlanVersion: integer("payment_plan_version").notNull().default(1), active: integer("active").notNull().default(1), ...timestamps,
}, table => [uniqueIndex("project_stage_payment_terms_stage_version_unique").on(table.stageId, table.paymentPlanVersion), index("idx_stage_payment_terms_project_position").on(table.projectId, table.paymentPlanVersion, table.position)]);

export const clientPaymentClaims = pgTable("client_payment_claims", {
  id: text("id").primaryKey(), clientId: text("client_id").notNull().references(() => clients.id, { onDelete: "restrict", onUpdate: "cascade" }), projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "restrict", onUpdate: "cascade" }), portalUserId: text("portal_user_id").notNull().references(() => clientPortalUsers.id, { onDelete: "restrict", onUpdate: "cascade" }), claimedAmountKopecks: integer("claimed_amount_kopecks").notNull(), confirmedAmountKopecks: integer("confirmed_amount_kopecks"), paymentMethod: text("payment_method"), clientComment: text("client_comment"), status: text("status").notNull().default("PENDING"), claimedAt: integer("claimed_at").notNull(), receivedAt: integer("received_at"), confirmedAt: integer("confirmed_at"), confirmedByUserId: text("confirmed_by_user_id").references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }), rejectedAt: integer("rejected_at"), rejectedByUserId: text("rejected_by_user_id").references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }), rejectionComment: text("rejection_comment"), cancelledAt: integer("cancelled_at"), ...timestamps,
}, table => [index("idx_client_payment_claims_project_status").on(table.projectId, table.status, table.createdAt)]);

export const clientPaymentClaimObligations = pgTable("client_payment_claim_obligations", {
  id: text("id").primaryKey(), claimId: text("claim_id").notNull().references(() => clientPaymentClaims.id, { onDelete: "restrict", onUpdate: "cascade" }), obligationId: text("obligation_id").notNull().references(() => obligations.id, { onDelete: "restrict", onUpdate: "cascade" }), intendedAmountKopecks: integer("intended_amount_kopecks").notNull(), position: integer("position").notNull(), createdAt: integer("created_at").notNull(),
}, table => [uniqueIndex("client_payment_claim_obligations_unique").on(table.claimId, table.obligationId)]);

export const obligationPaymentAllocations = pgTable("obligation_payment_allocations", {
  id: text("id").primaryKey(), obligationId: text("obligation_id").notNull().references(() => obligations.id, { onDelete: "restrict", onUpdate: "cascade" }), financialTransactionId: text("financial_transaction_id").notNull().references(() => financialTransactions.id, { onDelete: "restrict", onUpdate: "cascade" }), amountKopecks: integer("amount_kopecks").notNull(), createdAt: integer("created_at").notNull(), createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
}, table => [uniqueIndex("obligation_allocations_unique").on(table.obligationId, table.financialTransactionId), index("idx_obligation_allocations_transaction").on(table.financialTransactionId)]);

export const clientUnappliedFunds = pgTable("client_unapplied_funds", {
  id: text("id").primaryKey(), clientId: text("client_id").notNull().references(() => clients.id, { onDelete: "restrict", onUpdate: "cascade" }), projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "restrict", onUpdate: "cascade" }), financialTransactionId: text("financial_transaction_id").notNull().references(() => financialTransactions.id, { onDelete: "restrict", onUpdate: "cascade" }), amountKopecks: integer("amount_kopecks").notNull(), remainingKopecks: integer("remaining_kopecks").notNull(), createdAt: integer("created_at").notNull(),
}, table => [uniqueIndex("client_unapplied_funds_transaction_unique").on(table.financialTransactionId)]);
