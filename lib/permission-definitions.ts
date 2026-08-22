export const MODULE_DEFINITIONS = [
  { key: "dashboard", permission: "modules.dashboard.view", label: "Обзор" },
  { key: "crm", permission: "modules.crm.view", label: "CRM" },
  { key: "clients", permission: "modules.clients.view", label: "Клиенты" },
  { key: "orders", permission: "modules.orders.view", label: "Заказы" },
  { key: "projects", permission: "modules.projects.view", label: "Объекты" },
  { key: "tasks", permission: "modules.tasks.view", label: "Задачи" },
  { key: "finance", permission: "modules.finance.view", label: "Финансы" },
  { key: "team", permission: "modules.team.view", label: "Команда" },
  { key: "contractors", permission: "modules.contractors.view", label: "Исполнители" },
  { key: "documents", permission: "modules.documents.view", label: "Документы" },
] as const;

export type ModuleKey = (typeof MODULE_DEFINITIONS)[number]["key"];
export type ModulePermission = (typeof MODULE_DEFINITIONS)[number]["permission"];

export const ACTION_GROUPS = [
  { module: "crm", label: "CRM", actions: [
    ["crm.view", "Просматривать"], ["crm.create", "Создавать лиды"], ["crm.edit", "Редактировать"],
    ["crm.changeStatus", "Менять статус"], ["crm.assign", "Назначать ответственного"], ["crm.close", "Закрывать лиды"],
  ] },
  { module: "clients", label: "Клиенты", actions: [
    ["clients.view", "Просматривать"], ["clients.create", "Создавать"], ["clients.edit", "Редактировать"],
  ] },
  { module: "orders", label: "Заказы", actions: [
    ["orders.view", "Просматривать"], ["orders.create", "Создавать"], ["orders.edit", "Редактировать"],
    ["orders.complete", "Завершать"], ["orders.cancel", "Отменять"], ["orders.viewFinance", "Просматривать финансы заказа"],
  ] },
  { module: "orders", label: "Дизайн-проекты", actions: [
    ["design.view", "Просматривать"], ["design.create", "Создавать"], ["design.edit", "Редактировать"],
    ["design.assignDesigner", "Назначать дизайнера"], ["design.stages.view", "Просматривать этапы"],
    ["design.stages.edit", "Управлять этапами"], ["design.stages.complete", "Завершать этапы"],
    ["design.files.view", "Просматривать файлы"], ["design.files.upload", "Загружать файлы"],
    ["design.files.manageVersions", "Управлять версиями"], ["design.files.archive", "Архивировать файлы"],
    ["design.viewFinance", "Просматривать коммерческие финансы"], ["design.complete", "Завершать дизайн-проект"],
  ] },
  { module: "orders", label: "Сметы и КП", actions: [
    ["estimates.view", "Просматривать"], ["estimates.create", "Создавать"], ["estimates.edit", "Редактировать черновики"],
    ["estimates.createVersion", "Создавать новую версию"], ["estimates.viewCost", "Просматривать себестоимость"],
    ["estimates.viewMargin", "Просматривать маржу"], ["estimates.sendProposal", "Формировать и отмечать отправку КП"],
    ["estimates.approve", "Отмечать согласование"], ["estimates.reject", "Отклонять"],
  ] },
  { module: "orders", label: "Договоры", actions: [
    ["contracts.view", "Просматривать"], ["contracts.create", "Создавать"], ["contracts.edit", "Редактировать черновики"],
    ["contracts.createVersion", "Создавать новую версию"], ["contracts.generateDocuments", "Формировать документы"],
    ["contracts.markSent", "Отмечать отправку"], ["contracts.markSigned", "Отмечать подписание"],
    ["contracts.uploadSigned", "Загружать подписанный договор"], ["contracts.cancel", "Отменять"],
    ["contracts.viewCompanyDetails", "Просматривать реквизиты компании"], ["companySettings.view", "Просматривать настройки компании"],
    ["companySettings.edit", "Редактировать настройки компании"],
  ] },
  { module: "projects", label: "Объекты", actions: [
    ["projects.view", "Просматривать"], ["projects.create", "Создавать"], ["projects.edit", "Редактировать"],
    ["projects.assignEmployees", "Назначать сотрудников"], ["projects.viewCost", "Просматривать себестоимость"], ["projects.viewMargin", "Просматривать маржу"],
  ] },
  { module: "projects", label: "Справочник ЖК", actions: [
    ["residentialComplexes.view", "Просматривать справочник"], ["residentialComplexes.create", "Добавлять ЖК"],
    ["residentialComplexes.edit", "Редактировать ЖК"], ["residentialComplexes.archive", "Архивировать и восстанавливать"],
  ] },
  { module: "tasks", label: "Задачи", actions: [
    ["tasks.view", "Просматривать"], ["tasks.create", "Создавать"], ["tasks.edit", "Редактировать"],
    ["tasks.complete", "Выполнять"], ["tasks.assign", "Назначать другому сотруднику"],
  ] },
  { module: "finance", label: "Финансы", actions: [
    ["finance.view", "Просматривать"], ["finance.createExpense", "Добавлять расходы"], ["finance.createIncome", "Добавлять поступления"],
    ["finance.createTransfer", "Перемещать средства"], ["finance.editTransaction", "Редактировать операции"],
    ["finance.viewClientFunds", "Просматривать средства клиентов"], ["finance.viewProfit", "Просматривать прибыль DEPA"],
    ["finance.viewAdministrativeExpenses", "Просматривать административные расходы"],
  ] },
  { module: "team", label: "Команда", actions: [
    ["team.view", "Просматривать"], ["team.createEmployee", "Создавать сотрудников"], ["team.editEmployee", "Редактировать сотрудников"],
    ["team.managePermissions", "Управлять правами"],
  ] },
  { module: "contractors", label: "Исполнители", actions: [
    ["contractors.view", "Просматривать"], ["contractors.create", "Создавать"], ["contractors.edit", "Редактировать"],
  ] },
  { module: "documents", label: "Документы", actions: [
    ["documents.view", "Просматривать"], ["documents.upload", "Загружать"], ["documents.edit", "Редактировать данные"],
    ["documents.archive", "Архивировать"],
  ] },
] as const;

export type ActionPermission = (typeof ACTION_GROUPS)[number]["actions"][number][0];

export const SCOPE_DEFINITIONS = [
  { key: "crm", permission: "crm.scope", module: "crm", label: "Просмотр лидов", ownLabel: "Только назначенные", allLabel: "Все лиды", default: "ASSIGNED" },
  { key: "clients", permission: "clients.scope", module: "clients", label: "Просмотр клиентов", ownLabel: "Только назначенные", allLabel: "Все клиенты", default: "ASSIGNED" },
  { key: "orders", permission: "orders.scope", module: "orders", label: "Просмотр заказов", ownLabel: "Только назначенные", allLabel: "Все заказы", default: "ASSIGNED" },
  { key: "design", permission: "design.scope", module: "orders", label: "Просмотр дизайн-проектов", ownLabel: "Только назначенные", allLabel: "Все дизайн-проекты", default: "ASSIGNED" },
  { key: "estimates", permission: "estimates.scope", module: "orders", label: "Просмотр смет", ownLabel: "Только назначенные", allLabel: "Все сметы", default: "ASSIGNED" },
  { key: "contracts", permission: "contracts.scope", module: "orders", label: "Просмотр договоров", ownLabel: "Только назначенные", allLabel: "Все договоры", default: "ASSIGNED" },
  { key: "projects", permission: "projects.scope", module: "projects", label: "Просмотр объектов", ownLabel: "Только назначенные", allLabel: "Все объекты", default: "ASSIGNED" },
  { key: "tasks", permission: "tasks.scope", module: "tasks", label: "Просмотр задач", ownLabel: "Только назначенные", allLabel: "Все задачи", default: "ASSIGNED" },
  { key: "cashboxes", permission: "finance.cashboxes.scope", module: "finance", label: "Просмотр касс", ownLabel: "Только своя", allLabel: "Все кассы", default: "OWN" },
  { key: "documents", permission: "documents.scope", module: "documents", label: "Просмотр документов", ownLabel: "Назначенные объекты", allLabel: "Все документы", default: "ASSIGNED_PROJECTS" },
] as const;

export type ScopeKey = (typeof SCOPE_DEFINITIONS)[number]["key"];
export type ScopePermission = (typeof SCOPE_DEFINITIONS)[number]["permission"];
export type ScopeValue = "OWN" | "ASSIGNED" | "ASSIGNED_PROJECTS" | "ALL";

export type AccessProfile = {
  isOwner: boolean;
  modules: Record<ModuleKey, boolean>;
  actions: Record<ActionPermission, boolean>;
  scopes: Record<ScopeKey, ScopeValue>;
  ownCashbox: boolean;
};

const moduleKeys = MODULE_DEFINITIONS.map((item) => item.key);
const actionKeys = ACTION_GROUPS.flatMap((group) => group.actions.map((item) => item[0]));

export function emptyAccessProfile(): AccessProfile {
  return {
    isOwner: false,
    modules: Object.fromEntries(moduleKeys.map((key) => [key, false])) as AccessProfile["modules"],
    actions: Object.fromEntries(actionKeys.map((key) => [key, false])) as AccessProfile["actions"],
    scopes: Object.fromEntries(SCOPE_DEFINITIONS.map((item) => [item.key, item.default])) as AccessProfile["scopes"],
    ownCashbox: false,
  };
}

export function ownerAccessProfile(): AccessProfile {
  const profile = emptyAccessProfile();
  profile.isOwner = true;
  for (const key of moduleKeys) profile.modules[key] = true;
  for (const key of actionKeys) profile.actions[key] = true;
  for (const key of Object.keys(profile.scopes) as ScopeKey[]) profile.scopes[key] = "ALL";
  profile.ownCashbox = true;
  return profile;
}

export const ACCESS_PRESETS = {
  FOREMAN: {
    label: "Бригадир",
    modules: ["dashboard", "projects", "tasks", "finance", "documents"],
    actions: ["projects.view", "projects.edit", "tasks.view", "tasks.create", "tasks.edit", "tasks.complete", "finance.view", "finance.createExpense", "finance.createTransfer", "documents.view", "documents.upload"],
    scopes: { projects: "ASSIGNED", tasks: "ASSIGNED", cashboxes: "OWN", documents: "ASSIGNED_PROJECTS" }, ownCashbox: true,
  },
  SUPPLIER: {
    label: "Снабженец",
    modules: ["dashboard", "projects", "tasks", "finance", "documents"],
    actions: ["projects.view", "tasks.view", "tasks.create", "tasks.edit", "tasks.complete", "finance.view", "finance.createExpense", "finance.createTransfer", "documents.view", "documents.upload"],
    scopes: { projects: "ASSIGNED", tasks: "ASSIGNED", cashboxes: "OWN", documents: "ASSIGNED_PROJECTS" }, ownCashbox: true,
  },
  ACCOUNTANT: {
    label: "Бухгалтер",
    modules: ["dashboard", "clients", "orders", "projects", "tasks", "finance", "team", "contractors", "documents"],
    actions: ["clients.view", "clients.edit", "orders.view", "orders.edit", "orders.viewFinance", "design.view", "design.viewFinance", "design.stages.view", "design.files.view", "contracts.view", "contracts.viewCompanyDetails", "companySettings.view", "projects.view", "tasks.view", "finance.view", "finance.editTransaction", "finance.viewClientFunds", "finance.viewProfit", "finance.viewAdministrativeExpenses", "team.view", "contractors.view", "documents.view", "documents.upload", "documents.edit"],
    scopes: { clients: "ALL", orders: "ALL", design: "ALL", contracts: "ALL", projects: "ALL", tasks: "ALL", cashboxes: "ALL", documents: "ALL" }, ownCashbox: false,
  },
  MANAGER: {
    label: "Менеджер",
    modules: ["dashboard", "crm", "clients", "orders", "projects", "tasks", "documents"],
    actions: ["crm.view", "crm.create", "crm.edit", "crm.changeStatus", "crm.assign", "crm.close", "clients.view", "clients.create", "clients.edit", "orders.view", "orders.create", "orders.edit", "orders.complete", "orders.cancel", "orders.viewFinance", "design.view", "design.create", "design.edit", "design.assignDesigner", "design.stages.view", "design.stages.edit", "design.stages.complete", "design.files.view", "design.files.upload", "design.files.manageVersions", "design.viewFinance", "design.complete", "estimates.view", "estimates.create", "estimates.edit", "estimates.createVersion", "estimates.sendProposal", "contracts.view", "contracts.create", "contracts.edit", "contracts.createVersion", "contracts.markSent", "contracts.markSigned", "contracts.uploadSigned", "contracts.viewCompanyDetails", "companySettings.view", "projects.view", "tasks.view", "tasks.create", "tasks.edit", "tasks.complete", "documents.view", "documents.upload"],
    scopes: { crm: "ASSIGNED", clients: "ASSIGNED", orders: "ASSIGNED", design: "ASSIGNED", estimates: "ASSIGNED", contracts: "ASSIGNED", projects: "ASSIGNED", tasks: "ASSIGNED", documents: "ASSIGNED_PROJECTS" }, ownCashbox: false,
  },
  CUSTOM: { label: "Настроить вручную", modules: [], actions: [], scopes: {}, ownCashbox: false },
} as const satisfies Record<string, { label: string; modules: readonly ModuleKey[]; actions: readonly ActionPermission[]; scopes: Partial<Record<ScopeKey, ScopeValue>>; ownCashbox: boolean }>;

export type AccessPreset = keyof typeof ACCESS_PRESETS;

export function profileFromPreset(preset: AccessPreset): AccessProfile {
  const profile = emptyAccessProfile();
  const definition = ACCESS_PRESETS[preset];
  for (const key of definition.modules) profile.modules[key] = true;
  for (const key of definition.actions) profile.actions[key] = true;
  Object.assign(profile.scopes, definition.scopes);
  profile.ownCashbox = definition.ownCashbox;
  return profile;
}

export function isModuleKey(value: string): value is ModuleKey {
  return moduleKeys.includes(value as ModuleKey);
}

export const MODULE_ROUTE_ALIASES: Record<string, ModuleKey> = {
  overview: "dashboard", crm: "crm", clients: "clients", orders: "orders", projects: "projects", objects: "projects",
  tasks: "tasks", finance: "finance", team: "team", contractors: "contractors", documents: "documents", docs: "documents",
};
