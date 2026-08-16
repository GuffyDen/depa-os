import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getRequestUser } from "../../../../lib/auth";
import { FileError, finalizeAttachmentUpload, prepareAttachmentUpload } from "../../../../lib/files";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: HandleUploadBody;
  try { body = await request.json() as HandleUploadBody; }
  catch { return Response.json({ error: "Некорректные параметры загрузки." }, { status: 400 }); }
  const actor = body.type === "blob.generate-client-token" ? await getRequestUser(request) : null;
  if (body.type === "blob.generate-client-token" && !actor) return Response.json({ error: "Требуется авторизация." }, { status: 401 });
  try {
    const result = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname, clientPayload) => prepareAttachmentUpload(actor!, pathname, clientPayload),
      onUploadCompleted: async ({ blob, tokenPayload }) => finalizeAttachmentUpload(blob, tokenPayload),
    });
    return Response.json(result);
  } catch (error) {
    const status = error instanceof FileError ? error.status : 400;
    console.error("Blob upload route error", error);
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось загрузить файл." }, { status });
  }
}
