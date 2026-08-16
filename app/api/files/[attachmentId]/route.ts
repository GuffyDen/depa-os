import { get } from "@vercel/blob";
import { getRequestUser } from "../../../../lib/auth";
import { auditFileViewed, deleteUnlinkedAttachment, FileError, getAuthorizedAttachment } from "../../../../lib/files";

export const dynamic = "force-dynamic";

function fileError(error: unknown) {
  if (error instanceof FileError) return Response.json({ error: error.message }, { status: error.status });
  console.error("Protected file route error", error);
  return Response.json({ error: "Не удалось получить файл." }, { status: 500 });
}

export async function GET(request: Request, { params }: { params: Promise<{ attachmentId: string }> }) {
  const actor = await getRequestUser(request);
  if (!actor) return Response.json({ error: "Требуется авторизация." }, { status: 401 });
  try {
    const { attachmentId } = await params;
    const attachment = await getAuthorizedAttachment(actor, attachmentId);
    const result = await get(attachment.storage_key, { access: "private", ifNoneMatch: request.headers.get("if-none-match") ?? undefined });
    if (!result) throw new FileError("Файл не найден в хранилище.", 404);
    if (result.statusCode === 304) return new Response(null, { status: 304, headers: { ETag: result.blob.etag, "Cache-Control": "private, no-store" } });
    await auditFileViewed(actor, attachment.id);
    const filename = encodeURIComponent(attachment.original_filename).replaceAll("'", "%27");
    return new Response(result.stream, { headers: {
      "Content-Type": attachment.mime_type,
      "Content-Disposition": `inline; filename*=UTF-8''${filename}`,
      "Content-Length": String(attachment.size_bytes),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      ETag: result.blob.etag,
    } });
  } catch (error) { return fileError(error); }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ attachmentId: string }> }) {
  const actor = await getRequestUser(request);
  if (!actor) return Response.json({ error: "Требуется авторизация." }, { status: 401 });
  try {
    const { attachmentId } = await params;
    await deleteUnlinkedAttachment(actor, attachmentId);
    return Response.json({ ok: true });
  } catch (error) { return fileError(error); }
}
