import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";
import { retryFinanceAttachmentSlot } from "../../lib/finance.ts";
import { uploadFinanceAttachmentFallback } from "../../lib/files.ts";

assert.equal(process.env.NODE_ENV, "test");
const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl);
assert.match(new URL(databaseUrl).pathname.slice(1), /^depa_os_test(?:_|$)/);

const db = new pg.Pool({ connectionString: databaseUrl });
const q = (text, params = []) => db.query(text, params);
const ids = {
  employee: "10000000-0000-4000-8000-000000000001",
  owner: "10000000-0000-4000-8000-000000000002",
  cashbox: "10000000-0000-4000-8000-000000000003",
  transaction: "10000000-0000-4000-8000-000000000004",
  direct: "10000000-0000-4000-8000-000000000005",
  retry: "10000000-0000-4000-8000-000000000006",
  race: "10000000-0000-4000-8000-000000000007",
  attemptDirect: "20000000-0000-4000-8000-000000000001",
  attemptOld: "20000000-0000-4000-8000-000000000002",
  attemptRetry: "20000000-0000-4000-8000-000000000003",
  attemptRace: "20000000-0000-4000-8000-000000000004",
};
const actor = { id: ids.owner, employeeId: ids.employee, name: "Fallback E2E Owner", username: "fallback-e2e", role: "OWNER", isProtectedOwner: false };
const now = Math.floor(Date.now() / 1000);
const fileBytes = new Uint8Array([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 255, 217]);
const file = new File([fileBytes], "receipt.jpg", { type: "image/jpeg" });
const checksumSha256 = crypto.createHash("sha256").update(fileBytes).digest("hex");

function blobResult(pathname) {
  return { pathname, url: `https://test.private.blob.vercel-storage.com/${pathname}`, downloadUrl: `https://test.private.blob.vercel-storage.com/${pathname}?download=1`, contentType: "image/jpeg", contentDisposition: "inline", cacheControl: "public, max-age=60", size: file.size, uploadedAt: new Date(), etag: checksumSha256.slice(0, 32) };
}

function memoryBlobHooks(delayMs = 0) {
  const blobs = new Map();
  const putKeys = [];
  let headCalls = 0;
  return {
    blobs, putKeys,
    get headCalls() { return headCalls; },
    hooks: {
      headBlob: async (pathname) => {
        headCalls += 1;
        const result = blobs.get(pathname);
        if (!result) throw Object.assign(new Error("not found"), { code: "not_found" });
        return result;
      },
      putBlob: async (pathname) => {
        putKeys.push(pathname);
        if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
        if (blobs.has(pathname)) throw Object.assign(new Error("already exists"), { code: "already_exists" });
        const result = blobResult(pathname);
        blobs.set(pathname, result);
        return result;
      },
    },
  };
}

async function fingerprint() {
  const result = await q(`SELECT
    (SELECT md5(COALESCE(string_agg(row_to_json(t)::text,'|' ORDER BY t.id),'')) FROM financial_transactions t) transactions,
    (SELECT md5(COALESCE(string_agg(row_to_json(c)::text,'|' ORDER BY c.id),'')) FROM cashboxes c) cashboxes,
    (SELECT md5(COALESCE(string_agg(row_to_json(i)::text,'|' ORDER BY i.id),'')) FROM investment_accounts i) investments,
    (SELECT md5(COALESCE(string_agg(row_to_json(m)::text,'|' ORDER BY m.id),'')) FROM investment_movements m) movements`);
  return result.rows[0];
}

async function insertAttachment(id, uploadAttemptId, status = "PENDING") {
  await q("INSERT INTO attachments(id,transaction_id,storage_provider,storage_key,blob_url,original_filename,mime_type,size_bytes,checksum_sha256,uploaded_by_user_id,entity_type,entity_id,category,visibility,upload_status,metadata_json,created_at,updated_at) VALUES($1,$2,'VERCEL_BLOB',$3,NULL,'receipt.jpg','image/jpeg',0,NULL,$4,'FINANCIAL_TRANSACTION',$2,'RECEIPT','INTERNAL',$5,$6::jsonb,$7,$7)", [id, ids.transaction, `depa-os/receipt/${id}.jpg`, ids.owner, status, JSON.stringify({ attemptCount: 1, uploadAttemptId }), now]);
}

try {
  await q("INSERT INTO employees(id,full_name,status,created_at,updated_at) VALUES($1,'Fallback E2E Owner','ACTIVE',$2,$2)", [ids.employee, now]);
  await q("INSERT INTO users(id,employee_id,auth_provider,username,username_normalized,display_name,role,status,is_protected_owner,created_at,updated_at) VALUES($1,$2,'LOCAL','fallback-e2e','fallback-e2e','Fallback E2E Owner','OWNER','ACTIVE',0,$3,$3)", [ids.owner, ids.employee, now]);
  await q("INSERT INTO cashboxes(id,owner_user_id,owner_employee_id,name,type,currency,is_active,status,balance_kopecks,opening_balance_kopecks,created_at,updated_at) VALUES($1,$2,$3,'Fallback E2E Cashbox','PERSONAL','RUB',1,'ACTIVE',500000,500000,$4,$4)", [ids.cashbox, ids.owner, ids.employee, now]);
  await q("INSERT INTO financial_transactions(id,amount_kopecks,transaction_date,type,expense_type,author_user_id,cashbox_id,category,title,show_to_client,created_at,updated_at) VALUES($1,100000,$2,'EXPENSE','ADMIN',$3,$4,'TEST','Fallback E2E expense',0,$2,$2)", [ids.transaction, now, ids.owner, ids.cashbox]);
  const before = await fingerprint();

  await insertAttachment(ids.direct, ids.attemptDirect);
  const directStore = memoryBlobHooks();
  const direct = await uploadFinanceAttachmentFallback(actor, { attachmentId: ids.direct, transactionId: ids.transaction, uploadAttemptId: ids.attemptDirect, checksumSha256 }, file, directStore.hooks);
  assert.equal(direct.status, "LINKED");
  assert.equal(directStore.putKeys.length, 1);
  assert.ok(directStore.headCalls >= 2);
  const idempotent = await uploadFinanceAttachmentFallback(actor, { attachmentId: ids.direct, transactionId: ids.transaction, uploadAttemptId: ids.attemptDirect, checksumSha256 }, file, directStore.hooks);
  assert.equal(idempotent.idempotent, true);
  assert.equal(directStore.putKeys.length, 1);

  await insertAttachment(ids.retry, ids.attemptOld, "FAILED");
  await retryFinanceAttachmentSlot(actor, { transactionId: ids.transaction, retryAttachmentId: ids.retry, attachments: [{ attachmentId: ids.retry, uploadAttemptId: ids.attemptRetry, originalFilename: "receipt.jpg", originalMimeType: "image/jpeg", detectedMimeType: "image/jpeg", originalSizeBytes: file.size, mimeType: "image/jpeg" }] });
  const retryStore = memoryBlobHooks();
  const retried = await uploadFinanceAttachmentFallback(actor, { attachmentId: ids.retry, transactionId: ids.transaction, uploadAttemptId: ids.attemptRetry, checksumSha256 }, file, retryStore.hooks);
  assert.equal(retried.status, "LINKED");
  const retryRow = (await q("SELECT upload_status,metadata_json FROM attachments WHERE id=$1", [ids.retry])).rows[0];
  assert.equal(retryRow.upload_status, "LINKED");
  assert.equal(Number(retryRow.metadata_json.attemptCount), 2);
  assert.equal(retryRow.metadata_json.uploadAttemptId, ids.attemptRetry);

  await insertAttachment(ids.race, ids.attemptRace);
  const raceStore = memoryBlobHooks(15);
  const raceInput = { attachmentId: ids.race, transactionId: ids.transaction, uploadAttemptId: ids.attemptRace, checksumSha256 };
  const raceResults = await Promise.all([uploadFinanceAttachmentFallback(actor, raceInput, file, raceStore.hooks), uploadFinanceAttachmentFallback(actor, raceInput, file, raceStore.hooks)]);
  assert.ok(raceResults.every((result) => result.status === "LINKED"));
  assert.deepEqual(new Set(raceStore.putKeys), new Set([`depa-os/receipt/${ids.race}.jpg`]));
  assert.equal((await q("SELECT COUNT(*)::int count FROM attachments WHERE id=$1", [ids.race])).rows[0].count, 1);
  assert.equal((await q("SELECT COUNT(*)::int count FROM audit_logs WHERE entity_id=$1 AND action='ATTACHMENT_ADDED'", [ids.race])).rows[0].count, 1);

  const after = await fingerprint();
  assert.deepEqual(after, before);
  console.log(JSON.stringify({ ok: true, direct: direct.status, idempotent: idempotent.idempotent, retry: retried.status, attemptCount: retryRow.metadata_json.attemptCount, race: raceResults.map((result) => result.status), sameCanonicalKey: true, financialFingerprintUnchanged: true }));
} finally {
  await db.end();
}
