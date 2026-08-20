import { getRequestUser } from "../../../../lib/auth";
import { createEmployee, enableEmployeeAccess, getTeamAccess, TeamAccessError, updateEmployeeAccess } from "../../../../lib/team-access";

export const dynamic = "force-dynamic";

function handleError(error: unknown) {
  if (error instanceof TeamAccessError) return Response.json({ error: error.message, ...error.details }, { status: error.status });
  console.error("Team access API error", error);
  return Response.json({ error: "Не удалось обновить сотрудника и права доступа." }, { status: 500 });
}

export async function GET(request: Request) {
  const actor = await getRequestUser(request);
  if (!actor) return Response.json({ error: "Требуется авторизация." }, { status: 401 });
  try { return Response.json({ members: await getTeamAccess(actor) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return handleError(error); }
}

export async function POST(request: Request) {
  const actor = await getRequestUser(request);
  if (!actor) return Response.json({ error: "Требуется авторизация." }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Некорректные данные сотрудника." }, { status: 400 }); }
  try { return Response.json(await createEmployee(actor, body as Parameters<typeof createEmployee>[1]), { status: 201 }); }
  catch (error) { return handleError(error); }
}

export async function PATCH(request: Request) {
  const actor = await getRequestUser(request);
  if (!actor) return Response.json({ error: "Требуется авторизация." }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Некорректные права доступа." }, { status: 400 }); }
  try {
    const input = body as { userId?: unknown };
    return Response.json(input.userId ? await updateEmployeeAccess(actor, body as Parameters<typeof updateEmployeeAccess>[1]) : await enableEmployeeAccess(actor, body as Parameters<typeof enableEmployeeAccess>[1]));
  }
  catch (error) { return handleError(error); }
}
