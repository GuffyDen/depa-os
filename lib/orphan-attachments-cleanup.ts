import { BlobNotFoundError, head, list } from "@vercel/blob";
import type { PoolClient, QueryResultRow } from "pg";
import { query, withTransaction } from "./postgres.ts";

export const ORPHAN_ATTACHMENT_TTL_SECONDS = 24 * 60 * 60;
export const ORPHAN_ATTACHMENT_BATCH_SIZE = 75;
export const ORPHAN_ATTACHMENT_AUDIT_ACTION = "ORPHAN_ATTACHMENT_AUTO_DELETED";

type CandidateRow = QueryResultRow & {
  id: string;
  original_filename: string;
  storage_key: string;
  created_at: number | string;
  upload_status: string;
  uploaded_by_user_id: string;
};

export type CleanupItem = {
  attachmentId: string;
  filename: string;
  storageKey: string;
  createdAt: number;
  ageSeconds: number;
  priorStatus: string;
  blobExists: boolean | null;
  verdict: "ORPHAN" | "REQUIRES_REVIEW" | "SKIPPED_GUARD_CHANGED" | "ERROR" | "DELETED";
};

export type CleanupSummary = {
  dryRun: boolean;
  scanned: number;
  candidates: number;
  wouldDelete: number;
  deleted: number;
  skippedBlobExists: number;
  skippedGuardChanged: number;
  errors: number;
  durationMs: number;
  items: CleanupItem[];
};

type CleanupSession = {
  loadCandidates(cutoff: number, batchSize: number, lock: boolean): Promise<CandidateRow[]>;
  recheckCandidate(id: string, cutoff: number): Promise<CandidateRow | null>;
  deleteWithAudit(candidate: CandidateRow, now: number): Promise<boolean>;
};

export type CleanupDependencies = {
  runSession<T>(dryRun: boolean, callback: (session: CleanupSession) => Promise<T>): Promise<T>;
  blobExists(storageKey: string): Promise<boolean>;
};

const CANDIDATE_GUARDS = `
  a.upload_status='PENDING'
  AND a.transaction_id IS NULL
  AND a.entity_id IS NULL
  AND a.blob_url IS NULL
  AND a.completed_at IS NULL
  AND a.linked_at IS NULL
  AND a.deleted_at IS NULL
  AND a.project_id IS NULL
  AND a.design_project_id IS NULL
  AND a.design_stage_id IS NULL
  AND a.contract_version_id IS NULL
  AND a.additional_work_version_id IS NULL
  AND a.handover_id IS NULL
  AND a.handover_round_id IS NULL
  AND a.handover_defect_id IS NULL
  AND a.photo_requirement_id IS NULL
  AND a.client_payment_claim_id IS NULL
  AND a.previous_version_id IS NULL
  AND a.archived_at IS NULL
  AND a.logical_name IS NULL
  AND a.created_at < $1
  AND NOT EXISTS (SELECT 1 FROM attachments next_version WHERE next_version.previous_version_id=a.id)
  AND NOT EXISTS (SELECT 1 FROM apartment_passports passport WHERE passport.cover_attachment_id=a.id)
  AND NOT EXISTS (SELECT 1 FROM apartment_passport_version_attachments published WHERE published.attachment_id=a.id)
  AND NOT EXISTS (
    SELECT 1 FROM apartment_passports passport_json
    WHERE passport_json.excluded_attachment_ids_json ? a.id
       OR passport_json.attachment_captions_json ? a.id
  )`;

const CANDIDATE_COLUMNS = "a.id,a.original_filename,a.storage_key,a.created_at,a.upload_status,a.uploaded_by_user_id";

async function exactBlobExists(storageKey: string) {
  try {
    await head(storageKey);
    return true;
  } catch (error) {
    if (!(error instanceof BlobNotFoundError)) throw error;
  }
  const result = await list({ prefix: storageKey, limit: 2 });
  return result.blobs.some((blob) => blob.pathname === storageKey);
}

function sqlSession(execute: (text: string, params?: unknown[]) => Promise<CandidateRow[]>): CleanupSession {
  return {
    async loadCandidates(cutoff, batchSize, lock) {
      return execute(`SELECT ${CANDIDATE_COLUMNS} FROM attachments a
        WHERE ${CANDIDATE_GUARDS}
        ORDER BY a.created_at,a.id
        LIMIT $2${lock ? " FOR UPDATE OF a SKIP LOCKED" : ""}`, [cutoff, batchSize]);
    },
    async recheckCandidate(id, cutoff) {
      const rows = await execute(`SELECT ${CANDIDATE_COLUMNS} FROM attachments a
        WHERE a.id=$2 AND ${CANDIDATE_GUARDS}
        LIMIT 1`, [cutoff, id]);
      return rows[0] ?? null;
    },
    async deleteWithAudit(candidate, now) {
      const createdAt = Number(candidate.created_at);
      const metadata = JSON.stringify({
        attachmentId: candidate.id,
        filename: candidate.original_filename,
        storageKey: candidate.storage_key,
        createdAt,
        age: Math.max(0, now - createdAt),
        priorStatus: candidate.upload_status,
        reason: "Expired PENDING attachment without business links or physical Blob",
        cleanupSource: "automatic",
        timestamp: now,
      });
      const rows = await execute(`WITH deleted AS (
          DELETE FROM attachments a
          WHERE a.id=$2 AND ${CANDIDATE_GUARDS}
          RETURNING a.id
        )
        INSERT INTO audit_logs(id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json)
        SELECT $3,$4,$5,'Attachment',deleted.id,$6,$7::jsonb
        FROM deleted
        RETURNING entity_id AS id`, [
        now - ORPHAN_ATTACHMENT_TTL_SECONDS,
        candidate.id,
        crypto.randomUUID(),
        candidate.uploaded_by_user_id,
        ORPHAN_ATTACHMENT_AUDIT_ACTION,
        now,
        metadata,
      ]);
      return rows.length === 1 && rows[0].id === candidate.id;
    },
  };
}

const productionDependencies: CleanupDependencies = {
  async runSession(dryRun, callback) {
    if (dryRun) return callback(sqlSession((text, params = []) => query<CandidateRow>(text, params)));
    return withTransaction((client: PoolClient) => callback(sqlSession(async (text, params = []) => {
      const result = await client.query<CandidateRow>(text, params);
      return result.rows;
    })));
  },
  blobExists: exactBlobExists,
};

export async function runOrphanAttachmentCleanup(options: {
  dryRun?: boolean;
  nowSeconds?: number;
  batchSize?: number;
  dependencies?: CleanupDependencies;
} = {}): Promise<CleanupSummary> {
  const startedAt = performance.now();
  const dryRun = options.dryRun ?? false;
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const batchSize = Math.min(100, Math.max(1, Math.trunc(options.batchSize ?? ORPHAN_ATTACHMENT_BATCH_SIZE)));
  const dependencies = options.dependencies ?? productionDependencies;
  const cutoff = now - ORPHAN_ATTACHMENT_TTL_SECONDS;
  const summary: CleanupSummary = {
    dryRun,
    scanned: 0,
    candidates: 0,
    wouldDelete: 0,
    deleted: 0,
    skippedBlobExists: 0,
    skippedGuardChanged: 0,
    errors: 0,
    durationMs: 0,
    items: [],
  };

  await dependencies.runSession(dryRun, async (session) => {
    const candidates = await session.loadCandidates(cutoff, batchSize, !dryRun);
    summary.scanned = candidates.length;
    summary.candidates = candidates.length;
    for (const initial of candidates) {
      const current = await session.recheckCandidate(initial.id, cutoff);
      if (!current) {
        summary.skippedGuardChanged += 1;
        summary.items.push(toItem(initial, now, null, "SKIPPED_GUARD_CHANGED"));
        continue;
      }

      let exists: boolean;
      try {
        exists = await dependencies.blobExists(current.storage_key);
      } catch {
        summary.errors += 1;
        summary.items.push(toItem(current, now, null, "ERROR"));
        continue;
      }
      if (exists) {
        summary.skippedBlobExists += 1;
        summary.items.push(toItem(current, now, true, "REQUIRES_REVIEW"));
        continue;
      }

      const final = await session.recheckCandidate(current.id, cutoff);
      if (!final) {
        summary.skippedGuardChanged += 1;
        summary.items.push(toItem(current, now, false, "SKIPPED_GUARD_CHANGED"));
        continue;
      }
      if (dryRun) {
        summary.wouldDelete += 1;
        summary.items.push(toItem(final, now, false, "ORPHAN"));
        continue;
      }
      const deleted = await session.deleteWithAudit(final, now);
      if (!deleted) {
        summary.skippedGuardChanged += 1;
        summary.items.push(toItem(final, now, false, "SKIPPED_GUARD_CHANGED"));
        continue;
      }
      summary.deleted += 1;
      summary.items.push(toItem(final, now, false, "DELETED"));
    }
  });

  summary.durationMs = Math.max(0, Math.round(performance.now() - startedAt));
  return summary;
}

function toItem(candidate: CandidateRow, now: number, blobExists: boolean | null, verdict: CleanupItem["verdict"]): CleanupItem {
  const createdAt = Number(candidate.created_at);
  return {
    attachmentId: candidate.id,
    filename: candidate.original_filename,
    storageKey: candidate.storage_key,
    createdAt,
    ageSeconds: Math.max(0, now - createdAt),
    priorStatus: candidate.upload_status,
    blobExists,
    verdict,
  };
}
