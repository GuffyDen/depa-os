import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getRequestUser } from "../../../../lib/auth";
import { FileError, finalizeAttachmentUpload, prepareAttachmentUpload } from "../../../../lib/files";
import { createRequestLogger } from "../../../../lib/request-logger";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const log = createRequestLogger(request, { route: "/api/files/upload", action: "FILE_UPLOAD", actorType: "ANONYMOUS" });
  let body: HandleUploadBody;
  try { body = await request.json() as HandleUploadBody; }
  catch (error) { log.failure("FILE_UPLOAD_FAILURE", error, { errorCode: "INVALID_UPLOAD_BODY" }); return log.json({ error: "Некорректные параметры загрузки." }, { status: 400 }); }
  const actor = body.type === "blob.generate-client-token" ? await getRequestUser(request) : null;
  if (body.type === "blob.generate-client-token" && !actor) { log.failure("FILE_UPLOAD_FAILURE", new Error("Unauthorized"), { errorCode: "UNAUTHORIZED" }); return log.json({ error: "Требуется авторизация." }, { status: 401 }); }
  try {
    const result = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname, clientPayload) => prepareAttachmentUpload(actor!, pathname, clientPayload),
      onUploadCompleted: async ({ blob, tokenPayload }) => finalizeAttachmentUpload(blob, tokenPayload),
    });
    return log.withRequestId(Response.json(result));
  } catch (error) {
    const status = error instanceof FileError ? error.status : 400;
    log.failure("FILE_UPLOAD_FAILURE", error, { actorType: actor ? "EMPLOYEE" : "SYSTEM", actorId: actor?.id ?? null, errorCode: error instanceof FileError ? `FILE_${status}` : "FILE_UPLOAD_INTERNAL" });
    return log.json({ error: error instanceof Error ? error.message : "Не удалось загрузить файл." }, { status });
  }
}
