import { getRequestUser } from "../../../lib/auth";
import { createClient, ClientError, listClients, type ClientInput } from "../../../lib/clients";
import { AccessError } from "../../../lib/permissions";

export const dynamic = "force-dynamic";

function failure(error: unknown) {
  if (error instanceof ClientError) return Response.json({ error: error.message, duplicate: error.duplicate }, { status: error.status });
  if (error instanceof AccessError) return Response.json({ error: error.message }, { status: error.status });
  console.error("Clients API error", error);
  return Response.json({ error: "Не удалось выполнить операцию с клиентом." }, { status: 500 });
}

export async function GET(request: Request) {
  const actor = await getRequestUser(request);
  if (!actor) return Response.json({ error: "Требуется авторизация." }, { status: 401 });
  try { return Response.json(await listClients(actor, request.url), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  const actor = await getRequestUser(request);
  if (!actor) return Response.json({ error: "Требуется авторизация." }, { status: 401 });
  try {
    const body = await request.json() as ClientInput & { forceDuplicate?: boolean };
    return Response.json(await createClient(actor, body, body.forceDuplicate === true), { status: 201 });
  } catch (error) { return failure(error); }
}
