import { getRequestUser } from "../../../lib/auth";
import { MODULE_ROUTE_ALIASES } from "../../../lib/permission-definitions";
import { getModuleData } from "../../../lib/module-data";
import { AccessError } from "../../../lib/permissions";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ module: string }> }) {
  const actor = await getRequestUser(request);
  if (!actor) return Response.json({ error: "Требуется авторизация." }, { status: 401 });
  const moduleKey = MODULE_ROUTE_ALIASES[(await params).module];
  if (!moduleKey || moduleKey === "finance" || moduleKey === "dashboard") return Response.json({ error: "Раздел не найден." }, { status: 404 });
  try { return Response.json(await getModuleData(actor, moduleKey), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) {
    if (error instanceof AccessError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Module API error", error);
    return Response.json({ error: "Не удалось загрузить данные раздела." }, { status: 500 });
  }
}
