import { runOrphanAttachmentCleanup } from "../../../../lib/orphan-attachments-cleanup";
import { createRequestLogger } from "../../../../lib/request-logger";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const log = createRequestLogger(request, {
    route: "/api/cron/orphan-attachments",
    action: "ORPHAN_ATTACHMENT_CLEANUP",
    actorType: "SYSTEM",
  });
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    log.failure("ORPHAN_ATTACHMENT_CLEANUP_FAILURE", new Error("Cron secret is not configured"), { errorCode: "CRON_SECRET_MISSING" });
    return log.json({ error: "Cleanup endpoint is not configured." }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    log.failure("ORPHAN_ATTACHMENT_CLEANUP_FAILURE", new Error("Unauthorized"), { errorCode: "UNAUTHORIZED" });
    return log.json({ error: "Unauthorized." }, { status: 401 });
  }

  const dryRun = ["1", "true"].includes(new URL(request.url).searchParams.get("dryRun")?.toLowerCase() ?? "");
  log.start("ORPHAN_ATTACHMENT_CLEANUP_STARTED", { dryRun });
  try {
    const result = await runOrphanAttachmentCleanup({ dryRun });
    if (result.errors > 0) {
      log.failure("ORPHAN_ATTACHMENT_CLEANUP_FAILURE", new Error("One or more Blob checks failed"), {
        dryRun,
        scanned: result.scanned,
        candidates: result.candidates,
        deleted: result.deleted,
        skipped_blob_exists: result.skippedBlobExists,
        skipped_guard_changed: result.skippedGuardChanged,
        errors: result.errors,
        duration_ms: result.durationMs,
        errorCode: "BLOB_CHECK_FAILED",
      });
      return log.json(result, { status: 503, headers: { "Cache-Control": "private, no-store" } });
    }
    log.success("ORPHAN_ATTACHMENT_CLEANUP_SUCCESS", {
      dryRun,
      scanned: result.scanned,
      candidates: result.candidates,
      deleted: result.deleted,
      skipped_blob_exists: result.skippedBlobExists,
      skipped_guard_changed: result.skippedGuardChanged,
      errors: result.errors,
      duration_ms: result.durationMs,
    });
    return log.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    log.failure("ORPHAN_ATTACHMENT_CLEANUP_FAILURE", error, { dryRun, errorCode: "CLEANUP_INTERNAL" });
    return log.json({ error: "Orphan attachment cleanup failed." }, { status: 500 });
  }
}
