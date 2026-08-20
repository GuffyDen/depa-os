import { getRequestUser } from "../../../../lib/auth";
import { ClientError, getClient, setClientArchived, updateClient, type ClientInput } from "../../../../lib/clients";
import { AccessError } from "../../../../lib/permissions";

export const dynamic = "force-dynamic";

function failure(error: unknown) {
  if (error instanceof ClientError) return Response.json({ error: error.message, duplicate: error.duplicate }, { status: error.status });
  if (error instanceof AccessError) return Response.json({ error: error.message }, { status: error.status });
  console.error("Client detail API error", error);
  return Response.json({ error: "Не удалось выполнить операцию с клиентом." }, { status: 500 });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getRequestUser(request);
  if (!actor) return Response.json({ error: "Требуется авторизация." }, { status: 401 });
  try { return Response.json(await getClient(actor, (await params).id), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return failure(error); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getRequestUser(request);
  if (!actor) return Response.json({ error: "Требуется авторизация." }, { status: 401 });
  try {
    const id = (await params).id;
    const body = await request.json() as ClientInput & { action?: "ARCHIVE" | "RESTORE" };
    if (body.action === "ARCHIVE") return Response.json(await setClientArchived(actor, id, true));
    if (body.action === "RESTORE") return Response.json(await setClientArchived(actor, id, false));
    return Response.json(await updateClient(actor, id, body));
  } catch (error) { return failure(error); }
}
