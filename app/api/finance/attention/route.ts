import { getRequestUser } from "../../../../lib/auth";
import { FinanceError, updateFinanceAttentionIssue } from "../../../../lib/finance";
import { createRequestLogger } from "../../../../lib/request-logger";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  if (error instanceof FinanceError) return Response.json({ error: error.message }, { status: error.status });
  console.error("Finance attention API error", error);
  return Response.json({ error: "Не удалось изменить статус замечания." }, { status: 500 });
}

export async function PATCH(request: Request) {
  const user = await getRequestUser(request);
  const log = createRequestLogger(request, { route: "/api/finance/attention", action: "FINANCE_ATTENTION_UPDATE", actorType: user ? "EMPLOYEE" : "ANONYMOUS", actorId: user?.id ?? null });
  if (!user) return log.json({ error: "Требуется авторизация." }, { status: 401 });
  let body: { transactionId?: unknown; issueType?: unknown; action?: unknown; comment?: unknown };
  try { body = await request.json() as typeof body; }
  catch (error) { log.failure("FINANCE_ATTENTION_UPDATE_FAILURE", error, { errorCode: "INVALID_JSON" }); return log.json({ error: "Некорректные параметры замечания." }, { status: 400 }); }
  try {
    const result = await updateFinanceAttentionIssue(user, body);
    log.success("FINANCE_ATTENTION_UPDATE_SUCCESS", { entityId: typeof body.transactionId === "string" ? body.transactionId : null, issueType: typeof body.issueType === "string" ? body.issueType : null, attentionAction: typeof body.action === "string" ? body.action : null });
    return log.json(result);
  } catch (error) {
    log.failure("FINANCE_ATTENTION_UPDATE_FAILURE", error, { entityId: typeof body.transactionId === "string" ? body.transactionId : null, issueType: typeof body.issueType === "string" ? body.issueType : null, errorCode: error instanceof FinanceError ? `FINANCE_${error.status}` : "FINANCE_ATTENTION_INTERNAL" });
    return log.withRequestId(errorResponse(error));
  }
}
