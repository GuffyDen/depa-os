import { del, head, type PutBlobResult } from "@vercel/blob";
import type { AuthUser } from "./auth";
import { first, query, transaction } from "./postgres";
import { AccessError, assertModuleAction, canViewCashbox, canViewContract, canViewDesignProject, canViewProject, getAccessProfile } from "./permissions";

export const FILE_CATEGORIES = ["RECEIPT", "PROJECT_PHOTO", "DAILY_REPORT", "HIDDEN_WORK", "ADDITIONAL_WORK", "CONTRACT", "ACT", "ESTIMATE", "INSPECTION", "WARRANTY", "MEASUREMENT_PLAN", "LAYOUT", "CONCEPT", "VISUALIZATION", "WORKING_DRAWINGS", "SPECIFICATION", "FINAL_ALBUM", "CONTRACT_DOCX", "CONTRACT_PDF", "SIGNED_CONTRACT", "CONTRACT_OTHER", "OTHER"] as const;
export type FileCategory = (typeof FILE_CATEGORIES)[number];
export type FileVisibility = "INTERNAL" | "PROJECT" | "CLIENT";

const PHOTO_CATEGORIES = new Set<FileCategory>(["PROJECT_PHOTO", "DAILY_REPORT", "HIDDEN_WORK", "INSPECTION", "WARRANTY"]);
const DESIGN_DOCUMENT_CATEGORIES = new Set<FileCategory>(["MEASUREMENT_PLAN", "LAYOUT", "CONCEPT", "VISUALIZATION", "WORKING_DRAWINGS", "SPECIFICATION", "FINAL_ALBUM"]);
const CONTRACT_CATEGORIES = new Set<FileCategory>(["CONTRACT_DOCX", "CONTRACT_PDF", "SIGNED_CONTRACT", "CONTRACT_OTHER"]);
const DOCUMENT_CATEGORIES = new Set<FileCategory>(["ADDITIONAL_WORK", "CONTRACT", "ACT", "ESTIMATE", ...DESIGN_DOCUMENT_CATEGORIES, ...CONTRACT_CATEGORIES, "OTHER"]);
const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const RECEIPT_MIME_TYPES = [...IMAGE_MIME_TYPES, "application/pdf"];
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DOCUMENT_MIME_TYPES = ["application/pdf", DOCX_MIME, ...IMAGE_MIME_TYPES];
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
  contractVersionId?: string | null;
  additionalWorkVersionId?: string | null;
};

type AttachmentRow = {
  id: string;
  transaction_id: string | null;
  project_id: string | null;
  design_project_id: string | null;
  contract_version_id: string | null;
  additional_work_version_id: string | null;
  client_payment_claim_id: string | null;
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
  if (category === "CONTRACT_DOCX") return [DOCX_MIME];
  if (["CONTRACT_PDF", "SIGNED_CONTRACT", "CONTRACT_OTHER"].includes(category)) return ["application/pdf", ...IMAGE_MIME_TYPES];
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
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "application/pdf": "pdf", [DOCX_MIME]: "docx",
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
    contractVersionId: cleanText(value.contractVersionId, 120) || null,
    additionalWorkVersionId: cleanText(value.additionalWorkVersionId, 120) || null,
  };
}

async function assertProjectUploadAccess(actor: AuthUser, projectId: string | null | undefined) {
  if (!projectId || actor.role === "OWNER") return;
  if (!(await canViewProject(actor, projectId))) throw new FileError("Нет доступа к файлам этого объекта.", 403);
}

async function assertProductionFileProjectAccess(actor: AuthUser, projectId: string | null | undefined) {
  if (!projectId) throw new FileError("Некорректная связь production-файла.");
  if (actor.role === "OWNER") return;
  const access = await getAccessProfile(actor);
  if (access.scopes.production === "ALL") return;
  const row = await first<{ id: string }>(`SELECT p.id FROM projects p
    LEFT JOIN user_project_access a ON a.project_id=p.id AND a.user_id=$2
    WHERE p.id=$1 AND (p.responsible_user_id=$2 OR a.id IS NOT NULL OR p.manager_employee_id=$3 OR p.foreman_employee_id=$3) LIMIT 1`, [projectId, actor.id, actor.employeeId]);
  if (!row) throw new FileError("Нет доступа к production-файлам этого объекта.", 403);
}

async function assertInspectionFileAccess(actor: AuthUser, entityType: string, entityId: string | null | undefined) {
  if (!entityId || !["Inspection", "InspectionDefect"].includes(entityType)) throw new FileError("Некорректная связь фотографии приёмки.", 400);
  const access = await getAccessProfile(actor);
  const assigned = actor.role !== "OWNER" && access.scopes.orders !== "ALL";
  const entityJoin = entityType === "Inspection"
    ? "i.id=$1"
    : "EXISTS (SELECT 1 FROM inspection_defects d WHERE d.id=$1 AND d.inspection_id=i.id)";
  const order = await first<{ id: string }>(`SELECT o.id FROM inspections i JOIN orders o ON o.id=i.order_id JOIN clients c ON c.id=o.client_id
    WHERE ${entityJoin}${assigned ? " AND (o.responsible_user_id=$2 OR i.inspector_user_id=$2)" : ""} LIMIT 1`, assigned ? [entityId, actor.id] : [entityId]);
  if (!order) throw new FileError("Нет доступа к фотографиям этой приёмки.", 403);
}

async function assertDesignFileAccess(
  actor: AuthUser,
  entityType: string,
  entityId: string | null | undefined,
) {
  if (!entityId || !["DesignProject", "DesignStage"].includes(entityType))
    throw new FileError("Некорректная связь файла дизайн-проекта.", 400);
  const project = await first<{ id: string }>(
    entityType === "DesignProject"
      ? "SELECT id FROM design_projects WHERE id=$1 LIMIT 1"
      : "SELECT design_project_id id FROM design_project_stages WHERE id=$1 AND archived_at IS NULL LIMIT 1",
    [entityId],
  );
  if (!project || !(await canViewDesignProject(actor, project.id)))
    throw new FileError("Нет доступа к файлам этого дизайн-проекта.", 403);
}

async function assertContractFileAccess(actor: AuthUser, contractVersionId: string | null | undefined) {
  if (!contractVersionId) throw new FileError("Некорректная связь файла договора.");
  const row = await first<{ contract_id: string }>("SELECT contract_id FROM contract_versions WHERE id=$1", [contractVersionId]);
  if (!row || !(await canViewContract(actor, row.contract_id))) throw new FileError("Нет доступа к файлам этого договора.", 403);
}

async function assertAdditionalWorkFileAccess(actor: AuthUser, versionId: string | null | undefined, projectId: string | null | undefined, action: "additionalWorks.uploadFiles" | "additionalWorks.view" = "additionalWorks.uploadFiles") {
  if (!versionId || !projectId) throw new FileError("Некорректная связь файла дополнительной работы.");
  try { await assertModuleAction(actor, "projects", action); }
  catch (error) { if (error instanceof AccessError) throw new FileError("Нет права загружать файлы дополнительной работы.", 403); throw error; }
  const row = await first<{ project_id: string }>("SELECT project_id FROM additional_work_versions WHERE id=$1", [versionId]);
  if (!row || row.project_id !== projectId || !(await canViewProject(actor, projectId))) throw new FileError("Версия дополнительной работы недоступна.", 403);
}

export async function prepareAttachmentUpload(actor: AuthUser, pathname: string, clientPayload: string | null) {
  const payload = parsePayload(clientPayload);
  const isDesignFile = DESIGN_DOCUMENT_CATEGORIES.has(payload.category) || ["DesignProject", "DesignStage"].includes(payload.entityType);
  const isContractFile = CONTRACT_CATEGORIES.has(payload.category) || payload.entityType === "ContractVersion";
  try {
    if (payload.category === "RECEIPT") await assertModuleAction(actor, "finance", "finance.createExpense");
    else if (payload.category === "DAILY_REPORT") await assertModuleAction(actor, "projects", "dailyReports.uploadPhotos");
    else if (payload.category === "HIDDEN_WORK") await assertModuleAction(actor, "projects", "hiddenWorks.upload");
    else if (payload.category === "ADDITIONAL_WORK") await assertModuleAction(actor, "projects", "additionalWorks.uploadFiles");
    else if (isContractFile) await assertModuleAction(actor, "orders", payload.category === "CONTRACT_DOCX" || payload.category === "CONTRACT_PDF" ? "contracts.generateDocuments" : "contracts.uploadSigned");
    else if (isDesignFile) await assertModuleAction(actor, "orders", "design.files.upload");
    else await assertModuleAction(actor, "documents", "documents.upload");
  } catch (error) {
    if (error instanceof AccessError) throw new FileError("Нет права загружать этот файл.", 403);
    throw error;
  }
  await assertProjectUploadAccess(actor, payload.projectId);
  if (payload.category === "DAILY_REPORT" || payload.category === "HIDDEN_WORK") await assertProductionFileProjectAccess(actor, payload.projectId);
  if (payload.category === "INSPECTION") await assertInspectionFileAccess(actor, payload.entityType, payload.entityId);
  if (isDesignFile) await assertDesignFileAccess(actor, payload.entityType, payload.entityId);
  if (isContractFile) await assertContractFileAccess(actor, payload.contractVersionId);
  if (payload.category === "ADDITIONAL_WORK") await assertAdditionalWorkFileAccess(actor, payload.additionalWorkVersionId, payload.projectId);
  const expectedPath = attachmentPath(payload.attachmentId, payload.category, payload.mimeType);
  if (pathname !== expectedPath) throw new FileError("Путь загрузки файла отклонён.");
  const timestamp = nowSeconds();
  const existing = await first<{ uploaded_by_user_id: string; upload_status: string }>("SELECT uploaded_by_user_id,upload_status FROM attachments WHERE id=$1 LIMIT 1", [payload.attachmentId]);
  if (existing && (existing.uploaded_by_user_id !== actor.id || existing.upload_status !== "PENDING")) throw new FileError("Эта загрузка уже использована.", 409);
  if (!existing) {
    await query(`INSERT INTO attachments
      (id,transaction_id,project_id,contract_version_id,additional_work_version_id,storage_provider,storage_key,blob_url,original_filename,mime_type,size_bytes,checksum_sha256,uploaded_by_user_id,entity_type,entity_id,category,visibility,upload_status,metadata_json,created_at,updated_at)
      VALUES ($1,NULL,$2,$3,$4,'VERCEL_BLOB',$5,NULL,$6,$7,0,$8,$9,$10,$11,$12,$13,'PENDING',$14::jsonb,$15,$16)`,
    [payload.attachmentId, payload.projectId ?? null, payload.contractVersionId ?? null, payload.additionalWorkVersionId ?? null, expectedPath, payload.originalFilename, payload.mimeType, payload.checksumSha256, actor.id, payload.entityType, payload.entityId ?? null, payload.category, payload.visibility ?? "INTERNAL", JSON.stringify({ declaredSizeBytes: payload.sizeBytes, photoLongEdgeTargetPx: PHOTO_CATEGORIES.has(payload.category) ? PHOTO_LONG_EDGE_PX : null }), timestamp, timestamp]);
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
      UPDATE attachments SET blob_url=$1,mime_type=$2,size_bytes=$3,upload_status=CASE WHEN category='ADDITIONAL_WORK' THEN 'LINKED' ELSE 'UPLOADED' END,completed_at=$4,linked_at=CASE WHEN category='ADDITIONAL_WORK' THEN $4 ELSE linked_at END,updated_at=$5
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
  const row = await first<AttachmentRow & { cashbox_id: string | null; expense_type: string | null }>(`SELECT a.*,
    ft.cashbox_id,ft.expense_type
    FROM attachments a LEFT JOIN financial_transactions ft ON ft.id=a.transaction_id LEFT JOIN cashboxes cb ON cb.id=ft.cashbox_id
    WHERE a.id=$1 AND a.upload_status='LINKED' AND a.deleted_at IS NULL LIMIT 1`, [attachmentId]);
  if (!row) throw new FileError("Файл не найден.", 404);
  if (actor.role !== "OWNER") {
    try {
      if (row.client_payment_claim_id) {
        await assertModuleAction(actor, "finance", "clientPayments.viewProof");
        const claim = await first<{ project_id: string }>("SELECT project_id FROM client_payment_claims WHERE id=$1", [row.client_payment_claim_id]);
        if (!claim || !(await canViewProject(actor, claim.project_id))) throw new FileError("Нет доступа к подтверждению оплаты.", 403);
      } else if (row.category === "RECEIPT") {
        await assertModuleAction(actor, "finance", "finance.view");
        if (!row.cashbox_id || !(await canViewCashbox(actor, row.cashbox_id))) throw new FileError("Нет доступа к этому чеку.", 403);
        if (row.expense_type === "ADMIN" && !(await getAccessProfile(actor)).actions["finance.viewAdministrativeExpenses"]) throw new FileError("Нет доступа к этому чеку.", 403);
      } else if (row.category === "INSPECTION") {
        await assertModuleAction(actor, "orders", "orders.view");
        await assertInspectionFileAccess(actor, row.entity_type, row.entity_id);
      } else if (row.category === "ADDITIONAL_WORK") {
        await assertModuleAction(actor, "projects", "additionalWorks.view");
        if (!row.additional_work_version_id) throw new FileError("Файл не связан с версией дополнительной работы.", 403);
        await assertAdditionalWorkFileAccess(actor, row.additional_work_version_id, row.project_id, "additionalWorks.view");
      } else if (row.category === "DAILY_REPORT" || row.category === "HIDDEN_WORK") {
        await assertModuleAction(actor, "projects", "production.view");
        await assertProductionFileProjectAccess(actor, row.project_id);
      } else if (row.design_project_id || DESIGN_DOCUMENT_CATEGORIES.has(row.category)) {
        await assertModuleAction(actor, "orders", "design.files.view");
        const designProjectId = row.design_project_id ??
          (row.entity_type === "DesignProject"
            ? row.entity_id
            : (await first<{ id: string }>("SELECT design_project_id id FROM design_project_stages WHERE id=$1 LIMIT 1", [row.entity_id]))?.id);
        if (!designProjectId || !(await canViewDesignProject(actor, designProjectId)))
          throw new FileError("Нет доступа к этому файлу.", 403);
      } else if (row.contract_version_id || CONTRACT_CATEGORIES.has(row.category)) {
        await assertModuleAction(actor, "orders", "contracts.view");
        if (!row.contract_version_id) throw new FileError("Файл договора не связан с версией.", 403);
        await assertContractFileAccess(actor, row.contract_version_id);
      } else {
        await assertModuleAction(actor, "documents", "documents.view");
        if (row.project_id && !(await canViewProject(actor, row.project_id))) throw new FileError("Нет доступа к этому файлу.", 403);
      }
    } catch (error) {
      if (error instanceof FileError) throw error;
      if (error instanceof AccessError) throw new FileError("Нет доступа к этому файлу.", 403);
      throw error;
    }
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
