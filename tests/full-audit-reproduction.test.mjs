import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("PostgreSQL audit logs are immutable at the database layer", async () => {
  const migrations = await Promise.all([
    read("drizzle/postgres/0004_postgres_integrity_and_blob.sql"),
    read("drizzle/postgres/0016_client_portal_payments_v1.sql"),
    read("drizzle/postgres/0017_stabilization_v1.sql"),
  ]).then((parts) => parts.join("\n"));
  assert.match(migrations, /audit_logs_immutable_update/i);
  assert.match(migrations, /audit_logs_immutable_delete/i);
  assert.match(migrations, /client_portal_audit_events_immutable_update/i);
  assert.match(migrations, /client_portal_audit_events_immutable_delete/i);
});

test("Drizzle schema represents the current CRM tables", async () => {
  const schema = await read("db/schema.ts");
  const leads = schema.slice(schema.indexOf("export const leads"), schema.indexOf("export const cashboxes"));
  assert.match(leads, /linkedClientId:\s*text\("linked_client_id"\)/);
  assert.match(leads, /stage:\s*text\("stage"/);
  assert.match(leads, /responsibleUserId:\s*text\("responsible_user_id"\)/);
  assert.match(schema, /export const leadActivities\s*=\s*pgTable\(\s*"lead_activities"/);
});

test("concurrent stage decisions gate events on the successful state transition", async () => {
  const source = await read("lib/client-portal.ts");
  const acceptance = source.slice(source.indexOf("export async function acceptStageByClient"), source.indexOf("export async function rejectStageByClient"));
  const rejection = source.slice(source.indexOf("export async function rejectStageByClient"), source.indexOf("async function internalStage"));
  assert.match(acceptance, /UPDATE project_stages[\s\S]*RETURNING[\s\S]*INSERT INTO stage_acceptance_events/i);
  assert.match(rejection, /UPDATE project_stages[\s\S]*RETURNING[\s\S]*INSERT INTO stage_acceptance_events/i);
});

test("parallel refunds serialize validation against the original expense", async () => {
  const source = await read("lib/finance.ts");
  const operation = source.slice(source.indexOf("export async function createFinanceOperation"), source.indexOf("export async function updateFinanceOperation"));
  assert.match(operation, /pg_advisory_xact_lock[\s\S]*refund:[\s\S]*SUM\(amount_kopecks\)[\s\S]*original_transaction_id/i);
});

test("unlinked attachment cleanup emits one deletion audit event", async () => {
  const source = await read("lib/files.ts");
  const cleanup = source.slice(source.indexOf("export async function cleanupUnlinkedAttachment"), source.indexOf("export async function getAuthorizedAttachment"));
  assert.equal((cleanup.match(/'FILE_DELETED'/g) ?? []).length, 1);
});

test("dashboard contains no live-looking hardcoded business metrics", async () => {
  const source = await read("app/depa-os.tsx");
  assert.doesNotMatch(source, /value="2,84 млн ₽"|value="684 000 ₽"|count:\s*9|aria-label="Уведомления">●<i>3/);
});

test("global search opens the selected Contract", async () => {
  const source = await read("app/depa-os.tsx");
  const orders = await read("app/orders-ui.tsx");
  assert.match(source, /dashboard\?section=orders&contractId=/);
  assert.match(orders, /URLSearchParams\(window\.location\.search\)\.get\("contractId"\)/);
  assert.match(orders, /ContractsWorkspace[\s\S]*initialContractId=\{contractTargetId\}/);
});

test("Client Portal never falls back to an internal delay reason", async () => {
  const service = await read("lib/client-portal.ts");
  assert.doesNotMatch(service, /SELECT id,category,reason,client_comment/);
  assert.match(service, /'Срок скорректирован'::text reason,client_comment/);
});

test("finance cashbox balance update is part of the validated operation", async () => {
  const source = await read("lib/finance.ts");
  const operation = source.slice(source.indexOf("export async function createFinanceOperation"), source.indexOf("export async function updateFinanceOperation"));
  assert.match(operation, /SELECT id FROM cashboxes[\s\S]*status='ACTIVE'[\s\S]*FOR UPDATE[\s\S]*cashbox_guard[\s\S]*INSERT INTO financial_transactions/i);
});

test("full apartment E2E has an isolated local or test database configuration", () => {
  const configured = [".env.test", ".env.test.local", "docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"].some(existsSync);
  assert.equal(configured, true, "No isolated local/test database is configured; production must not be used for synthetic E2E data.");
});
