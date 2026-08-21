import type { AuthUser } from "./auth";
import type { ActionPermission, ModuleKey } from "./permission-definitions";
import { assertModuleAction, getScope } from "./permissions";
import { query } from "./postgres";

const viewActions: Partial<Record<ModuleKey, ActionPermission>> = {
  crm: "crm.view", clients: "clients.view", orders: "orders.view", projects: "projects.view", tasks: "tasks.view",
  finance: "finance.view", team: "team.view", contractors: "contractors.view", documents: "documents.view",
};

export async function getModuleData(actor: AuthUser, module: ModuleKey) {
  const action = viewActions[module];
  if (action) await assertModuleAction(actor, module, action);
  if (module === "dashboard") return { items: [] };
  if (module === "crm") {
    const scope = await getScope(actor, "crm");
    const params = scope === "ALL" ? [] : [actor.id];
    return { items: await query(`SELECT l.id,l.name,l.phone,l.source,l.stage,l.comment,l.next_action_type,l.next_action_at,l.responsible_user_id,c.name AS client_name
      FROM leads l LEFT JOIN clients c ON c.id=l.linked_client_id ${scope === "ALL" ? "" : "WHERE l.responsible_user_id=$1"} ORDER BY l.updated_at DESC LIMIT 200`, params) };
  }
  if (module === "clients") {
    const scope = await getScope(actor, "clients");
    const params = scope === "ALL" ? [] : [actor.id, actor.employeeId];
    return { items: await query(`SELECT DISTINCT c.id,c.name,c.phone,c.source,c.comment,c.status,c.owner_employee_id FROM clients c
      ${scope === "ALL" ? "" : "LEFT JOIN projects p ON p.client_id=c.id LEFT JOIN user_project_access a ON a.project_id=p.id AND a.user_id=$1 WHERE c.owner_employee_id=$2 OR a.id IS NOT NULL"}
      ORDER BY c.name LIMIT 200`, params) };
  }
  if (module === "orders") {
    const scope = await getScope(actor, "clients");
    const params = scope === "ALL" ? [] : [actor.id, actor.employeeId];
    return { items: await query(`SELECT DISTINCT o.id,o.number,o.type,o.title,o.amount_kopecks,o.status,o.client_id,c.name AS client_name FROM orders o JOIN clients c ON c.id=o.client_id
      ${scope === "ALL" ? "" : "LEFT JOIN projects p ON p.order_id=o.id LEFT JOIN user_project_access a ON a.project_id=p.id AND a.user_id=$1 WHERE c.owner_employee_id=$2 OR a.id IS NOT NULL"}
      ORDER BY o.updated_at DESC LIMIT 200`, params) };
  }
  if (module === "projects") {
    const scope = await getScope(actor, "projects");
    const params = scope === "ALL" ? [] : [actor.id, actor.employeeId];
    return { items: await query(`SELECT DISTINCT p.id,p.name,p.residential_complex,p.address,p.apartment,p.status,p.start_date,p.planned_end_date,p.forecast_end_date,p.manager_employee_id,p.foreman_employee_id,c.name AS client_name
      FROM projects p JOIN clients c ON c.id=p.client_id ${scope === "ALL" ? "" : "LEFT JOIN user_project_access a ON a.project_id=p.id AND a.user_id=$1 WHERE p.responsible_user_id=$1 OR a.id IS NOT NULL OR p.manager_employee_id=$2 OR p.foreman_employee_id=$2"}
      ORDER BY p.updated_at DESC LIMIT 200`, params) };
  }
  if (module === "tasks") {
    const scope = await getScope(actor, "tasks");
    const params = scope === "ALL" ? [] : [actor.id, actor.employeeId];
    return { items: await query(`SELECT t.id,t.title,t.project_id,t.client_id,t.deadline,t.status,t.comment,t.assignee_employee_id,t.created_by_user_id
      FROM tasks t ${scope === "ALL" ? "" : "WHERE t.created_by_user_id=$1 OR t.assignee_employee_id=$2"} ORDER BY t.deadline NULLS LAST,t.updated_at DESC LIMIT 200`, params) };
  }
  if (module === "team") return { items: await query("SELECT id,full_name,phone,position,status FROM employees ORDER BY full_name LIMIT 200") };
  if (module === "contractors") return { items: await query("SELECT id,name,type,specialization,phone,comment,status FROM contractors ORDER BY name LIMIT 200") };
  if (module === "documents") {
    const scope = await getScope(actor, "documents");
    const params = scope === "ALL" ? [] : [actor.id, actor.employeeId];
    return { items: await query(`SELECT DISTINCT a.id,a.original_filename,a.category,a.project_id,a.entity_type,a.entity_id,a.created_at,a.updated_at FROM attachments a
      ${scope === "ALL" ? "WHERE a.upload_status='LINKED' AND a.deleted_at IS NULL" : "LEFT JOIN projects p ON p.id=a.project_id LEFT JOIN user_project_access upa ON upa.project_id=p.id AND upa.user_id=$1 WHERE a.upload_status='LINKED' AND a.deleted_at IS NULL AND (upa.id IS NOT NULL OR p.manager_employee_id=$2 OR p.foreman_employee_id=$2)"}
      ORDER BY a.updated_at DESC LIMIT 200`, params) };
  }
  return { items: [] };
}
