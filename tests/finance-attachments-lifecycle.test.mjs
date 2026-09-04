import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("finance data is posted before attachment processing and protected from double submit", async () => {
  const ui = await read("app/finance-ui.tsx");
  const submit = ui.slice(ui.indexOf("async function submit(event: FormEvent<HTMLFormElement>)", ui.indexOf("export function FinanceOperationModal")));
  assert.ok(submit.indexOf('fetch("/api/finance"') < submit.indexOf("uploadFinanceAttachment({"));
  assert.ok(submit.indexOf("onSaved();") < submit.indexOf("uploadFinanceAttachment({"));
  assert.ok(submit.indexOf("onClose();") < submit.indexOf("uploadFinanceAttachment({"));
  assert.match(submit, /idempotencyKeyRef/);
  assert.match(submit, /submittingRef\.current/);
  assert.match(submit, /setLoading\(false\);\s*submittingRef\.current = false;\s*onSaved\(\);/);
  assert.doesNotMatch(submit, /await Promise\.allSettled/);
  assert.doesNotMatch(submit.slice(0, submit.indexOf('fetch("/api/finance"')), /arrayBuffer|heic2any|imageCompression|upload\(/);
});

test("operation can be created without attachments and supports multiple pending slots", async () => {
  const finance = await read("lib/finance.ts");
  assert.match(finance, /if \(value == null\) return \[\]/);
  assert.match(finance, /value\.length > 10/);
  assert.match(finance, /'FINANCIAL_TRANSACTION'.*'RECEIPT'.*'INTERNAL'.*'PENDING'/s);
  assert.match(finance, /statements\.push\(\.\.\.attachmentSlotStatements/);
  assert.match(finance, /id = idempotencyKey \|\| crypto\.randomUUID\(\)/);
});

test("failed upload changes only attachment state while the finance transaction survives", async () => {
  const finance = await read("lib/finance.ts");
  const failure = finance.slice(finance.indexOf("export async function markFinanceAttachmentFailed"), finance.indexOf("export async function updateFinanceOperation"));
  assert.match(failure, /UPDATE attachments SET upload_status='FAILED'/);
  assert.match(failure, /ATTACHMENT_UPLOAD_FAILED/);
  assert.doesNotMatch(failure, /UPDATE cashboxes|DELETE FROM financial_transactions|UPDATE financial_transactions|investment_movements/);
});

test("completed receipt is linked independently and audited without file contents", async () => {
  const [files, client, route] = await Promise.all([read("lib/files.ts"), read("lib/finance-attachments-client.ts"), read("app/api/finance/attachments/route.ts")]);
  assert.match(files, /transaction_id IS NOT NULL OR category='ADDITIONAL_WORK'.*'LINKED'/s);
  assert.match(files, /ATTACHMENT_ADDED/);
  assert.match(files, /transactionId: row\.transaction_id/);
  assert.match(client, /status: "UPLOADED"/);
  assert.match(route, /confirmFinanceAttachmentUpload/);
  assert.doesNotMatch(files, /content_base64/);
});

test("HEIC is converted and receipt images are compressed in a worker-friendly pipeline", async () => {
  const [client, config] = await Promise.all([read("lib/finance-attachments-client.ts"), read("next.config.ts")]);
  assert.match(client, /heic-to\/csp/);
  assert.doesNotMatch(client, /heic-to\/next/);
  assert.doesNotMatch(config, /unsafe-eval/);
  assert.match(client, /type: "image\/jpeg"/);
  assert.match(client, /maxWidthOrHeight: 1800/);
  assert.match(client, /maxSizeMB: 1\.1/);
  assert.match(client, /initialQuality: 0\.84/);
  assert.match(client, /useWebWorker: true/);
  assert.match(client, /FINANCE_HEIC_CONVERSION_TIMEOUT_MS = 45_000/);
  assert.match(client, /FINANCE_HEIC_FALLBACK_TIMEOUT_MS = 30_000/);
  assert.match(client, /FINANCE_IMAGE_COMPRESSION_TIMEOUT_MS = 30_000/);
  assert.match(client, /FINANCE_BLOB_UPLOAD_TIMEOUT_MS = 12_000/);
  assert.match(client, /abortSignal: input\.signal/);
  assert.match(client, /financePromiseWithTimeout/);
  assert.match(client, /Не удалось обработать HEIC за отведённое время/);
  assert.match(client, /originalSizeBytes: draft\.originalSizeBytes/);
  assert.match(client, /optimizedSizeBytes: optimized\.size/);
});

test("finance lifecycle emits safe timing stages and stale upload-first clients are rejected", async () => {
  const [ui, client, files] = await Promise.all([read("app/finance-ui.tsx"), read("lib/finance-attachments-client.ts"), read("lib/files.ts")]);
  for (const stage of ["submit_clicked", "form_validation_done", "transaction_create_request_started", "transaction_create_response_received", "transaction_id_obtained", "ui_success_state", "modal_closed", "attachment_background_started", "attachment_background_finished"]) assert.match(ui, new RegExp(stage));
  for (const stage of ["HEIC_DETECT", "HEIC_CONVERT_START", "HEIC_PRIMARY_SUCCESS", "HEIC_PRIMARY_FAILED", "HEIC_FALLBACK_START", "HEIC_FALLBACK_SUCCESS", "HEIC_FALLBACK_FAILED", "COMPRESS_SUCCESS", "COMPRESS_FAILED", "UPLOAD_START", "UPLOAD_SUCCESS", "DIRECT_BLOB_START", "DIRECT_BLOB_SUCCESS", "DIRECT_BLOB_FAILED", "SERVER_FALLBACK_STARTED", "SERVER_FALLBACK_SUCCESS", "SERVER_FALLBACK_FAILED", "LINK_SUCCESS", "LINK_FAILED"]) assert.match(client, new RegExp(stage));
  assert.match(files, /payload\.category === "RECEIPT" && payload\.entityType === "FINANCIAL_TRANSACTION" && !payload\.entityId/);
  assert.match(files, /Страница финансов устарела\. Обновите её и повторите создание операции\./);
});

test("existing operation card lists, opens, adds and retries attachments", async () => {
  const [ui, finance, route] = await Promise.all([read("app/finance-ui.tsx"), read("lib/finance.ts"), read("app/api/finance/attachments/route.ts")]);
  assert.match(ui, /ДОКУМЕНТЫ \/ ВЛОЖЕНИЯ/);
  assert.match(ui, /Добавить чек \/ фото/);
  assert.match(ui, /multiple accept=\{FINANCE_ATTACHMENT_ACCEPT\}/);
  assert.match(ui, /Не удалось обработать фото\. Операция сохранена без вложения\./);
  assert.match(ui, /Повторить/);
  assert.match(ui, /href=\{`\/api\/files\/\$\{attachment\.id\}`\}/);
  assert.match(ui, /createFinanceAttachmentDraft\(file, retryAttachment\?\.id\)/);
  assert.match(ui, /visibleFinanceAttachments/);
  assert.match(finance, /ATTACHMENT_UPLOAD_RETRY_QUEUED/);
  assert.match(finance, /attemptCount.*\+1/s);
  assert.match(route, /retryFinanceAttachmentSlot/);
});

test("HEIC detection accepts iPhone MIME variants, extension and ISO-BMFF signature", async () => {
  const [client, finance] = await Promise.all([read("lib/finance-attachments-client.ts"), read("lib/finance.ts")]);
  for (const mime of ["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"]) assert.match(client, new RegExp(mime));
  assert.match(client, /application\/octet-stream|originalMimeType/);
  assert.match(client, /String\.fromCharCode.*ftyp/s);
  assert.match(client, /HEIC_BRANDS/);
  assert.match(finance, /detectedMimeType/);
});

test("failure diagnostics are persisted without a schema migration", async () => {
  const [client, finance] = await Promise.all([read("lib/finance-attachments-client.ts"), read("lib/finance.ts")]);
  for (const code of ["UNSUPPORTED_FILE_TYPE", "HEIC_DECODE_FAILED", "HEIC_WORKER_FAILED", "HEIC_WORKER_TIMEOUT", "IMAGE_COMPRESSION_FAILED", "UPLOAD_TOKEN_FAILED", "BLOB_UPLOAD_FAILED", "DIRECT_BLOB_TIMEOUT", "DIRECT_BLOB_NETWORK_FAILED", "DIRECT_BLOB_CORS_FAILED", "DIRECT_BLOB_ABORTED", "SERVER_FALLBACK_STARTED", "SERVER_FALLBACK_FAILED", "SERVER_FALLBACK_PAYLOAD_TOO_LARGE", "SERVER_BLOB_UPLOAD_FAILED", "SERVER_BLOB_CONFIRMATION_FAILED", "LINK_CONFIRMATION_FAILED", "PROCESS_TIMEOUT"]) {
    assert.match(client, new RegExp(code));
    assert.match(finance, new RegExp(code));
  }
  assert.match(finance, /lastFailureCode/);
  assert.match(finance, /lastFailureAt/);
  assert.match(finance, /processingEvents/);
  assert.match(finance, /metadata_json=metadata_json \|\|/);
});

test("server fallback is finance-only, bounded, canonical, and HEAD-confirmed before LINKED", async () => {
  const [files, route, client, finance] = await Promise.all([
    read("lib/files.ts"),
    read("app/api/finance/attachments/fallback/route.ts"),
    read("lib/finance-attachments-client.ts"),
    read("lib/finance.ts"),
  ]);
  assert.match(route, /getRequestUser/);
  assert.match(route, /uploadFinanceAttachmentFallback/);
  assert.match(route, /runtime = "nodejs"/);
  assert.match(files, /FINANCE_SERVER_FALLBACK_MAX_BYTES = 2 \* 1024 \* 1024/);
  assert.match(files, /row\.transaction_id !== transactionId/);
  assert.match(files, /row\.entity_id !== transactionId/);
  assert.match(files, /row\.category !== "RECEIPT"/);
  assert.match(files, /row\.storage_key !== attachmentPath/);
  assert.match(files, /metadata_json\?\.uploadAttemptId !== uploadAttemptId/);
  assert.match(files, /row\.uploaded_by_user_id !== actor\.id && actor\.role !== "OWNER"/);
  assert.match(files, /confirmedBlobHead[\s\S]*finalizeAttachmentMetadata/);
  assert.match(files, /addRandomSuffix: false/);
  assert.match(client, /\/api\/finance\/attachments\/fallback/);
  assert.match(client, /pathUsed: "DIRECT" \| "SERVER_FALLBACK"/);
  assert.match(finance, /uploadAttemptId/);
});

test("missing receipt detector resolves only after a linked upload", async () => {
  const finance = await read("lib/finance.ts");
  assert.match(finance, /receiptIssueApplies && attachmentCount === 0/);
  assert.match(finance, /deriveFinanceAttentionStatus/);
  assert.match(finance, /a\.upload_status='LINKED'.*AS attachment_count/s);
});
