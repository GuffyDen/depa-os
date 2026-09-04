export const FINANCE_ATTACHMENT_ACCEPT = ".jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,image/heic-sequence,image/heif-sequence,application/pdf";
export const FINANCE_ATTACHMENT_MAX_ORIGINAL_BYTES = 25 * 1024 * 1024;
export const FINANCE_HEIC_CONVERSION_TIMEOUT_MS = 45_000;
export const FINANCE_HEIC_FALLBACK_TIMEOUT_MS = 30_000;
export const FINANCE_IMAGE_COMPRESSION_TIMEOUT_MS = 30_000;
export const FINANCE_BLOB_UPLOAD_TIMEOUT_MS = 90_000;
export const FINANCE_ATTACHMENT_CONFIRM_TIMEOUT_MS = 10_000;

const HEIC_MIME_TYPES = new Set(["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"]);
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"]);

export type FinanceAttachmentFailureCode =
  | "UNSUPPORTED_FILE_TYPE"
  | "HEIC_DECODE_FAILED"
  | "HEIC_WORKER_FAILED"
  | "HEIC_WORKER_TIMEOUT"
  | "IMAGE_COMPRESSION_FAILED"
  | "UPLOAD_TOKEN_FAILED"
  | "BLOB_UPLOAD_FAILED"
  | "LINK_CONFIRMATION_FAILED"
  | "PROCESS_TIMEOUT";

export type FinanceAttachmentDraft = {
  attachmentId: string;
  originalFilename: string;
  originalMimeType: string;
  detectedMimeType: "image/jpeg" | "image/png" | "image/webp" | "image/heic" | "image/heif" | "application/pdf";
  originalSizeBytes: number;
  mimeType: "image/jpeg" | "application/pdf";
};

export type FinanceAttachmentTelemetryEvent = {
  event: string;
  atMs: number;
  durationMs?: number;
  sizeBytes?: number;
  failureCode?: FinanceAttachmentFailureCode;
  converter?: "heic-to-csp-worker" | "browser-native" | "browser-image-compression-worker" | "browser-image-compression-main";
};

type UploadPhase = "preparing" | "uploading" | "ready" | "failed";
type LifecycleDetail = string | number | boolean | null | undefined;

export class FinanceAttachmentPipelineError extends Error {
  constructor(message: string, readonly code: FinanceAttachmentFailureCode, readonly stage: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "FinanceAttachmentPipelineError";
  }
}

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

async function pipelineTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string, code: FinanceAttachmentFailureCode, stage: string) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timeoutId = setTimeout(() => reject(new FinanceAttachmentPipelineError(message, code, stage)), timeoutMs); }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function extensionOf(filename: string) {
  return filename.split(".").pop()?.toLocaleLowerCase("en-US") ?? "";
}

function hasHeicSignature(bytes: Uint8Array) {
  if (bytes.length < 12 || String.fromCharCode(...bytes.slice(4, 8)) !== "ftyp") return false;
  for (let offset = 8; offset + 4 <= bytes.length; offset += 4) {
    if (HEIC_BRANDS.has(String.fromCharCode(...bytes.slice(offset, offset + 4)))) return true;
  }
  return false;
}

async function detectsHeic(file: File, declaredMimeType: string, extension: string) {
  if (HEIC_MIME_TYPES.has(declaredMimeType) || extension === "heic" || extension === "heif") return true;
  try {
    const header = new Uint8Array(await financePromiseWithTimeout(file.slice(0, 64).arrayBuffer(), 3_000, "Не удалось прочитать заголовок файла."));
    return hasHeicSignature(header);
  } catch { return false; }
}

export async function createFinanceAttachmentDraft(file: File, attachmentId = crypto.randomUUID()): Promise<FinanceAttachmentDraft> {
  const originalMimeType = file.type.trim().toLocaleLowerCase("en-US");
  const extension = extensionOf(file.name);
  const isHeic = await detectsHeic(file, originalMimeType, extension);
  const detectedMimeType = isHeic
    ? (extension === "heif" || originalMimeType.includes("heif") ? "image/heif" : "image/heic")
    : originalMimeType === "image/jpeg" || ["jpg", "jpeg"].includes(extension) ? "image/jpeg"
      : originalMimeType === "image/png" || extension === "png" ? "image/png"
        : originalMimeType === "image/webp" || extension === "webp" ? "image/webp"
          : originalMimeType === "application/pdf" || extension === "pdf" ? "application/pdf"
            : null;
  if (!detectedMimeType) throw new FinanceAttachmentPipelineError("Разрешены PDF, JPG, PNG, WebP и HEIC/HEIF.", "UNSUPPORTED_FILE_TYPE", "FILE_SELECTION");
  const maximumBytes = detectedMimeType === "application/pdf" ? 10 * 1024 * 1024 : FINANCE_ATTACHMENT_MAX_ORIGINAL_BYTES;
  if (file.size <= 0 || file.size > maximumBytes) {
    throw new FinanceAttachmentPipelineError(detectedMimeType === "application/pdf" ? "PDF должен быть не больше 10 МБ." : "Каждое исходное изображение должно быть не больше 25 МБ.", "UNSUPPORTED_FILE_TYPE", "FILE_SELECTION");
  }
  return { attachmentId, originalFilename: file.name, originalMimeType, detectedMimeType, originalSizeBytes: file.size, mimeType: detectedMimeType === "application/pdf" ? "application/pdf" : "image/jpeg" };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Canvas did not create an image.")), type, quality));
}

async function browserNativeHeicToJpeg(file: File) {
  let width = 0;
  let height = 0;
  let draw: ((context: CanvasRenderingContext2D) => void) | undefined;
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      width = bitmap.width; height = bitmap.height;
      draw = (context) => { context.drawImage(bitmap, 0, 0); bitmap.close(); };
    } catch { /* Safari can still decode the same file through HTMLImageElement. */ }
  }
  if (!draw) {
    const url = URL.createObjectURL(file);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error("Browser cannot decode this HEIC image."));
        element.src = url;
      });
      width = image.naturalWidth; height = image.naturalHeight;
      draw = (context) => context.drawImage(image, 0, 0);
    } finally { URL.revokeObjectURL(url); }
  }
  if (!width || !height) throw new Error("Decoded image has invalid dimensions.");
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable.");
  draw(context);
  try { return await canvasToBlob(canvas, "image/jpeg", 0.92); }
  finally { canvas.width = 1; canvas.height = 1; }
}

function failureCodeFromHeicError(error: unknown): FinanceAttachmentFailureCode {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? "");
  return /worker|security|content security|unsafe-eval|offscreen/i.test(message) ? "HEIC_WORKER_FAILED" : "HEIC_DECODE_FAILED";
}

function failureCodeFromUploadError(error: unknown): FinanceAttachmentFailureCode {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /token|unauthor|forbidden|handleUploadUrl/i.test(message) ? "UPLOAD_TOKEN_FAILED" : "BLOB_UPLOAD_FAILED";
}

function pipelineError(error: unknown, fallbackCode: FinanceAttachmentFailureCode, stage: string, message: string) {
  return error instanceof FinanceAttachmentPipelineError ? error : new FinanceAttachmentPipelineError(message, fallbackCode, stage, { cause: error });
}

function emitTelemetry(events: FinanceAttachmentTelemetryEvent[], startedAt: number, event: string, details: Omit<FinanceAttachmentTelemetryEvent, "event" | "atMs">, context: Record<string, LifecycleDetail>) {
  const item = { event, atMs: Math.round(performance.now() - startedAt), ...details };
  events.push(item);
  logFinanceLifecycle(event, { ...context, ...details });
}

export async function prepareFinanceAttachmentFile(
  file: File,
  draft: FinanceAttachmentDraft,
  traceId = crypto.randomUUID(),
  hooks: { primaryHeicConverter?: (file: File) => Promise<Blob>; fallbackHeicConverter?: (file: File) => Promise<Blob> } = {},
) {
  const startedAt = performance.now();
  const telemetry: FinanceAttachmentTelemetryEvent[] = [];
  const context = { traceId, attachmentId: draft.attachmentId, format: draft.detectedMimeType };
  emitTelemetry(telemetry, startedAt, "HEIC_DETECT", {}, context);
  if (draft.mimeType === "application/pdf") return { file, telemetry, conversionApplied: false, conversionMs: 0, compressionMs: 0 };
  let source = file;
  let conversionMs = 0;
  if (draft.detectedMimeType === "image/heic" || draft.detectedMimeType === "image/heif") {
    const primaryStartedAt = performance.now();
    emitTelemetry(telemetry, startedAt, "HEIC_CONVERT_START", { converter: "heic-to-csp-worker" }, context);
    try {
      const converted = await pipelineTimeout((async () => {
        if (hooks.primaryHeicConverter) return hooks.primaryHeicConverter(file);
        const { heicTo } = await import("heic-to/csp");
        return heicTo({ blob: file, type: "image/jpeg", quality: 0.92 });
      })(), FINANCE_HEIC_CONVERSION_TIMEOUT_MS, "Не удалось обработать HEIC за отведённое время.", "HEIC_WORKER_TIMEOUT", "HEIC_PRIMARY");
      conversionMs = Math.round(performance.now() - primaryStartedAt);
      emitTelemetry(telemetry, startedAt, "HEIC_PRIMARY_SUCCESS", { durationMs: conversionMs, sizeBytes: converted.size, converter: "heic-to-csp-worker" }, context);
      source = new File([converted], `${file.name.replace(/\.(heic|heif)$/iu, "")}.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
    } catch (primaryError) {
      const primaryFailure = primaryError instanceof FinanceAttachmentPipelineError && primaryError.code === "HEIC_WORKER_TIMEOUT" ? primaryError : pipelineError(primaryError, failureCodeFromHeicError(primaryError), "HEIC_PRIMARY", "Основной HEIC-конвертер не смог обработать файл.");
      emitTelemetry(telemetry, startedAt, "HEIC_PRIMARY_FAILED", { durationMs: Math.round(performance.now() - primaryStartedAt), failureCode: primaryFailure.code, converter: "heic-to-csp-worker" }, context);
      const fallbackStartedAt = performance.now();
      emitTelemetry(telemetry, startedAt, "HEIC_FALLBACK_START", { converter: "browser-native" }, context);
      try {
        const converted = await pipelineTimeout(hooks.fallbackHeicConverter ? hooks.fallbackHeicConverter(file) : browserNativeHeicToJpeg(file), FINANCE_HEIC_FALLBACK_TIMEOUT_MS, "Резервная обработка HEIC не завершилась вовремя.", "PROCESS_TIMEOUT", "HEIC_FALLBACK");
        conversionMs = Math.round(performance.now() - primaryStartedAt);
        emitTelemetry(telemetry, startedAt, "HEIC_FALLBACK_SUCCESS", { durationMs: Math.round(performance.now() - fallbackStartedAt), sizeBytes: converted.size, converter: "browser-native" }, context);
        source = new File([converted], `${file.name.replace(/\.(heic|heif)$/iu, "")}.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
      } catch (fallbackError) {
        const failure = pipelineError(fallbackError, "HEIC_DECODE_FAILED", "HEIC_FALLBACK", "Не удалось обработать HEIC основным и резервным способом.");
        emitTelemetry(telemetry, startedAt, "HEIC_FALLBACK_FAILED", { durationMs: Math.round(performance.now() - fallbackStartedAt), failureCode: failure.code, converter: "browser-native" }, context);
        throw Object.assign(failure, { telemetry });
      }
    }
  }
  const compressionStartedAt = performance.now();
  let optimized: File;
  try {
    const { default: imageCompression } = await import("browser-image-compression");
    try {
      optimized = await pipelineTimeout(imageCompression(source, { maxSizeMB: 1.1, maxWidthOrHeight: 1800, initialQuality: 0.84, fileType: "image/jpeg", useWebWorker: true, preserveExif: false }), FINANCE_IMAGE_COMPRESSION_TIMEOUT_MS, "Не удалось сжать изображение за отведённое время.", "PROCESS_TIMEOUT", "IMAGE_COMPRESSION");
      emitTelemetry(telemetry, startedAt, "COMPRESS_SUCCESS", { durationMs: Math.round(performance.now() - compressionStartedAt), sizeBytes: optimized.size, converter: "browser-image-compression-worker" }, context);
    } catch (workerError) {
      logFinanceLifecycle("COMPRESS_WORKER_FAILED", { ...context, failureCode: workerError instanceof FinanceAttachmentPipelineError ? workerError.code : "IMAGE_COMPRESSION_FAILED" });
      optimized = await pipelineTimeout(imageCompression(source, { maxSizeMB: 1.1, maxWidthOrHeight: 1800, initialQuality: 0.84, fileType: "image/jpeg", useWebWorker: false, preserveExif: false }), FINANCE_IMAGE_COMPRESSION_TIMEOUT_MS, "Не удалось сжать изображение.", "IMAGE_COMPRESSION_FAILED", "IMAGE_COMPRESSION");
      emitTelemetry(telemetry, startedAt, "COMPRESS_SUCCESS", { durationMs: Math.round(performance.now() - compressionStartedAt), sizeBytes: optimized.size, converter: "browser-image-compression-main" }, context);
    }
  } catch (error) {
    const failure = pipelineError(error, "IMAGE_COMPRESSION_FAILED", "IMAGE_COMPRESSION", "Не удалось подготовить изображение.");
    emitTelemetry(telemetry, startedAt, "COMPRESS_FAILED", { durationMs: Math.round(performance.now() - compressionStartedAt), failureCode: failure.code }, context);
    throw Object.assign(failure, { telemetry });
  }
  return { file: optimized, telemetry, conversionApplied: source !== file, conversionMs, compressionMs: Math.round(performance.now() - compressionStartedAt) };
}

async function sha256(file: File) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function uploadFinanceAttachment({ file, draft, transactionId, projectId, onPhase, traceId = crypto.randomUUID(), prepareHooks }: {
  file: File;
  draft: FinanceAttachmentDraft;
  transactionId: string;
  projectId: string | null;
  onPhase?: (phase: UploadPhase) => void;
  traceId?: string;
  prepareHooks?: Parameters<typeof prepareFinanceAttachmentFile>[3];
}) {
  const startedAt = performance.now();
  let telemetry: FinanceAttachmentTelemetryEvent[] = [];
  const context = { traceId, attachmentId: draft.attachmentId, transactionId, format: draft.detectedMimeType };
  try {
    onPhase?.("preparing");
    logFinanceLifecycle("ATTACHMENT_PREPROCESSING_START", { ...context, originalMimeType: draft.originalMimeType || "EMPTY", originalSizeBytes: draft.originalSizeBytes });
    const prepared = await prepareFinanceAttachmentFile(file, draft, traceId, prepareHooks);
    telemetry = prepared.telemetry;
    const optimized = prepared.file;
    const preparationMs = Math.round(performance.now() - startedAt);
    const checksumSha256 = await sha256(optimized);
    onPhase?.("uploading");
    emitTelemetry(telemetry, startedAt, "UPLOAD_START", { sizeBytes: optimized.size }, context);
    try {
      const { upload } = await import("@vercel/blob/client");
      await pipelineTimeout(upload(`depa-os/receipt/${draft.attachmentId}.${draft.mimeType === "application/pdf" ? "pdf" : "jpg"}`, optimized, {
        access: "private",
        handleUploadUrl: "/api/files/upload",
        contentType: draft.mimeType,
        multipart: optimized.size > 5 * 1024 * 1024,
        clientPayload: JSON.stringify({ attachmentId: draft.attachmentId, originalFilename: draft.originalFilename, mimeType: draft.mimeType, sizeBytes: optimized.size, checksumSha256, category: "RECEIPT", visibility: "INTERNAL", entityType: "FINANCIAL_TRANSACTION", entityId: transactionId, projectId }),
      }), FINANCE_BLOB_UPLOAD_TIMEOUT_MS, "Загрузка файла не завершилась за отведённое время.", "BLOB_UPLOAD_FAILED", "BLOB_UPLOAD");
      emitTelemetry(telemetry, startedAt, "UPLOAD_SUCCESS", { durationMs: Math.round(performance.now() - startedAt) - preparationMs, sizeBytes: optimized.size }, context);
    } catch (error) {
      const failure = pipelineError(error, failureCodeFromUploadError(error), "BLOB_UPLOAD", "Не удалось загрузить подготовленный файл.");
      emitTelemetry(telemetry, startedAt, "UPLOAD_FAILED", { failureCode: failure.code }, context);
      throw failure;
    }
    let confirmed = false;
    for (let attempt = 0; attempt < 3 && !confirmed; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, attempt * 300));
      const response = await pipelineTimeout(fetch("/api/finance/attachments", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ attachmentId: draft.attachmentId, status: "UPLOADED", telemetry, processing: { conversionApplied: prepared.conversionApplied, conversionMs: prepared.conversionMs, compressionMs: prepared.compressionMs, storedMimeType: draft.mimeType, storedSizeBytes: optimized.size } }) }), FINANCE_ATTACHMENT_CONFIRM_TIMEOUT_MS, "Подтверждение загрузки не завершилось за отведённое время.", "LINK_CONFIRMATION_FAILED", "LINK_CONFIRMATION");
      if (response.ok) confirmed = true;
      else if (response.status !== 409 || attempt === 2) {
        const result = await response.json().catch(() => ({})) as { error?: string };
        throw new FinanceAttachmentPipelineError(result.error ?? "Не удалось подтвердить загрузку файла.", "LINK_CONFIRMATION_FAILED", "LINK_CONFIRMATION");
      }
    }
    if (!confirmed) throw new FinanceAttachmentPipelineError("Не удалось подтвердить загрузку файла.", "LINK_CONFIRMATION_FAILED", "LINK_CONFIRMATION");
    emitTelemetry(telemetry, startedAt, "LINK_SUCCESS", {}, context);
    onPhase?.("ready");
    console.info("FINANCE_ATTACHMENT_UPLOAD_SUCCESS", { attachmentId: draft.attachmentId, transactionId, originalMimeType: draft.originalMimeType || "EMPTY", originalSizeBytes: draft.originalSizeBytes, optimizedSizeBytes: optimized.size, totalMs: Math.round(performance.now() - startedAt) });
    return { originalSizeBytes: draft.originalSizeBytes, optimizedSizeBytes: optimized.size, telemetry };
  } catch (error) {
    const failure = pipelineError(error, "PROCESS_TIMEOUT", "UNKNOWN", "Не удалось обработать фото.");
    const inheritedTelemetry = (error as { telemetry?: FinanceAttachmentTelemetryEvent[] } | null)?.telemetry;
    if (inheritedTelemetry) telemetry = inheritedTelemetry;
    if (failure.stage === "LINK_CONFIRMATION") emitTelemetry(telemetry, startedAt, "LINK_FAILED", { failureCode: failure.code }, context);
    onPhase?.("failed");
    await financePromiseWithTimeout(fetch("/api/finance/attachments", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ attachmentId: draft.attachmentId, status: "FAILED", failureCode: failure.code, failureStage: failure.stage, telemetry }) }), FINANCE_ATTACHMENT_CONFIRM_TIMEOUT_MS, "Не удалось сохранить статус ошибки вложения.").catch(() => undefined);
    logFinanceLifecycle("ATTACHMENT_FAILED", { ...context, durationMs: Math.round(performance.now() - startedAt), failureCode: failure.code, failureStage: failure.stage });
    console.error("FINANCE_ATTACHMENT_UPLOAD_FAILURE", { attachmentId: draft.attachmentId, transactionId, originalMimeType: draft.originalMimeType || "EMPTY", originalSizeBytes: draft.originalSizeBytes, durationMs: Math.round(performance.now() - startedAt), failureCode: failure.code, failureStage: failure.stage });
    throw failure;
  }
}
