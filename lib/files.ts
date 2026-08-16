import { del, head, type PutBlobResult } from "@vercel/blob";
import type { AuthUser } from "./auth";
import { first, query, transaction } from "./postgres";

export const FILE_CATEGORIES = ["RECEIPT", "PROJECT_PHOTO", "DAILY_REPORT", "HIDDEN_WORK", "CONTRACT", "ACT", "ESTIMATE", "INSPECTION", "WARRANTY", "OTHER"] as const;
export type FileCategory = (typeof FILE_CATEGORIES)[number];
export type FileVisibility = "INTERNAL" | "PROJECT" | "CLIENT";

const PHOTO_CATEGORIES = new Set<FileCategory>(["PROJECT_PHOTO", "DAILY_REPORT", "HIDDEN_WORK", "INSPECTION", "WARRANTY"]);
const DOCUMENT_CATEGORIES = new Set<FileCategory>(["CONTRACT", "ACT", "ESTIMATE", "OTHER"]);
const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const RECEIPT_MIME_TYPES = [...IMAGE_MIME_TYPES, "application/pdf"];
const DOCUMENT_MIME_TYPES = ["application/pdf", ...IMAGE_MIME_TYPES];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;

export const PHOTO_LONG_EDGE_PX = 2400;
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;
export const PHOTO_MAX_BYTES = 20 * 1024 * 1024;
export const DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;

export type UploadClientPayload = {
  attachmentId: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256?: string | null;
  category: FileCategory;
  visibility?: FileVisibility;
  entityType: string;
  entityId?: string | null;
  projectId?: string | null;
};

type AttachmentRow = {
  id: string;
  transaction_id: string | null;
  project_id: string | null;
  storage_key: string;
  blob_url: string | null;
  original_filename: string;
  mime_type: string;
  size_bytes: number | string;
  checksum_sha256: string | null;
  uploaded_by_user_id: string;
  entity_type: string;
  entity_id: string | null;
  category: FileCategory;
  visibility: FileVisibility;
  upload_status: "PENDING" | "UPLOADED" | "LINKED" | "FAILED" | "DELETED";
  deleted_at: number | string | null;
};

export class FileError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

function nowSeconds() { return Math.floor(Date.now() / 1000); }
function cleanText(value: unknown, max: number) { return typeof value === "string" ? value.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max) : ""; }

function allowedMimeTypes(category: FileCategory) {
  if (PHOTO_CATEGORIES.has(category)) return IMAGE_MIME_TYPES;
  if (DOCUMENT_CATEGORIES.has(category)) return DOCUMENT_MIME_TYPES;
  return RECEIPT_MIME_TYPES;
}

export function fileLimitBytes(category: FileCategory) {
  if (PHOTO_CATEGORIES.has(category)) return PHOTO_MAX_BYTES;
  if (DOCUMENT_CATEGORIES.has(category)) return DOCUMENT_MAX_BYTES;
  return RECEIPT_MAX_BYTES;
}

function extensionForMime(mimeType: string) {
  const extensions: Record<string, string> = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "application/pdf": "pdf",
  };
  return extensions[mimeType] ?? "bin";
}

function categoryFolder(category: FileCategory) { return category.toLocaleLowerCase("en-US").replaceAll("_", "-"); }

export function attachmentPath(attachmentId: string, category: FileCategory, mimeType: string) {
  if (!UUID.test(attachmentId)) throw new FileError("Некорректный идентификатор файла.");
  return `depa-os/${categoryFolder(category)}/${attachmentId}.${extensionForMime(mimeType)}`;
}

function parsePayload(payload: string | null): UploadClientPayload {
  let value: Partial<UploadClientPayload>;
  try { value = JSON.parse(payload ?? "null") as Partial<UploadClientPayload>; }
  catch { throw new FileError("Некорректные параметры загрузки."); }
  if (!value || typeof value !== "object") throw new FileError("Некорректные параметры загрузки.");
  const category = cleanText(value.category, 40) as FileCategory;
  if (!(FILE_CATEGORIES as readonly string[]).includes(category)) throw new FileError("Неизвестная категория файла.");
  const attachmentId = cleanText(value.attachmentId, 100);
  const originalFilename = cleanText(value.originalFilename, 240);
  const mimeType = cleanText(value.mimeType, 100).toLocaleLowerCase("en-US");
  const sizeBytes = Number(value.sizeBytes);
  const checksumSha256 = cleanText(value.checksumSha256, 64) || null;
  const visibility = (cleanText(value.visibility, 20) || "INTERNAL") as FileVisibility;
  const entityType = cleanText(value.entityType, 80);
  if (!UUID.test(attachmentId) || !originalFilename || !entityType) throw new FileError("Не заполнены параметры файла.");
  if (!allowedMimeTypes(category).includes(mimeType)) throw new FileError("Разрешены JPG, PNG, WebP, HEIC/HEIF и PDF.");
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > fileLimitBytes(category)) throw new FileError("Файл превышает допустимый размер.");
  if (checksumSha256 && !SHA256.test(checksumSha256)) throw new FileError("Некорректная контрольная сумма файла.");
  if (!["INTERNAL", "PROJECT", "CLIENT"].includes(visibility)) throw new FileError("Некорректная видимость файла.");
  return {
    attachmentId, originalFilename, mimeType, sizeBytes, checksumSha256, category, visibility, entityType,
    entityId: cleanText(value.entityId, 120) || null,
    projectId: cleanText(value.projectId, 120) || null,
  };
}

async function assertProjectUploadAccess(actor: AuthUser, projectId: string | null | undefined) {
  if (!projectId || actor.role === "OWNER") return;
  const access = await first<{ id: string }>("SELECT id FROM user_project_access WHERE user_id=$1 AND project_id=$2 LIMIT 1", [actor.id, projectId]);
  if (!access) throw new FileError("Нет доступа к файлам этого объекта.", 403);
}

export async function prepareAttachmentUpload(actor: AuthUser, pathname: string, clientPayload: string | null) {
  const payload = parsePayload(clientPayload);
  await assertProjectUploadAccess(actor, payload.projectId);
  const expectedPath = attachmentPath(payload.attachmentId, payload.category, payload.mimeType);
  if (pathname !== expectedPath) throw new FileError("Путь загрузки файла отклонён.");
  const timestamp = nowSeconds();
  const existing = await first<{ uploaded_by_user_id: string; upload_status: string }>("SELECT uploaded_by_user_id,upload_status FROM attachments WHERE id=$1 LIMIT 1", [payload.attachmentId]);
  if (existing && (existing.uploaded_by_user_id !== actor.id || existing.upload_status !== "PENDING")) throw new FileError("Эта загрузка уже использована.", 409);
  if (!existing) {
    await query(`INSERT INTO attachments
      (id,transaction_id,project_id,storage_provider,storage_key,blob_url,original_filename,mime_type,size_bytes,checksum_sha256,uploaded_by_user_id,entity_type,entity_id,category,visibility,upload_status,metadata_json,created_at,updated_at)
      VALUES ($1,NULL,$2,'VERCEL_BLOB',$3,NULL,$4,$5,0,$6,$7,$8,$9,$10,$11,'PENDING',$12::jsonb,$13,$14)`,
    [payload.attachmentId, payload.projectId ?? null, expectedPath, payload.originalFilename, payload.mimeType, payload.checksumSha256, actor.id, payload.entityType, payload.entityId ?? null, payload.category, payload.visibility ?? "INTERNAL", JSON.stringify({ declaredSizeBytes: payload.sizeBytes, photoLongEdgeTargetPx: PHOTO_CATEGORIES.has(payload.category) ? PHOTO_LONG_EDGE_PX : null }), timestamp, timestamp]);
  }
  return {
    allowedContentTypes: allowedMimeTypes(payload.category),
    maximumSizeInBytes: fileLimitBytes(payload.category),
    validUntil: Date.now() + 10 * 60 * 1000,
    addRandomSuffix: false,
    allowOverwrite: false,
    cacheControlMaxAge: 60,
    tokenPayload: JSON.stringify({ attachmentId: payload.attachmentId, uploadedByUserId: actor.id }),
  };
}

export async function finalizeAttachmentUpload(blob: PutBlobResult, tokenPayload: string | null | undefined) {
  let signed: { attachmentId?: string; uploadedByUserId?: string };
  try { signed = JSON.parse(tokenPayload ?? "null") as { attachmentId?: string; uploadedByUserId?: string }; }
  catch { throw new FileError("Некорректное подтверждение загрузки."); }
  if (!signed?.attachmentId || !signed.uploadedByUserId) throw new FileError("Подтверждение загрузки не содержит идентификатор.");
  await finalizeAttachmentMetadata(signed.attachmentId, signed.uploadedByUserId, blob);
}

async function finalizeAttachmentMetadata(attachmentId: string, userId: string, blob: Pick<PutBlobResult, "url" | "pathname" | "contentType"> & { size?: number }) {
  const row = await first<AttachmentRow>("SELECT * FROM attachments WHERE id=$1 LIMIT 1", [attachmentId]);
  if (!row || row.uploaded_by_user_id !== userId || row.deleted_at) throw new FileError("Загрузка файла не найдена.", 404);
  if (row.storage_key !== blob.pathname || !blob.url.includes(".private.blob.vercel-storage.com/")) throw new FileError("Blob не соответствует разрешённой загрузке.");
  const metadata = blob.size == null ? await head(row.storage_key) : blob;
  const sizeBytes = Number(metadata.size);
  const mimeType = cleanText(blob.contentType || row.mime_type, 100).toLocaleLowerCase("en-US");
  if (!allowedMimeTypes(row.category).includes(mimeType) || sizeBytes <= 0 || sizeBytes > fileLimitBytes(row.category)) throw new FileError("Загруженный файл не прошёл проверку типа или размера.");
  const timestamp = nowSeconds();
  await query(`WITH updated AS (
      UPDATE attachments SET blob_url=$1,mime_type=$2,size_bytes=$3,upload_status='UPLOADED',completed_at=$4,updated_at=$5
      WHERE id=$6 AND uploaded_by_user_id=$7 AND upload_status='PENDING' RETURNING id
    ) INSERT INTO audit_logs (id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json)
      SELECT $8,$7,'FILE_UPLOADED','Attachment',id,$4,$9 FROM updated`,
  [blob.url, mimeType, sizeBytes, timestamp, timestamp, attachmentId, userId, crypto.randomUUID(), JSON.stringify({ category: row.category, mimeType, sizeBytes })]);
}

export async function confirmAttachmentUpload(actor: AuthUser, attachmentId: string) {
  const row = await first<AttachmentRow>("SELECT * FROM attachments WHERE id=$1 LIMIT 1", [attachmentId]);
  if (!row || row.uploaded_by_user_id !== actor.id || row.deleted_at) throw new FileError("Файл не найден.", 404);
  if (row.upload_status === "PENDING") {
    const blob = await head(row.storage_key);
    await finalizeAttachmentMetadata(row.id, actor.id, blob);
  }
  const ready = await first<AttachmentRow>("SELECT * FROM attachments WHERE id=$1 LIMIT 1", [attachmentId]);
  if (!ready || ready.upload_status !== "UPLOADED") throw new FileError("Загрузка файла ещё не завершена.", 409);
  return ready;
}

export async function cleanupUnlinkedAttachment(actor: AuthUser, attachmentId: string, reason = "OPERATION_FAILED") {
  const row = await first<AttachmentRow>("SELECT * FROM attachments WHERE id=$1 LIMIT 1", [attachmentId]);
  if (!row || (row.uploaded_by_user_id !== actor.id && actor.role !== "OWNER") || row.transaction_id || row.upload_status === "LINKED" || row.upload_status === "DELETED") return;
  const timestamp = nowSeconds();
  await transaction([
    { text: "UPDATE attachments SET upload_status='FAILED',deleted_at=$1,deleted_by_user_id=$2,updated_at=$3 WHERE id=$4 AND transaction_id IS NULL", params: [timestamp, actor.id, timestamp, row.id] },
    { text: "INSERT INTO audit_logs (id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES ($1,$2,'FILE_DELETED','Attachment',$3,$4,$5)", params: [crypto.randomUUID(), actor.id, row.id, timestamp, JSON.stringify({ reason })] },
  ]);
  try { await del(row.storage_key); } catch (error) { console.error("Blob compensation cleanup failed", { attachmentId: row.id, error }); }
}

export async function getAuthorizedAttachment(actor: AuthUser, attachmentId: string) {
  const row = await first<AttachmentRow & { cashbox_owner_user_id: string | null; transaction_author_user_id: string | null }>(`SELECT a.*,
    cb.owner_user_id AS cashbox_owner_user_id,ft.author_user_id AS transaction_author_user_id
    FROM attachments a LEFT JOIN financial_transactions ft ON ft.id=a.transaction_id LEFT JOIN cashboxes cb ON cb.id=ft.cashbox_id
    WHERE a.id=$1 AND a.upload_status='LINKED' AND a.deleted_at IS NULL LIMIT 1`, [attachmentId]);
  if (!row) throw new FileError("Файл не найден.", 404);
  if (actor.role !== "OWNER") {
    const ownOperation = row.uploaded_by_user_id === actor.id || row.cashbox_owner_user_id === actor.id || row.transaction_author_user_id === actor.id;
    const projectAccess = row.project_id ? await first<{ id: string }>("SELECT id FROM user_project_access WHERE user_id=$1 AND project_id=$2 LIMIT 1", [actor.id, row.project_id]) : null;
    if (!ownOperation && !projectAccess) throw new FileError("Нет доступа к этому файлу.", 403);
  }
  return row;
}

export async function auditFileViewed(actor: AuthUser, attachmentId: string) {
  await query("INSERT INTO audit_logs (id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES ($1,$2,'FILE_VIEWED','Attachment',$3,$4,'{}')", [crypto.randomUUID(), actor.id, attachmentId, nowSeconds()]);
}

export async function deleteUnlinkedAttachment(actor: AuthUser, attachmentId: string) {
  if (actor.role !== "OWNER") throw new FileError("Удалять файлы может только Owner.", 403);
  const row = await first<AttachmentRow>("SELECT * FROM attachments WHERE id=$1 LIMIT 1", [attachmentId]);
  if (!row) throw new FileError("Файл не найден.", 404);
  if (row.transaction_id || row.upload_status === "LINKED") throw new FileError("Файл связанной финансовой операции нельзя удалить.", 409);
  await cleanupUnlinkedAttachment(actor, attachmentId, "OWNER_DELETE");
}
