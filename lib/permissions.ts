import type { AuthUser } from "./auth";
import { first, query } from "./postgres";
import {
  ACTION_GROUPS, MODULE_DEFINITIONS, SCOPE_DEFINITIONS, emptyAccessProfile, ownerAccessProfile,
  type AccessProfile, type ActionPermission, type ModuleKey, type ScopeKey, type ScopeValue,
} from "./permission-definitions";

type PermissionRow = { permission: string; scope: string; allowed: string | number };

export class AccessError extends Error {
  status: number;
  constructor(message = "Недостаточно прав для этого действия.", status = 403) { super(message); this.status = status; }
}

export function accessProfileFromRows(actor: Pick<AuthUser, "role">, rows: PermissionRow[]): AccessProfile {
  if (actor.role === "OWNER") return ownerAccessProfile();
  if (actor.role !== "EMPLOYEE") return emptyAccessProfile();
  const active = new Map(rows.map((row) => [`${row.permission}:${row.scope}`, Boolean(Number(row.allowed))]));
  const profile = emptyAccessProfile();
  for (const item of MODULE_DEFINITIONS) profile.modules[item.key] = active.get(`${item.permission}:COMPANY`) === true;
  for (const group of ACTION_GROUPS) for (const [permission] of group.actions) profile.actions[permission] = active.get(`${permission}:COMPANY`) === true;
  // Read-only compatibility for employees configured before the custom registry existed.
  if (active.get("FINANCE_ACCESS:COMPANY") === true) {
    profile.modules.finance = true;
    profile.actions["finance.view"] = true;
    profile.actions["finance.createExpense"] = true;
  }
  profile.actions["team.managePermissions"] = false;
  for (const item of SCOPE_DEFINITIONS) {
    const selected = rows.find((row) => row.permission === item.permission && Number(row.allowed) === 1)?.scope as ScopeValue | undefined;
    if (selected && ["OWN", "ASSIGNED", "ASSIGNED_PROJECTS", "ALL"].includes(selected)) profile.scopes[item.key] = selected;
  }
  profile.ownCashbox = active.get("finance.ownCashbox:COMPANY") === true || active.get("OWN_CASHBOX:COMPANY") === true;
  return profile;
}

export async function getAccessProfile(actor: AuthUser): Promise<AccessProfile> {
  if (actor.role === "OWNER") return ownerAccessProfile();
  if (actor.role !== "EMPLOYEE") return emptyAccessProfile();
  const rows = await query<PermissionRow>("SELECT permission,scope,allowed FROM user_permissions WHERE user_id=$1 AND allowed=1", [actor.id]);
  return accessProfileFromRows(actor, rows);
}

export async function hasModuleAccess(actor: AuthUser, module: ModuleKey) {
  return actor.role === "OWNER" || (await getAccessProfile(actor)).modules[module];
}

export async function hasActionPermission(actor: AuthUser, permission: ActionPermission) {
  return actor.role === "OWNER" || (await getAccessProfile(actor)).actions[permission];
}

export async function assertModuleAccess(actor: AuthUser, module: ModuleKey) {
  if (!(await hasModuleAccess(actor, module))) throw new AccessError("Нет доступа к этому разделу.");
}

export async function assertActionPermission(actor: AuthUser, permission: ActionPermission) {
  if (!(await hasActionPermission(actor, permission))) throw new AccessError();
}

export async function assertModuleAction(actor: AuthUser, module: ModuleKey, permission: ActionPermission) {
  if (actor.role === "OWNER") return;
  const profile = await getAccessProfile(actor);
  if (!profile.modules[module] || !profile.actions[permission]) throw new AccessError();
}

export async function canViewCashbox(actor: AuthUser, cashboxId: string) {
  if (actor.role === "OWNER") return true;
  const profile = await getAccessProfile(actor);
  if (!profile.modules.finance || !profile.actions["finance.view"]) return false;
  if (profile.scopes.cashboxes === "ALL") return true;
  const row = await first<{ owner_user_id: string | null }>("SELECT owner_user_id FROM cashboxes WHERE id=$1 LIMIT 1", [cashboxId]);
  return row?.owner_user_id === actor.id;
}

export async function canViewProject(actor: AuthUser, projectId: string) {
  if (actor.role === "OWNER") return true;
  const profile = await getAccessProfile(actor);
  if (!profile.modules.projects || !profile.actions["projects.view"]) return false;
  if (profile.scopes.projects === "ALL") return true;
  const row = await first<{ id: string }>(`SELECT p.id FROM projects p
    LEFT JOIN user_project_access a ON a.project_id=p.id AND a.user_id=$2
    WHERE p.id=$1 AND (p.responsible_user_id=$2 OR a.id IS NOT NULL OR p.manager_employee_id=$3 OR p.foreman_employee_id=$3) LIMIT 1`, [projectId, actor.id, actor.employeeId]);
  return Boolean(row);
}

export async function canViewDesignProject(
  actor: AuthUser,
  designProjectId: string,
) {
  if (actor.role === "OWNER") return true;
  const profile = await getAccessProfile(actor);
  if (
    !profile.modules.orders ||
    !profile.actions["orders.view"] ||
    !profile.actions["design.view"]
  )
    return false;
  const all =
    profile.scopes.orders === "ALL" && profile.scopes.design === "ALL";
  const row = await first<{ id: string }>(
    `SELECT dp.id FROM design_projects dp JOIN orders o ON o.id=dp.order_id
      LEFT JOIN users du ON du.employee_id=dp.designer_employee_id
      WHERE dp.id=$1${
        all
          ? ""
          : " AND (o.responsible_user_id=$2 OR du.id=$2 OR EXISTS(SELECT 1 FROM design_project_stages ds WHERE ds.design_project_id=dp.id AND ds.responsible_user_id=$2 AND ds.archived_at IS NULL))"
      } LIMIT 1`,
    all ? [designProjectId] : [designProjectId, actor.id],
  );
  return Boolean(row);
}

export async function getScope(actor: AuthUser, scope: ScopeKey): Promise<ScopeValue> {
  if (actor.role === "OWNER") return "ALL";
  return (await getAccessProfile(actor)).scopes[scope];
}
