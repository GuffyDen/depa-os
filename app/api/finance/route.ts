import { getRequestUser } from "../../../lib/auth";
import { createFinanceOperation, FinanceError, getFinanceOverview, updateFinanceOperation, type CreateFinanceOperationInput } from "../../../lib/finance";
import { cleanupUnlinkedAttachment } from "../../../lib/files";
import { createRequestLogger } from "../../../lib/request-logger";

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
  const log = createRequestLogger(request, { route: "/api/finance", action: "FINANCE_MUTATION", actorType: user ? "EMPLOYEE" : "ANONYMOUS", actorId: user?.id ?? null });
  if (!user) { log.failure("FINANCE_MUTATION_FAILURE", new Error("Unauthorized"), { errorCode: "UNAUTHORIZED" }); return log.json({ error: "Требуется авторизация." }, { status: 401 }); }
  let body: CreateFinanceOperationInput;
  try { body = await request.json() as CreateFinanceOperationInput; }
  catch (error) { log.failure("FINANCE_MUTATION_FAILURE", error, { errorCode: "INVALID_JSON" }); return log.json({ error: "Некорректные данные операции." }, { status: 400 }); }
  const transactionType = typeof body.type === "string" ? body.type : "UNKNOWN";
  const details = { transactionType, projectId: typeof body.projectId === "string" ? body.projectId : null, clientId: typeof body.clientId === "string" ? body.clientId : null, cashboxId: typeof body.cashboxId === "string" ? body.cashboxId : null, investmentAccountId: typeof body.investmentAccountId === "string" ? body.investmentAccountId : null, originalTransactionId: typeof body.originalTransactionId === "string" ? body.originalTransactionId : null };
  log.start(`${transactionType}_START`, details);
  try { const operation = await createFinanceOperation(user, body); log.success(`${transactionType}_SUCCESS`, { ...details, entityId: operation.id }); return log.json({ operation }, { status: 201 }); }
  catch (error) {
    if (typeof body.attachmentId === "string" && body.attachmentId) await cleanupUnlinkedAttachment(user, body.attachmentId).catch((cleanupError) => console.error("Attachment cleanup error", cleanupError));
    log.failure(`${transactionType}_FAILURE`, error, { ...details, errorCode: error instanceof FinanceError ? `FINANCE_${error.status}` : "FINANCE_INTERNAL" });
    return log.withRequestId(financeError(error));
  }
}

export async function PATCH(request: Request) {
  const user = await getRequestUser(request);
  const log = createRequestLogger(request, { route: "/api/finance", action: "FINANCE_UPDATE", actorType: user ? "EMPLOYEE" : "ANONYMOUS", actorId: user?.id ?? null });
  if (!user) { log.failure("FINANCE_UPDATE_FAILURE", new Error("Unauthorized"), { errorCode: "UNAUTHORIZED" }); return log.json({ error: "Требуется авторизация." }, { status: 401 }); }
  let body: { id?: unknown; title?: unknown; comment?: unknown; showToClient?: unknown };
  try { body = await request.json() as typeof body; }
  catch (error) { log.failure("FINANCE_UPDATE_FAILURE", error, { errorCode: "INVALID_JSON" }); return log.json({ error: "Некорректные данные операции." }, { status: 400 }); }
  try { const result=await updateFinanceOperation(user, body); log.success("FINANCE_UPDATE_SUCCESS",{entityId:typeof body.id==="string"?body.id:null}); return log.json(result); }
  catch (error) { log.failure("FINANCE_UPDATE_FAILURE",error,{entityId:typeof body.id==="string"?body.id:null,errorCode:error instanceof FinanceError?`FINANCE_${error.status}`:"FINANCE_INTERNAL"}); return log.withRequestId(financeError(error)); }
}
