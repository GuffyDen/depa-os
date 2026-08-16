import { getRequestUser } from "../../../../lib/auth";
import { FinanceError, getTeamFinanceAccess, setTeamFinanceAccess } from "../../../../lib/finance";

export const dynamic = "force-dynamic";

function accessError(error: unknown) {
  if (error instanceof FinanceError) return Response.json({ error: error.message, ...error.details }, { status: error.status });
  console.error("Team finance access API error", error);
  return Response.json({ error: "Не удалось обновить финансовые права." }, { status: 500 });
}

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return Response.json({ error: "Требуется авторизация." }, { status: 401 });
  try { return Response.json({ members: await getTeamFinanceAccess(user) }); }
  catch (error) { return accessError(error); }
}

export async function PATCH(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return Response.json({ error: "Требуется авторизация." }, { status: 401 });
  let body: { userId?: unknown; financeAccess?: unknown; ownCashbox?: unknown; confirmNonZero?: unknown };
  try { body = await request.json() as typeof body; }
  catch { return Response.json({ error: "Некорректные данные прав доступа." }, { status: 400 }); }
  try { return Response.json(await setTeamFinanceAccess(user, body)); }
  catch (error) { return accessError(error); }
}
