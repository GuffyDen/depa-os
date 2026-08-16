import { getRequestUser } from "../../../lib/auth";
import { createFinanceOperation, FinanceError, getFinanceOverview, type CreateFinanceOperationInput } from "../../../lib/finance";
import { cleanupUnlinkedAttachment } from "../../../lib/files";

export const dynamic = "force-dynamic";

function financeError(error: unknown) {
  if (error instanceof FinanceError) return Response.json({ error: error.message, ...error.details }, { status: error.status });
  console.error("Finance API error", error);
  return Response.json({ error: "Не удалось выполнить финансовую операцию." }, { status: 500 });
}

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return Response.json({ error: "Требуется авторизация." }, { status: 401 });
  try { return Response.json(await getFinanceOverview(user)); }
  catch (error) { return financeError(error); }
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return Response.json({ error: "Требуется авторизация." }, { status: 401 });
  let body: CreateFinanceOperationInput;
  try { body = await request.json() as CreateFinanceOperationInput; }
  catch { return Response.json({ error: "Некорректные данные операции." }, { status: 400 }); }
  try { return Response.json({ operation: await createFinanceOperation(user, body) }, { status: 201 }); }
  catch (error) {
    if (typeof body.attachmentId === "string" && body.attachmentId) await cleanupUnlinkedAttachment(user, body.attachmentId).catch((cleanupError) => console.error("Attachment cleanup error", cleanupError));
    return financeError(error);
  }
}
