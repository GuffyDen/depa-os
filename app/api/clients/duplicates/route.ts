import { getRequestUser } from "../../../../lib/auth";
import { findDuplicateClient } from "../../../../lib/clients";
import { AccessError } from "../../../../lib/permissions";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await getRequestUser(request);
  if (!actor) return Response.json({ error: "Требуется авторизация." }, { status: 401 });
  try {
    const url = new URL(request.url);
    return Response.json({ duplicate: await findDuplicateClient(actor, url.searchParams.get("phone") ?? "", url.searchParams.get("excludeId") ?? undefined) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof AccessError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Client duplicate API error", error);
    return Response.json({ error: "Не удалось проверить телефон." }, { status: 500 });
  }
}
