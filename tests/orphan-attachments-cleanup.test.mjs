import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ORPHAN_ATTACHMENT_AUDIT_ACTION,
  ORPHAN_ATTACHMENT_TTL_SECONDS,
  runOrphanAttachmentCleanup,
} from "../lib/orphan-attachments-cleanup.ts";

const NOW = 2_000_000;
const old = (overrides = {}) => ({
  id: crypto.randomUUID(),
  original_filename: "receipt.heic",
  storage_key: `depa-os/receipt/${crypto.randomUUID()}.heic`,
  created_at: NOW - ORPHAN_ATTACHMENT_TTL_SECONDS - 1,
  upload_status: "PENDING",
  uploaded_by_user_id: "user-1",
  transaction_id: null,
  entity_id: null,
  blob_url: null,
  completed_at: null,
  linked_at: null,
  ...overrides,
});

function eligible(row, cutoff) {
  return row.created_at < cutoff
    && row.upload_status === "PENDING"
    && row.transaction_id == null
    && row.entity_id == null
    && row.blob_url == null
    && row.completed_at == null
    && row.linked_at == null;
}

function fakeDependencies(rows, { blobs = new Set(), disappearAfterChecks = new Map() } = {}) {
  const deleted = [];
  const audits = [];
  const checks = new Map();
  let requestedLimit = null;
  return {
    deleted,
    audits,
    get requestedLimit() { return requestedLimit; },
    dependencies: {
      async runSession(_dryRun, callback) {
        const session = {
          async loadCandidates(cutoff, batchSize) {
            requestedLimit = batchSize;
            return rows.filter((row) => eligible(row, cutoff)).slice(0, batchSize);
          },
          async recheckCandidate(id, cutoff) {
            const count = (checks.get(id) ?? 0) + 1;
            checks.set(id, count);
            if (count >= (disappearAfterChecks.get(id) ?? Infinity)) return null;
            return rows.find((row) => row.id === id && eligible(row, cutoff)) ?? null;
          },
          async deleteWithAudit(row) {
            deleted.push(row.id);
            audits.push({ action: ORPHAN_ATTACHMENT_AUDIT_ACTION, attachmentId: row.id });
            return true;
          },
        };
        return callback(session);
      },
      async blobExists(storageKey) { return blobs.has(storageKey); },
    },
  };
}

test("A: old orphan without a Blob is deleted", async () => {
  const row = old();
  const fake = fakeDependencies([row]);
  const result = await runOrphanAttachmentCleanup({ nowSeconds: NOW, dependencies: fake.dependencies });
  assert.equal(result.deleted, 1);
  assert.deepEqual(fake.deleted, [row.id]);
});

test("B: attachment younger than 24 hours is not selected", async () => {
  const fake = fakeDependencies([old({ created_at: NOW - ORPHAN_ATTACHMENT_TTL_SECONDS + 1 })]);
  const result = await runOrphanAttachmentCleanup({ nowSeconds: NOW, dependencies: fake.dependencies });
  assert.equal(result.candidates, 0);
  assert.equal(result.deleted, 0);
});

test("C: exact Blob existence makes the candidate REQUIRES_REVIEW", async () => {
  const row = old();
  const fake = fakeDependencies([row], { blobs: new Set([row.storage_key]) });
  const result = await runOrphanAttachmentCleanup({ nowSeconds: NOW, dependencies: fake.dependencies });
  assert.equal(result.skippedBlobExists, 1);
  assert.equal(result.items[0].verdict, "REQUIRES_REVIEW");
  assert.equal(result.deleted, 0);
});

test("D: attachment linked to a financial transaction is excluded", async () => {
  const fake = fakeDependencies([old({ transaction_id: "transaction-1" })]);
  const result = await runOrphanAttachmentCleanup({ nowSeconds: NOW, dependencies: fake.dependencies });
  assert.equal(result.candidates, 0);
});

test("E: attachment linked through entity_id is excluded", async () => {
  const fake = fakeDependencies([old({ entity_id: "business-entity-1" })]);
  const result = await runOrphanAttachmentCleanup({ nowSeconds: NOW, dependencies: fake.dependencies });
  assert.equal(result.candidates, 0);
});

test("F: FAILED attachment is never selected", async () => {
  const fake = fakeDependencies([old({ upload_status: "FAILED" })]);
  const result = await runOrphanAttachmentCleanup({ nowSeconds: NOW, dependencies: fake.dependencies });
  assert.equal(result.candidates, 0);
});

test("G: LINKED and completed attachments are never selected", async () => {
  const fake = fakeDependencies([old({ upload_status: "LINKED" }), old({ completed_at: NOW - 100 })]);
  const result = await runOrphanAttachmentCleanup({ nowSeconds: NOW, dependencies: fake.dependencies });
  assert.equal(result.candidates, 0);
});

test("H: a guard change immediately before delete is skipped", async () => {
  const row = old();
  const fake = fakeDependencies([row], { disappearAfterChecks: new Map([[row.id, 2]]) });
  const result = await runOrphanAttachmentCleanup({ nowSeconds: NOW, dependencies: fake.dependencies });
  assert.equal(result.skippedGuardChanged, 1);
  assert.equal(result.deleted, 0);
});

test("I: every successful deletion creates the dedicated audit event without file contents", async () => {
  const rows = [old(), old()];
  const fake = fakeDependencies(rows);
  const result = await runOrphanAttachmentCleanup({ nowSeconds: NOW, dependencies: fake.dependencies });
  assert.equal(result.deleted, 2);
  assert.deepEqual(fake.audits.map((audit) => audit.action), [ORPHAN_ATTACHMENT_AUDIT_ACTION, ORPHAN_ATTACHMENT_AUDIT_ACTION]);
  const source = await readFile(new URL("../lib/orphan-attachments-cleanup.ts", import.meta.url), "utf8");
  for (const field of ["attachmentId", "filename", "storageKey", "createdAt", "age", "priorStatus", "reason", "cleanupSource", "timestamp"]) assert.match(source, new RegExp(field));
  assert.doesNotMatch(source, /fileContent|content_base64|arrayBuffer/);
});

test("J: batch size is capped at 100 and SQL includes locking, reverse-link guards, dry-run and cron auth", async () => {
  const fake = fakeDependencies(Array.from({ length: 120 }, () => old()));
  const result = await runOrphanAttachmentCleanup({ nowSeconds: NOW, batchSize: 500, dryRun: true, dependencies: fake.dependencies });
  assert.equal(fake.requestedLimit, 100);
  assert.equal(result.candidates, 100);
  assert.equal(result.wouldDelete, 100);
  assert.equal(result.deleted, 0);
  const [source, route, config] = await Promise.all([
    readFile(new URL("../lib/orphan-attachments-cleanup.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/cron/orphan-attachments/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../vercel.json", import.meta.url), "utf8"),
  ]);
  assert.match(source, /FOR UPDATE OF a SKIP LOCKED/);
  for (const guard of ["transaction_id IS NULL", "entity_id IS NULL", "blob_url IS NULL", "completed_at IS NULL", "linked_at IS NULL", "previous_version_id=a.id", "cover_attachment_id=a.id", "published.attachment_id=a.id"]) assert.match(source, new RegExp(guard.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(source, /BlobNotFoundError/);
  assert.match(source, /list\(\{ prefix: storageKey, limit: 2 \}\)/);
  assert.match(route, /Bearer \$\{secret\}/);
  assert.match(route, /CRON_SECRET_MISSING/);
  assert.match(config, /api\/cron\/orphan-attachments/);
});
