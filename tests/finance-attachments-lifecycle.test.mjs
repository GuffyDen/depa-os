import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("finance data is posted before attachment processing and protected from double submit", async () => {
  const ui = await read("app/finance-ui.tsx");
  const submit = ui.slice(ui.indexOf("async function submit(event: FormEvent<HTMLFormElement>)", ui.indexOf("export function FinanceOperationModal")));
  assert.ok(submit.indexOf('fetch("/api/finance"') < submit.indexOf("uploadFinanceAttachment({"));
  assert.match(submit, /idempotencyKeyRef/);
  assert.match(submit, /submittingRef\.current/);
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
  const client = await read("lib/finance-attachments-client.ts");
  assert.match(client, /heic-to\/next/);
  assert.match(client, /type: "image\/jpeg"/);
  assert.match(client, /maxWidthOrHeight: 1800/);
  assert.match(client, /maxSizeMB: 1\.1/);
  assert.match(client, /initialQuality: 0\.84/);
  assert.match(client, /useWebWorker: true/);
  assert.match(client, /originalSizeBytes: draft\.originalSizeBytes/);
  assert.match(client, /optimizedSizeBytes: optimized\.size/);
});

test("existing operation card lists, opens, adds and retries attachments", async () => {
  const ui = await read("app/finance-ui.tsx");
  assert.match(ui, /ДОКУМЕНТЫ \/ ВЛОЖЕНИЯ/);
  assert.match(ui, /Добавить чек \/ фото/);
  assert.match(ui, /multiple accept=\{FINANCE_ATTACHMENT_ACCEPT\}/);
  assert.match(ui, /Не удалось загрузить файл/);
  assert.match(ui, /Повторить/);
  assert.match(ui, /href=\{`\/api\/files\/\$\{attachment\.id\}`\}/);
});

test("missing receipt alert still disappears only after a linked upload", async () => {
  const finance = await read("lib/finance.ts");
  assert.match(finance, /categoryRequiresReceipt\(item\.category\) && item\.attachmentCount === 0/);
  assert.match(finance, /a\.upload_status='LINKED'.*AS attachment_count/s);
});
