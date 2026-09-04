export const FINANCE_ATTACHMENT_ACCEPT = ".jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf";
export const FINANCE_ATTACHMENT_MAX_ORIGINAL_BYTES = 25 * 1024 * 1024;

export type FinanceAttachmentDraft = {
  attachmentId: string;
  originalFilename: string;
  originalMimeType: string;
  originalSizeBytes: number;
  mimeType: "image/jpeg" | "application/pdf";
};

type UploadPhase = "preparing" | "uploading" | "ready" | "failed";

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

export async function prepareFinanceAttachmentFile(file: File, draft: FinanceAttachmentDraft) {
  if (draft.mimeType === "application/pdf") return file;
  let source = file;
  if (draft.originalMimeType === "image/heic" || draft.originalMimeType === "image/heif") {
    const { heicTo } = await import("heic-to/next");
    const blob = await heicTo({ blob: file, type: "image/jpeg", quality: 0.92 });
    source = new File([blob], `${file.name.replace(/\.(heic|heif)$/iu, "")}.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
  }
  const { default: imageCompression } = await import("browser-image-compression");
  return imageCompression(source, {
    maxSizeMB: 1.1,
    maxWidthOrHeight: 1800,
    initialQuality: 0.84,
    fileType: "image/jpeg",
    useWebWorker: true,
    preserveExif: false,
  });
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
}: {
  file: File;
  draft: FinanceAttachmentDraft;
  transactionId: string;
  projectId: string | null;
  onPhase?: (phase: UploadPhase) => void;
}) {
  const startedAt = performance.now();
  try {
    onPhase?.("preparing");
    const optimized = await prepareFinanceAttachmentFile(file, draft);
    const preparationMs = Math.round(performance.now() - startedAt);
    const checksumSha256 = await sha256(optimized);
    onPhase?.("uploading");
    const { upload } = await import("@vercel/blob/client");
    await upload(`depa-os/receipt/${draft.attachmentId}.${draft.mimeType === "application/pdf" ? "pdf" : "jpg"}`, optimized, {
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
    });
    let confirmed = false;
    for (let attempt = 0; attempt < 3 && !confirmed; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, attempt * 300));
      const response = await fetch("/api/finance/attachments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attachmentId: draft.attachmentId, status: "UPLOADED" }),
      });
      if (response.ok) confirmed = true;
      else if (response.status !== 409 || attempt === 2) {
        const result = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(result.error ?? "Не удалось подтвердить загрузку файла.");
      }
    }
    if (!confirmed) throw new Error("Не удалось подтвердить загрузку файла.");
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
    await fetch("/api/finance/attachments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attachmentId: draft.attachmentId, status: "FAILED" }),
    }).catch(() => undefined);
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
