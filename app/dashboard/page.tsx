import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DepaOS } from "../depa-os";
import { getCurrentUser } from "../../lib/auth";
import { MODULE_ROUTE_ALIASES, type ModuleKey } from "../../lib/permission-definitions";
import { getAccessProfile } from "../../lib/permissions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Обзор — DEPA OS",
  description: "Внутренняя операционная система DEPA Stroy",
};

const moduleBySection: Record<string, ModuleKey> = { dashboard: "dashboard", crm: "crm", clients: "clients", orders: "orders", complexes: "projects", objects: "projects", tasks: "tasks", finance: "finance", team: "team", contractors: "contractors", docs: "documents" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ section?: string; accessDenied?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [access, requested] = await Promise.all([getAccessProfile(user), searchParams]);
  const initialSection = requested.section && moduleBySection[requested.section] ? requested.section : "dashboard";
  const requestedModule = moduleBySection[initialSection];
  const deniedModule = requested.accessDenied ? MODULE_ROUTE_ALIASES[requested.accessDenied] : undefined;
  const accessDenied = deniedModule ?? (initialSection === "complexes" && !access.actions["residentialComplexes.view"] ? "projects" : requestedModule && !access.modules[requestedModule] ? requestedModule : undefined);
  return <DepaOS currentUser={user} access={access} initialSection={initialSection} accessDenied={accessDenied} />;
}
