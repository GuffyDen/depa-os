import { createLocalPasswordCredential, type AuthUser } from "./auth";
import {
  ACCESS_PRESETS, ACTION_GROUPS, MODULE_DEFINITIONS, SCOPE_DEFINITIONS, emptyAccessProfile,
  type AccessPreset, type AccessProfile, type ScopeValue,
} from "./permission-definitions";
import { accessProfileFromRows } from "./permissions";
import { first, query, transaction } from "./postgres";

type DbPermissionRow = { user_id: string; permission: string; scope: string; allowed: string | number };
type CashboxSummary = { id: string; name: string; status: string; balanceKopecks: number } | null;

export type TeamAccessMember = {
  employeeId: string; userId: string | null; name: string; phone: string | null; position: string | null; employeeStatus: string;
  role: "OWNER" | "EMPLOYEE" | null; accessEnabled: boolean; username: string | null; isProtectedOwner: boolean;
  access: AccessProfile; cashbox: CashboxSummary;
};

export class TeamAccessError extends Error {
  constructor(message: string, public status = 400, public details?: Record<string, unknown>) { super(message); }
}

const booleanPermissions = [
  ...MODULE_DEFINITIONS.map((item) => item.permission),
  ...ACTION_GROUPS.flatMap((group) => group.actions.map(([permission]) => permission)),
  "finance.ownCashbox",
];
const scopePermissions = SCOPE_DEFINITIONS.map((item) => item.permission);
const managedPermissions = [...booleanPermissions, ...scopePermissions];

function nowSeconds() { return Math.floor(Date.now() / 1000); }
function cleanText(value: unknown, max: number) { return typeof value === "string" ? value.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max) : ""; }

export function normalizeAccessProfile(value: unknown): AccessProfile {
  const profile = emptyAccessProfile();
  if (!value || typeof value !== "object") return profile;
  const raw = value as { modules?: unknown; actions?: unknown; scopes?: unknown; ownCashbox?: unknown };
  if (raw.modules && typeof raw.modules === "object") for (const item of MODULE_DEFINITIONS) profile.modules[item.key] = (raw.modules as Record<string, unknown>)[item.key] === true;
  if (raw.actions && typeof raw.actions === "object") for (const group of ACTION_GROUPS) for (const [permission] of group.actions) profile.actions[permission] = (raw.actions as Record<string, unknown>)[permission] === true;
  if (raw.scopes && typeof raw.scopes === "object") for (const item of SCOPE_DEFINITIONS) {
    const selected = (raw.scopes as Record<string, unknown>)[item.key];
    if (["OWN", "ASSIGNED", "ASSIGNED_PROJECTS", "ALL"].includes(String(selected))) profile.scopes[item.key] = selected as ScopeValue;
  }
  profile.ownCashbox = raw.ownCashbox === true;
  return profile;
}

function personalCashboxName(userId: string, name: string) {
  if (userId === "user_owner_denis") return "Касса Дениса";
  if (userId === "user_owner_pavel") return "Касса Павла";
  const firstName = name.trim().split(/\s+/)[0] || "сотрудника";
  if (firstName.endsWith("й")) return `Касса ${firstName.slice(0, -1)}я`;
  if (firstName.endsWith("а")) return `Касса ${firstName.slice(0, -1)}ы`;
  if (firstName.endsWith("я")) return `Касса ${firstName.slice(0, -1)}и`;
  return `Касса ${firstName}а`;
}

function assertOwner(actor: AuthUser) {
  if (actor.role !== "OWNER") throw new TeamAccessError("Только Owner управляет сотрудниками и правами.", 403);
}

function auditStatement(actorId: string, action: string, entityType: string, entityId: string, timestamp: number, metadata: Record<string, unknown> = {}) {
  return { text: "INSERT INTO audit_logs (id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES ($1,$2,$3,$4,$5,$6,$7)", params: [crypto.randomUUID(), actorId, action, entityType, entityId, timestamp, JSON.stringify(metadata)] };
}

function profileSnapshot(profile: AccessProfile) {
  return {
    ...Object.fromEntries(MODULE_DEFINITIONS.map((item) => [item.permission, profile.modules[item.key]])),
    ...Object.fromEntries(ACTION_GROUPS.flatMap((group) => group.actions.map(([permission]) => [permission, profile.actions[permission]]))),
    ...Object.fromEntries(SCOPE_DEFINITIONS.map((item) => [item.permission, profile.scopes[item.key]])),
    "finance.ownCashbox": profile.ownCashbox,
  } as Record<string, boolean | ScopeValue>;
}

function permissionStatements(userId: string, profile: AccessProfile, timestamp: number) {
  const statements: { text: string; params: unknown[] }[] = [
    { text: "DELETE FROM user_permissions WHERE user_id=$1 AND permission=ANY($2::text[])", params: [userId, managedPermissions] },
  ];
  for (const item of MODULE_DEFINITIONS) if (profile.modules[item.key]) statements.push({ text: "INSERT INTO user_permissions (id,user_id,permission,scope,allowed,created_at,updated_at) VALUES ($1,$2,$3,'COMPANY',1,$4,$5)", params: [crypto.randomUUID(), userId, item.permission, timestamp, timestamp] });
  for (const group of ACTION_GROUPS) for (const [permission] of group.actions) if (profile.actions[permission]) statements.push({ text: "INSERT INTO user_permissions (id,user_id,permission,scope,allowed,created_at,updated_at) VALUES ($1,$2,$3,'COMPANY',1,$4,$5)", params: [crypto.randomUUID(), userId, permission, timestamp, timestamp] });
  for (const item of SCOPE_DEFINITIONS) statements.push({ text: "INSERT INTO user_permissions (id,user_id,permission,scope,allowed,created_at,updated_at) VALUES ($1,$2,$3,$4,1,$5,$6)", params: [crypto.randomUUID(), userId, item.permission, profile.scopes[item.key], timestamp, timestamp] });
  if (profile.ownCashbox) statements.push({ text: "INSERT INTO user_permissions (id,user_id,permission,scope,allowed,created_at,updated_at) VALUES ($1,$2,'finance.ownCashbox','COMPANY',1,$3,$4)", params: [crypto.randomUUID(), userId, timestamp, timestamp] });
  return statements;
}

function permissionAuditStatements(actorId: string, targetUserId: string, before: AccessProfile, after: AccessProfile, timestamp: number) {
  const oldValues = profileSnapshot(before);
  const newValues = profileSnapshot(after);
  return Object.keys(newValues).filter((permission) => oldValues[permission] !== newValues[permission]).map((permission) =>
    auditStatement(actorId, "EMPLOYEE_PERMISSION_CHANGED", "User", targetUserId, timestamp, { targetUserId, permission, oldValue: oldValues[permission], newValue: newValues[permission] }));
}

export async function getTeamAccess(actor: AuthUser): Promise<TeamAccessMember[]> {
  assertOwner(actor);
  const [rows, permissions] = await Promise.all([
    query<{ employee_id: string; full_name: string; phone: string | null; position: string | null; employee_status: string; user_id: string | null; username: string | null; role: "OWNER" | "EMPLOYEE" | null; user_status: string | null; is_protected_owner: string | number | null; cashbox_id: string | null; cashbox_name: string | null; cashbox_status: string | null; balance_kopecks: string | number | null }>(`SELECT e.id AS employee_id,e.full_name,e.phone,e.position,e.status AS employee_status,
      u.id AS user_id,u.username,u.role,u.status AS user_status,u.is_protected_owner,
      c.id AS cashbox_id,c.name AS cashbox_name,c.status AS cashbox_status,c.balance_kopecks
      FROM employees e LEFT JOIN users u ON u.employee_id=e.id LEFT JOIN cashboxes c ON c.owner_user_id=u.id
      ORDER BY CASE WHEN u.role='OWNER' THEN 0 ELSE 1 END,e.full_name`),
    query<DbPermissionRow>("SELECT user_id,permission,scope,allowed FROM user_permissions WHERE allowed=1"),
  ]);
  const byUser = new Map<string, DbPermissionRow[]>();
  for (const row of permissions) byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), row]);
  return rows.map((row) => ({
    employeeId: row.employee_id, userId: row.user_id, name: row.full_name, phone: row.phone, position: row.position,
    employeeStatus: row.employee_status, role: row.role, accessEnabled: row.user_status === "ACTIVE", username: row.username,
    isProtectedOwner: Boolean(Number(row.is_protected_owner ?? 0)), access: row.user_id ? accessProfileFromRows({ role: row.role ?? "EMPLOYEE" }, byUser.get(row.user_id) ?? []) : emptyAccessProfile(),
    cashbox: row.cashbox_id ? { id: row.cashbox_id, name: row.cashbox_name ?? "Касса", status: row.cashbox_status ?? "INACTIVE", balanceKopecks: Number(row.balance_kopecks ?? 0) } : null,
  }));
}

type CreateEmployeeInput = {
  fullName?: unknown; phone?: unknown; position?: unknown; status?: unknown; accessEnabled?: unknown;
  username?: unknown; initialPassword?: unknown; preset?: unknown; access?: unknown;
};

export async function createEmployee(actor: AuthUser, input: CreateEmployeeInput) {
  assertOwner(actor);
  const fullName = cleanText(input.fullName, 160);
  const phone = cleanText(input.phone, 40) || null;
  const position = cleanText(input.position, 100) || null;
  const employeeStatus = input.status === "INACTIVE" ? "INACTIVE" : "ACTIVE";
  const accessEnabled = input.accessEnabled === true;
  if (fullName.split(/\s+/).length < 2) throw new TeamAccessError("Укажите фамилию и имя сотрудника.");
  const employeeId = `employee_${crypto.randomUUID()}`;
  const userId = accessEnabled ? `user_${crypto.randomUUID()}` : null;
  const username = cleanText(input.username, 80);
  const initialPassword = typeof input.initialPassword === "string" ? input.initialPassword : "";
  if (accessEnabled && !/^[\p{L}\p{N}._-]{3,80}$/u.test(username)) throw new TeamAccessError("Логин должен содержать минимум 3 символа без пробелов.");
  if (accessEnabled && initialPassword.length < 8) throw new TeamAccessError("Первоначальный пароль должен содержать минимум 8 символов.");
  const existing = accessEnabled ? await first<{ id: string }>("SELECT id FROM users WHERE username_normalized=$1 LIMIT 1", [username.toLocaleLowerCase("ru-RU")]) : null;
  if (existing) throw new TeamAccessError("Этот логин уже используется.", 409);
  const profile = normalizeAccessProfile(input.access);
  const preset = Object.hasOwn(ACCESS_PRESETS, String(input.preset)) ? String(input.preset) as AccessPreset : "CUSTOM";
  const password = accessEnabled ? await createLocalPasswordCredential(initialPassword) : null;
  const timestamp = nowSeconds();
  const statements: { text: string; params: unknown[] }[] = [
    { text: "INSERT INTO employees (id,full_name,phone,position,status,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)", params: [employeeId, fullName, phone, position, employeeStatus, timestamp, timestamp] },
    auditStatement(actor.id, "EMPLOYEE_CREATED", "Employee", employeeId, timestamp, { fullName, position, status: employeeStatus }),
  ];
  if (accessEnabled && userId && password) {
    statements.push(
      { text: "INSERT INTO users (id,auth_provider,username,username_normalized,display_name,role,employee_id,status,is_protected_owner,password_hash,password_salt,password_iterations,password_changed_at,created_at,updated_at) VALUES ($1,'LOCAL',$2,$3,$4,'EMPLOYEE',$5,'ACTIVE',0,$6,$7,$8,$9,$10,$11)", params: [userId, username, username.toLocaleLowerCase("ru-RU"), fullName, employeeId, password.hash, password.salt, password.iterations, timestamp, timestamp, timestamp] },
      ...permissionStatements(userId, profile, timestamp),
      auditStatement(actor.id, "EMPLOYEE_ACCESS_ENABLED", "User", userId, timestamp, { employeeId }),
      ...permissionAuditStatements(actor.id, userId, emptyAccessProfile(), profile, timestamp),
    );
    if (preset !== "CUSTOM") statements.push(auditStatement(actor.id, "EMPLOYEE_PRESET_APPLIED", "User", userId, timestamp, { preset }));
    if (profile.ownCashbox) statements.push(
      { text: "INSERT INTO cashboxes (id,owner_user_id,name,type,owner_employee_id,currency,status,opening_balance_kopecks,balance_kopecks,is_active,created_at,updated_at) VALUES ($1,$2,$3,'PERSONAL',$4,'RUB','ACTIVE',0,0,1,$5,$6)", params: [`cashbox_${userId}`, userId, personalCashboxName(userId, fullName), employeeId, timestamp, timestamp] },
      auditStatement(actor.id, "EMPLOYEE_CASHBOX_CREATED", "Cashbox", `cashbox_${userId}`, timestamp, { targetUserId: userId }),
    );
  }
  await transaction(statements);
  return { ok: true, employeeId, userId };
}

type UpdateEmployeeAccessInput = { userId?: unknown; access?: unknown; accessEnabled?: unknown; preset?: unknown; confirmNonZero?: unknown };

type EnableEmployeeAccessInput = { employeeId?: unknown; username?: unknown; initialPassword?: unknown; access?: unknown; preset?: unknown };

export async function enableEmployeeAccess(actor: AuthUser, input: EnableEmployeeAccessInput) {
  assertOwner(actor);
  const employeeId = cleanText(input.employeeId, 100);
  const employee = await first<{ id: string; full_name: string; existing_user_id: string | null }>("SELECT e.id,e.full_name,u.id AS existing_user_id FROM employees e LEFT JOIN users u ON u.employee_id=e.id WHERE e.id=$1 LIMIT 1", [employeeId]);
  if (!employee) throw new TeamAccessError("Сотрудник не найден.", 404);
  if (employee.existing_user_id) throw new TeamAccessError("У сотрудника уже есть аккаунт.", 409);
  const username = cleanText(input.username, 80);
  const initialPassword = typeof input.initialPassword === "string" ? input.initialPassword : "";
  if (!/^[\p{L}\p{N}._-]{3,80}$/u.test(username)) throw new TeamAccessError("Логин должен содержать минимум 3 символа без пробелов.");
  if (initialPassword.length < 8) throw new TeamAccessError("Первоначальный пароль должен содержать минимум 8 символов.");
  if (await first<{ id: string }>("SELECT id FROM users WHERE username_normalized=$1 LIMIT 1", [username.toLocaleLowerCase("ru-RU")])) throw new TeamAccessError("Этот логин уже используется.", 409);
  const password = await createLocalPasswordCredential(initialPassword);
  const profile = normalizeAccessProfile(input.access);
  const preset = Object.hasOwn(ACCESS_PRESETS, String(input.preset)) ? String(input.preset) as AccessPreset : "CUSTOM";
  const userId = `user_${crypto.randomUUID()}`;
  const timestamp = nowSeconds();
  const statements: { text: string; params: unknown[] }[] = [
    { text: "INSERT INTO users (id,auth_provider,username,username_normalized,display_name,role,employee_id,status,is_protected_owner,password_hash,password_salt,password_iterations,password_changed_at,created_at,updated_at) VALUES ($1,'LOCAL',$2,$3,$4,'EMPLOYEE',$5,'ACTIVE',0,$6,$7,$8,$9,$10,$11)", params: [userId, username, username.toLocaleLowerCase("ru-RU"), employee.full_name, employeeId, password.hash, password.salt, password.iterations, timestamp, timestamp, timestamp] },
    ...permissionStatements(userId, profile, timestamp),
    auditStatement(actor.id, "EMPLOYEE_ACCESS_ENABLED", "User", userId, timestamp, { employeeId }),
    ...permissionAuditStatements(actor.id, userId, emptyAccessProfile(), profile, timestamp),
  ];
  if (preset !== "CUSTOM") statements.push(auditStatement(actor.id, "EMPLOYEE_PRESET_APPLIED", "User", userId, timestamp, { preset }));
  if (profile.ownCashbox) statements.push(
    { text: "INSERT INTO cashboxes (id,owner_user_id,name,type,owner_employee_id,currency,status,opening_balance_kopecks,balance_kopecks,is_active,created_at,updated_at) VALUES ($1,$2,$3,'PERSONAL',$4,'RUB','ACTIVE',0,0,1,$5,$6)", params: [`cashbox_${userId}`, userId, personalCashboxName(userId, employee.full_name), employeeId, timestamp, timestamp] },
    auditStatement(actor.id, "EMPLOYEE_CASHBOX_CREATED", "Cashbox", `cashbox_${userId}`, timestamp, { targetUserId: userId }),
  );
  await transaction(statements);
  return { ok: true, userId };
}

export async function updateEmployeeAccess(actor: AuthUser, input: UpdateEmployeeAccessInput) {
  assertOwner(actor);
  const userId = cleanText(input.userId, 100);
  const target = await first<{ id: string; role: string; status: string; employee_id: string | null; display_name: string; is_protected_owner: string | number }>("SELECT id,role,status,employee_id,display_name,is_protected_owner FROM users WHERE id=$1 LIMIT 1", [userId]);
  if (!target) throw new TeamAccessError("Сотрудник не найден.", 404);
  if (target.role === "OWNER" || Number(target.is_protected_owner)) throw new TeamAccessError("Owner имеет полный системный доступ. Его права здесь не редактируются.", 403);
  const beforeRows = await query<DbPermissionRow>("SELECT user_id,permission,scope,allowed FROM user_permissions WHERE user_id=$1 AND allowed=1", [userId]);
  const before = accessProfileFromRows({ role: "EMPLOYEE" }, beforeRows);
  const after = normalizeAccessProfile(input.access);
  const accessEnabled = input.accessEnabled !== false;
  const box = await first<{ id: string; name: string; status: string; balance_kopecks: string | number }>("SELECT id,name,status,balance_kopecks FROM cashboxes WHERE owner_user_id=$1 LIMIT 1", [userId]);
  if (!after.ownCashbox && box?.status === "ACTIVE" && Number(box.balance_kopecks) !== 0 && input.confirmNonZero !== true) {
    throw new TeamAccessError(`Баланс ${box.name} ненулевой. Подтвердите деактивацию кассы.`, 409, { requiresConfirmation: true, balanceKopecks: Number(box.balance_kopecks), cashboxName: box.name });
  }
  const timestamp = nowSeconds();
  const statements = [
    ...permissionStatements(userId, after, timestamp),
    ...permissionAuditStatements(actor.id, userId, before, after, timestamp),
    { text: "UPDATE users SET status=$1,updated_at=$2 WHERE id=$3", params: [accessEnabled ? "ACTIVE" : "BLOCKED", timestamp, userId] },
  ];
  if ((target.status === "ACTIVE") !== accessEnabled) statements.push(auditStatement(actor.id, accessEnabled ? "EMPLOYEE_ACCESS_ENABLED" : "EMPLOYEE_ACCESS_DISABLED", "User", userId, timestamp, { employeeId: target.employee_id }));
  if (after.ownCashbox) {
    statements.push({ text: "INSERT INTO cashboxes (id,owner_user_id,name,type,owner_employee_id,currency,status,opening_balance_kopecks,balance_kopecks,is_active,created_at,updated_at) VALUES ($1,$2,$3,'PERSONAL',$4,'RUB','ACTIVE',0,0,1,$5,$6) ON CONFLICT (owner_user_id) DO UPDATE SET name=EXCLUDED.name,status='ACTIVE',is_active=1,deactivated_at=NULL,deactivated_by_user_id=NULL,updated_at=EXCLUDED.updated_at", params: [`cashbox_${userId}`, userId, personalCashboxName(userId, target.display_name), target.employee_id, timestamp, timestamp] });
    if (!box || box.status !== "ACTIVE") statements.push(auditStatement(actor.id, "EMPLOYEE_CASHBOX_CREATED", "Cashbox", box?.id ?? `cashbox_${userId}`, timestamp, { targetUserId: userId, reactivated: Boolean(box) }));
  } else if (box?.status === "ACTIVE") {
    statements.push(
      { text: "UPDATE cashboxes SET status='INACTIVE',is_active=0,deactivated_at=$1,deactivated_by_user_id=$2,updated_at=$3 WHERE id=$4", params: [timestamp, actor.id, timestamp, box.id] },
      auditStatement(actor.id, "EMPLOYEE_CASHBOX_DEACTIVATED", "Cashbox", box.id, timestamp, { targetUserId: userId, balanceKopecks: Number(box.balance_kopecks) }),
    );
  }
  const preset = Object.hasOwn(ACCESS_PRESETS, String(input.preset)) ? String(input.preset) as AccessPreset : null;
  if (preset && preset !== "CUSTOM") statements.push(auditStatement(actor.id, "EMPLOYEE_PRESET_APPLIED", "User", userId, timestamp, { preset }));
  await transaction(statements);
  return { ok: true };
}
