import { getRequestUser } from "../../../../lib/auth";
import { confirmFinanceAttachmentUpload, createFinanceAttachmentSlots, FinanceError, markFinanceAttachmentFailed, retryFinanceAttachmentSlot } from "../../../../lib/finance";
import { createRequestLogger } from "../../../../lib/request-logger";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  if (error instanceof FinanceError) return Response.json({ error: error.message }, { status: error.status });
  console.error("Finance attachment API error", error);
  return Response.json({ error: "Не удалось изменить вложения операции." }, { status: 500 });
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  const log = createRequestLogger(request, { route: "/api/finance/attachments", action: "FINANCE_ATTACHMENT_CREATE", actorType: user ? "EMPLOYEE" : "ANONYMOUS", actorId: user?.id ?? null });
  if (!user) return log.json({ error: "Требуется авторизация." }, { status: 401 });
  let body: { transactionId?: unknown; retryAttachmentId?: unknown; attachments?: unknown };
  try { body = await request.json() as typeof body; }
  catch (error) { log.failure("FINANCE_ATTACHMENT_CREATE_FAILURE", error, { errorCode: "INVALID_JSON" }); return log.json({ error: "Некорректные параметры вложения." }, { status: 400 }); }
  try {
    const result = body.retryAttachmentId ? await retryFinanceAttachmentSlot(user, body) : await createFinanceAttachmentSlots(user, body);
    log.success(body.retryAttachmentId ? "FINANCE_ATTACHMENT_RETRY_QUEUED" : "FINANCE_ATTACHMENT_CREATE_SUCCESS", { entityId: typeof body.transactionId === "string" ? body.transactionId : null, attachmentId: typeof body.retryAttachmentId === "string" ? body.retryAttachmentId : null, attachmentCount: Array.isArray(body.attachments) ? body.attachments.length : 0 });
    return log.json(result, { status: body.retryAttachmentId ? 200 : 201 });
  } catch (error) {
    log.failure("FINANCE_ATTACHMENT_CREATE_FAILURE", error, { entityId: typeof body.transactionId === "string" ? body.transactionId : null, errorCode: error instanceof FinanceError ? `FINANCE_${error.status}` : "FINANCE_ATTACHMENT_INTERNAL" });
    return log.withRequestId(errorResponse(error));
  }
}

export async function PATCH(request: Request) {
  const user = await getRequestUser(request);
  const log = createRequestLogger(request, { route: "/api/finance/attachments", action: "FINANCE_ATTACHMENT_STATUS", actorType: user ? "EMPLOYEE" : "ANONYMOUS", actorId: user?.id ?? null });
  if (!user) return log.json({ error: "Требуется авторизация." }, { status: 401 });
  let body: { attachmentId?: unknown; uploadAttemptId?: unknown; status?: unknown; failureCode?: unknown; failureStage?: unknown; telemetry?: unknown; processing?: unknown };
  try { body = await request.json() as typeof body; }
  catch (error) { log.failure("FINANCE_ATTACHMENT_STATUS_FAILURE", error, { errorCode: "INVALID_JSON" }); return log.json({ error: "Некорректные параметры вложения." }, { status: 400 }); }
  if (body.status !== "FAILED" && body.status !== "UPLOADED") return log.json({ error: "Некорректный статус вложения." }, { status: 400 });
  try {
    const result = body.status === "UPLOADED" ? await confirmFinanceAttachmentUpload(user, body) : await markFinanceAttachmentFailed(user, body);
    log.success("FINANCE_ATTACHMENT_STATUS_SUCCESS", { entityId: typeof body.attachmentId === "string" ? body.attachmentId : null, status: body.status, failureCode: typeof body.failureCode === "string" ? body.failureCode : null, failureStage: typeof body.failureStage === "string" ? body.failureStage : null });
    return log.json(result);
  } catch (error) {
    log.failure("FINANCE_ATTACHMENT_STATUS_FAILURE", error, { entityId: typeof body.attachmentId === "string" ? body.attachmentId : null, errorCode: error instanceof FinanceError ? `FINANCE_${error.status}` : "FINANCE_ATTACHMENT_INTERNAL" });
    return log.withRequestId(errorResponse(error));
  }
}
