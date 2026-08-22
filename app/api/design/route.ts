import { getRequestUser } from "../../../lib/auth";
import {
  DESIGN_FILE_CATEGORIES,
  DESIGN_STAGE_STATUSES,
  DESIGN_STATUSES,
  listDesigners,
} from "../../../lib/design";
import { AccessError, assertModuleAction } from "../../../lib/permissions";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await getRequestUser(request);
  if (!actor)
    return Response.json({ error: "Требуется авторизация." }, { status: 401 });
  try {
    await assertModuleAction(actor, "orders", "design.view");
    return Response.json(
      {
        designers: await listDesigners(),
        statuses: DESIGN_STATUSES,
        stageStatuses: DESIGN_STAGE_STATUSES,
        fileCategories: DESIGN_FILE_CATEGORIES,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof AccessError)
      return Response.json({ error: error.message }, { status: error.status });
    console.error("Design metadata API error", error);
    return Response.json(
      { error: "Не удалось загрузить настройки дизайн-проектов." },
      { status: 500 },
    );
  }
}
