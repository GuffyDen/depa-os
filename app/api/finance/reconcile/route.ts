import { getRequestUser } from "../../../../lib/auth";
import { FinanceError, reconcileCashboxes } from "../../../../lib/finance";

export const dynamic = "force-dynamic";

function responseFor(error: unknown) {
  if (error instanceof FinanceError) return Response.json({ error: error.message }, { status: error.status });
  console.error("Finance reconciliation API error", error);
  return Response.json({ error: "Не удалось проверить целостность касс." }, { status: 500 });
}

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return Response.json({ error: "Требуется авторизация." }, { status: 401 });
  try { return Response.json(await reconcileCashboxes(user)); }
  catch (error) { return responseFor(error); }
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return Response.json({ error: "Требуется авторизация." }, { status: 401 });
  try { return Response.json(await reconcileCashboxes(user, true)); }
  catch (error) { return responseFor(error); }
}
