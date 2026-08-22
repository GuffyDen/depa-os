import { redirect } from "next/navigation";
import { getCurrentUser } from "../../lib/auth";
import { getAccessProfile } from "../../lib/permissions";

export const dynamic = "force-dynamic";

export default async function ResidentialComplexesRoute() {
  const actor = await getCurrentUser();
  if (!actor) redirect("/login");
  const access = await getAccessProfile(actor);
  if (!access.actions["residentialComplexes.view"])
    redirect("/dashboard?accessDenied=projects");
  redirect("/dashboard?section=complexes");
}
