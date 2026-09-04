import { getRequestUser } from "../../../../../lib/auth";
import { FileError, ServerFallbackError, uploadFinanceAttachmentFallback } from "../../../../../lib/files";
import { createRequestLogger } from "../../../../../lib/request-logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  const log = createRequestLogger(request, { route: "/api/finance/attachments/fallback", action: "FINANCE_ATTACHMENT_SERVER_FALLBACK", actorType: user ? "EMPLOYEE" : "ANONYMOUS", actorId: user?.id ?? null });
  if (!user) return log.json({ error: "Требуется авторизация.", failureCode: "SERVER_FALLBACK_FAILED" }, { status: 401 });
  let form: FormData;
  try { form = await request.formData(); }
  catch (error) { log.failure("FINANCE_ATTACHMENT_SERVER_FALLBACK_FAILED", error, { errorCode: "INVALID_MULTIPART" }); return log.json({ error: "Некорректное тело резервной загрузки.", failureCode: "SERVER_FALLBACK_FAILED" }, { status: 400 }); }
  const file = form.get("file");
  const input = {
    attachmentId: String(form.get("attachmentId") ?? ""),
    transactionId: String(form.get("transactionId") ?? ""),
    uploadAttemptId: String(form.get("uploadAttemptId") ?? ""),
    checksumSha256: String(form.get("checksumSha256") ?? ""),
  };
  if (!(file instanceof Blob)) return log.json({ error: "Подготовленный файл не передан.", failureCode: "SERVER_FALLBACK_FAILED" }, { status: 400 });
  log.success("FINANCE_ATTACHMENT_SERVER_FALLBACK_RECEIVED", { entityId: input.attachmentId, transactionId: input.transactionId, sizeBytes: file.size, mimeType: file.type });
  try {
    const result = await uploadFinanceAttachmentFallback(user, input, file);
    log.success("FINANCE_ATTACHMENT_SERVER_FALLBACK_SUCCESS", { entityId: input.attachmentId, transactionId: input.transactionId, uploadDurationMs: result.uploadDurationMs, confirmationDurationMs: result.confirmationDurationMs, idempotent: result.idempotent });
    return log.json(result);
  } catch (error) {
    const status = error instanceof FileError ? error.status : 500;
    const failureCode = error instanceof ServerFallbackError ? error.failureCode : "SERVER_FALLBACK_FAILED";
    log.failure("FINANCE_ATTACHMENT_SERVER_FALLBACK_FAILED", error, { entityId: input.attachmentId, transactionId: input.transactionId, errorCode: failureCode, sizeBytes: file.size, mimeType: file.type });
    return log.json({ error: error instanceof Error ? error.message : "Резервная загрузка не удалась.", failureCode }, { status });
  }
}
