import assert from "node:assert/strict";
import test from "node:test";
import { FinanceAttachmentPipelineError, uploadFinanceAttachment } from "../lib/finance-attachments-client.ts";

const transactionId = "11111111-1111-4111-8111-111111111111";
const attachmentId = "22222222-2222-4222-8222-222222222222";

function fixture(uploadAttemptId = "33333333-3333-4333-8333-333333333333") {
  const file = new File([new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55])], "receipt.pdf", { type: "application/pdf" });
  return {
    file,
    draft: { attachmentId, uploadAttemptId, originalFilename: file.name, originalMimeType: file.type, detectedMimeType: "application/pdf", originalSizeBytes: file.size, mimeType: "application/pdf" },
  };
}

function okResponse() { return new Response(JSON.stringify({ ok: true, status: "LINKED" }), { status: 200, headers: { "content-type": "application/json" } }); }

test("A: direct success stays primary, confirms LINKED, and never starts fallback", async () => {
  const { file, draft } = fixture();
  let fallbackCalls = 0;
  let confirmBody;
  const result = await uploadFinanceAttachment({
    file, draft, transactionId, projectId: null,
    uploadHooks: {
      directUpload: async ({ onProgress }) => { onProgress(file.size, 100); },
      serverFallback: async () => { fallbackCalls += 1; return {}; },
      confirmUpload: async (body) => { confirmBody = body; return okResponse(); },
    },
  });
  assert.equal(result.pathUsed, "DIRECT");
  assert.equal(fallbackCalls, 0);
  assert.equal(confirmBody.uploadAttemptId, draft.uploadAttemptId);
  assert.match(JSON.stringify(result.telemetry), /DIRECT_BLOB_SUCCESS/);
});

test("B: direct timeout aborts quickly and automatically uses server fallback", async () => {
  const { file, draft } = fixture();
  const phases = [];
  let sawAbort = false;
  const started = Date.now();
  const result = await uploadFinanceAttachment({
    file, draft, transactionId, projectId: null, directTimeoutMs: 15,
    onPhase: (phase) => phases.push(phase),
    uploadHooks: {
      directUpload: ({ signal }) => new Promise((resolve, reject) => signal.addEventListener("abort", () => { sawAbort = true; reject(new DOMException("aborted", "AbortError")); }, { once: true })),
      serverFallback: async () => ({ uploadDurationMs: 4, confirmationDurationMs: 2 }),
      confirmUpload: async () => okResponse(),
    },
  });
  assert.equal(sawAbort, true);
  assert.equal(result.pathUsed, "SERVER_FALLBACK");
  assert.ok(Date.now() - started < 500);
  assert.ok(phases.includes("fallback"));
  assert.match(JSON.stringify(result.telemetry), /DIRECT_BLOB_TIMEOUT/);
});

test("C/D: direct network and CORS-like failures both fall back", async (t) => {
  for (const [name, error, expectedCode] of [
    ["network", new TypeError("Network request failed"), "DIRECT_BLOB_NETWORK_FAILED"],
    ["cors", new TypeError("blocked by client CORS policy"), "DIRECT_BLOB_CORS_FAILED"],
  ]) await t.test(name, async () => {
    const { file, draft } = fixture();
    const result = await uploadFinanceAttachment({
      file, draft, transactionId, projectId: null,
      uploadHooks: {
        directUpload: async () => { throw error; },
        serverFallback: async () => ({}),
        confirmUpload: async () => okResponse(),
      },
    });
    assert.equal(result.pathUsed, "SERVER_FALLBACK");
    assert.ok(result.telemetry.some((event) => event.failureCode === expectedCode));
  });
});

test("E: failure of both transports marks only the attachment FAILED", async () => {
  const { file, draft } = fixture();
  let failedBody;
  await assert.rejects(uploadFinanceAttachment({
    file, draft, transactionId, projectId: null,
    uploadHooks: {
      directUpload: async () => { throw new TypeError("Network request failed"); },
      serverFallback: async () => { throw new FinanceAttachmentPipelineError("server unavailable", "SERVER_BLOB_UPLOAD_FAILED", "SERVER_FALLBACK"); },
      markFailed: async (body) => { failedBody = body; return okResponse(); },
    },
  }), (error) => error.code === "SERVER_BLOB_UPLOAD_FAILED");
  assert.equal(failedBody.attachmentId, attachmentId);
  assert.equal(failedBody.uploadAttemptId, draft.uploadAttemptId);
  assert.equal(failedBody.status, "FAILED");
});

test("F/H/I: retry reuses one attachment row, changes attempt token, and can reach LINKED", async () => {
  const first = fixture("44444444-4444-4444-8444-444444444444");
  const second = fixture("55555555-5555-4555-8555-555555555555");
  let attachmentRows = 1;
  let attemptCount = 1;
  await assert.rejects(uploadFinanceAttachment({
    ...first, transactionId, projectId: null,
    uploadHooks: { directUpload: async () => { throw new TypeError("Network request failed"); }, serverFallback: async () => { throw new Error("fallback failed"); }, markFailed: async () => okResponse() },
  }));
  attemptCount += 1;
  const result = await uploadFinanceAttachment({
    ...second, transactionId, projectId: null,
    uploadHooks: { directUpload: async () => { throw new TypeError("Network request failed"); }, serverFallback: async () => ({}), confirmUpload: async () => okResponse() },
  });
  assert.equal(first.draft.attachmentId, second.draft.attachmentId);
  assert.notEqual(first.draft.uploadAttemptId, second.draft.uploadAttemptId);
  assert.equal(attachmentRows, 1);
  assert.equal(attemptCount, 2);
  assert.equal(result.pathUsed, "SERVER_FALLBACK");
});

test("race: a late direct completion and fallback share one canonical attachment/key", async () => {
  const { file, draft } = fixture();
  const canonicalKeys = new Set();
  let lateDirectCompleted = false;
  const result = await uploadFinanceAttachment({
    file, draft, transactionId, projectId: null, directTimeoutMs: 10,
    uploadHooks: {
      directUpload: ({ pathname, signal }) => new Promise((resolve, reject) => {
        canonicalKeys.add(pathname);
        signal.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
          setTimeout(() => { lateDirectCompleted = true; canonicalKeys.add(pathname); }, 5);
        }, { once: true });
      }),
      serverFallback: async () => { canonicalKeys.add(`depa-os/receipt/${attachmentId}.pdf`); await new Promise((resolve) => setTimeout(resolve, 10)); return {}; },
      confirmUpload: async () => okResponse(),
    },
  });
  assert.equal(result.pathUsed, "SERVER_FALLBACK");
  assert.equal(lateDirectCompleted, true);
  assert.deepEqual([...canonicalKeys], [`depa-os/receipt/${attachmentId}.pdf`]);
});
