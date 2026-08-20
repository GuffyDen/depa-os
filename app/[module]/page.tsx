import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "../../lib/auth";
import { MODULE_ROUTE_ALIASES } from "../../lib/permission-definitions";
import { hasModuleAccess } from "../../lib/permissions";

export const dynamic = "force-dynamic";

const sectionByModule = { dashboard: "dashboard", crm: "crm", clients: "clients", orders: "orders", projects: "objects", tasks: "tasks", finance: "finance", team: "team", contractors: "contractors", documents: "docs" } as const;

export default async function ProtectedModuleAlias({ params }: { params: Promise<{ module: string }> }) {
  const segment = (await params).module;
  const moduleKey = MODULE_ROUTE_ALIASES[segment];
  if (!moduleKey || segment === "dashboard" || segment === "overview") notFound();
  const actor = await getCurrentUser();
  if (!actor) redirect("/login");
  if (!(await hasModuleAccess(actor, moduleKey))) redirect(`/dashboard?accessDenied=${encodeURIComponent(moduleKey)}`);
  redirect(`/dashboard?section=${sectionByModule[moduleKey]}`);
}
