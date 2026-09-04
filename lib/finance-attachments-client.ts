export const FINANCE_ATTACHMENT_ACCEPT = ".jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf";
export const FINANCE_ATTACHMENT_MAX_ORIGINAL_BYTES = 25 * 1024 * 1024;
export const FINANCE_HEIC_CONVERSION_TIMEOUT_MS = 20_000;
export const FINANCE_IMAGE_COMPRESSION_TIMEOUT_MS = 20_000;
export const FINANCE_BLOB_UPLOAD_TIMEOUT_MS = 90_000;
export const FINANCE_ATTACHMENT_CONFIRM_TIMEOUT_MS = 10_000;

export type FinanceAttachmentDraft = {
  attachmentId: string;
  originalFilename: string;
  originalMimeType: string;
  originalSizeBytes: number;
  mimeType: "image/jpeg" | "application/pdf";
};

type UploadPhase = "preparing" | "uploading" | "ready" | "failed";

type LifecycleDetail = string | number | boolean | null | undefined;

export function logFinanceLifecycle(stage: string, details: Record<string, LifecycleDetail> = {}) {
  console.info("FINANCE_ATTACHMENT_LIFECYCLE", { stage, ...details });
}

export async function financePromiseWithTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs); }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function inferredMimeType(file: File) {
  const declared = file.type.toLocaleLowerCase("en-US");
  if (declared) return declared;
  const extension = file.name.split(".").pop()?.toLocaleLowerCase("en-US");
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  if (extension === "heic") return "image/heic";
  if (extension === "heif") return "image/heif";
  if (extension === "pdf") return "application/pdf";
  return "";
}

export function createFinanceAttachmentDraft(file: File): FinanceAttachmentDraft {
  const originalMimeType = inferredMimeType(file);
  if (!["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"].includes(originalMimeType)) {
    throw new Error("Разрешены PDF, JPG, PNG, WebP и HEIC/HEIF.");
  }
  const maximumBytes = originalMimeType === "application/pdf" ? 10 * 1024 * 1024 : FINANCE_ATTACHMENT_MAX_ORIGINAL_BYTES;
  if (file.size <= 0 || file.size > maximumBytes) {
    throw new Error(originalMimeType === "application/pdf" ? "PDF должен быть не больше 10 МБ." : "Каждое исходное изображение должно быть не больше 25 МБ.");
  }
  return {
    attachmentId: crypto.randomUUID(),
    originalFilename: file.name,
    originalMimeType,
    originalSizeBytes: file.size,
    mimeType: originalMimeType === "application/pdf" ? "application/pdf" : "image/jpeg",
  };
}

export async function prepareFinanceAttachmentFile(file: File, draft: FinanceAttachmentDraft, traceId = crypto.randomUUID()) {
  if (draft.mimeType === "application/pdf") return file;
  let source = file;
  if (draft.originalMimeType === "image/heic" || draft.originalMimeType === "image/heif") {
    const conversionStartedAt = performance.now();
    logFinanceLifecycle("heic_conversion_started", { traceId, attachmentId: draft.attachmentId });
    const blob = await financePromiseWithTimeout((async () => {
      const { heicTo } = await import("heic-to/next");
      return heicTo({ blob: file, type: "image/jpeg", quality: 0.92 });
    })(), FINANCE_HEIC_CONVERSION_TIMEOUT_MS, "Не удалось обработать HEIC за отведённое время.");
    logFinanceLifecycle("heic_conversion_finished", { traceId, attachmentId: draft.attachmentId, durationMs: Math.round(performance.now() - conversionStartedAt) });
    source = new File([blob], `${file.name.replace(/\.(heic|heif)$/iu, "")}.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
  }
  const compressionStartedAt = performance.now();
  const optimized = await financePromiseWithTimeout((async () => {
    const { default: imageCompression } = await import("browser-image-compression");
    return imageCompression(source, {
      maxSizeMB: 1.1,
      maxWidthOrHeight: 1800,
      initialQuality: 0.84,
      fileType: "image/jpeg",
      useWebWorker: true,
      preserveExif: false,
    });
  })(), FINANCE_IMAGE_COMPRESSION_TIMEOUT_MS, "Не удалось сжать изображение за отведённое время.");
  logFinanceLifecycle("compression_finished", { traceId, attachmentId: draft.attachmentId, durationMs: Math.round(performance.now() - compressionStartedAt), optimizedSizeBytes: optimized.size });
  return optimized;
}

async function sha256(file: File) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function uploadFinanceAttachment({
  file,
  draft,
  transactionId,
  projectId,
  onPhase,
  traceId = crypto.randomUUID(),
}: {
  file: File;
  draft: FinanceAttachmentDraft;
  transactionId: string;
  projectId: string | null;
  onPhase?: (phase: UploadPhase) => void;
  traceId?: string;
}) {
  const startedAt = performance.now();
  try {
    onPhase?.("preparing");
    logFinanceLifecycle("attachment_preprocessing_started", { traceId, attachmentId: draft.attachmentId, transactionId, originalMimeType: draft.originalMimeType, originalSizeBytes: draft.originalSizeBytes });
    const optimized = await prepareFinanceAttachmentFile(file, draft, traceId);
    const preparationMs = Math.round(performance.now() - startedAt);
    const checksumSha256 = await sha256(optimized);
    onPhase?.("uploading");
    logFinanceLifecycle("blob_upload_started", { traceId, attachmentId: draft.attachmentId, transactionId, optimizedSizeBytes: optimized.size, preparationMs });
    const { upload } = await import("@vercel/blob/client");
    await financePromiseWithTimeout(upload(`depa-os/receipt/${draft.attachmentId}.${draft.mimeType === "application/pdf" ? "pdf" : "jpg"}`, optimized, {
      access: "private",
      handleUploadUrl: "/api/files/upload",
      contentType: draft.mimeType,
      multipart: optimized.size > 5 * 1024 * 1024,
      clientPayload: JSON.stringify({
        attachmentId: draft.attachmentId,
        originalFilename: draft.originalFilename,
        mimeType: draft.mimeType,
        sizeBytes: optimized.size,
        checksumSha256,
        category: "RECEIPT",
        visibility: "INTERNAL",
        entityType: "FINANCIAL_TRANSACTION",
        entityId: transactionId,
        projectId,
      }),
    }), FINANCE_BLOB_UPLOAD_TIMEOUT_MS, "Загрузка файла не завершилась за отведённое время.");
    logFinanceLifecycle("blob_upload_finished", { traceId, attachmentId: draft.attachmentId, transactionId, durationMs: Math.round(performance.now() - startedAt) - preparationMs });
    let confirmed = false;
    for (let attempt = 0; attempt < 3 && !confirmed; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, attempt * 300));
      const response = await financePromiseWithTimeout(fetch("/api/finance/attachments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attachmentId: draft.attachmentId, status: "UPLOADED" }),
      }), FINANCE_ATTACHMENT_CONFIRM_TIMEOUT_MS, "Подтверждение загрузки не завершилось за отведённое время.");
      if (response.ok) confirmed = true;
      else if (response.status !== 409 || attempt === 2) {
        const result = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(result.error ?? "Не удалось подтвердить загрузку файла.");
      }
    }
    if (!confirmed) throw new Error("Не удалось подтвердить загрузку файла.");
    logFinanceLifecycle("attachment_link_confirmed", { traceId, attachmentId: draft.attachmentId, transactionId });
    onPhase?.("ready");
    console.info("FINANCE_ATTACHMENT_UPLOAD_SUCCESS", {
      attachmentId: draft.attachmentId,
      transactionId,
      originalMimeType: draft.originalMimeType,
      originalSizeBytes: draft.originalSizeBytes,
      optimizedSizeBytes: optimized.size,
      preparationMs,
      uploadMs: Math.round(performance.now() - startedAt) - preparationMs,
      totalMs: Math.round(performance.now() - startedAt),
    });
    return { originalSizeBytes: draft.originalSizeBytes, optimizedSizeBytes: optimized.size };
  } catch (error) {
    onPhase?.("failed");
    await financePromiseWithTimeout(fetch("/api/finance/attachments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attachmentId: draft.attachmentId, status: "FAILED" }),
    }), FINANCE_ATTACHMENT_CONFIRM_TIMEOUT_MS, "Не удалось сохранить статус ошибки вложения.").catch(() => undefined);
    logFinanceLifecycle("attachment_failed", { traceId, attachmentId: draft.attachmentId, transactionId, durationMs: Math.round(performance.now() - startedAt), error: error instanceof Error ? error.message : "UNKNOWN_ERROR" });
    console.error("FINANCE_ATTACHMENT_UPLOAD_FAILURE", {
      attachmentId: draft.attachmentId,
      transactionId,
      originalMimeType: draft.originalMimeType,
      originalSizeBytes: draft.originalSizeBytes,
      durationMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : "UNKNOWN_ERROR",
    });
    throw error;
  }
}
