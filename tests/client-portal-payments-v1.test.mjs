import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const migration = await read("drizzle/postgres/0016_client_portal_payments_v1.sql");
const portal = await read("lib/client-portal.ts");
const files = await read("lib/client-files.ts");
const permissions = await read("lib/permission-definitions.ts");
const production = await read("lib/production.ts");
const portalUi = await read("app/client/client-portal-ui.tsx");
const portalCss = await read("app/client/client-portal.css");

const cases = [
  ["0016 is additive and contains no seed or destructive DML", () => {
    assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/i);
    assert.doesNotMatch(migration, /INSERT INTO/i);
  }],
  ["0016 creates a separate client identity and session model", () => {
    for (const table of ["client_portal_users", "client_portal_sessions", "client_portal_invites"]) assert.match(migration, new RegExp(`CREATE TABLE ${table}`));
  }],
  ["portal users are linked to existing clients and never employee users", () => {
    assert.match(migration, /client_portal_users_client_fkey[\s\S]*REFERENCES clients\(id\)/);
    assert.doesNotMatch(migration.slice(0, migration.indexOf("client_portal_sessions")), /REFERENCES employees/);
  }],
  ["portal session and invite tokens are unique", () => {
    assert.match(migration, /client_portal_sessions_token_unique UNIQUE\(token_hash\)/);
    assert.match(migration, /client_portal_invites_token_unique UNIQUE\(token_hash\)/);
  }],
  ["invites expire in 72 hours and are stored hashed", () => {
    assert.match(portal, /INVITE_SECONDS = 60 \* 60 \* 72/);
    assert.match(portal, /sha256\(token\)/);
    assert.match(portal, /token_hash/);
  }],
  ["invite activation enforces unused unrevoked unexpired links", () => {
    assert.match(portal, /used_at IS NULL AND i\.revoked_at IS NULL AND i\.expires_at>\$2/);
    assert.match(portal, /WITH claimed AS \([\s\S]*UPDATE client_portal_invites SET used_at/);
    assert.match(portal, /Number\(activated\[0\]\?\.count \?\? 0\) !== 1/);
  }],
  ["client sessions use a distinct HttpOnly SameSite cookie", () => {
    assert.match(portal, /depa_client_session/);
    assert.match(portal, /HttpOnly/);
    assert.match(portal, /SameSite=Lax/);
    assert.match(portal, /; Secure/);
  }],
  ["session tokens are hashed and revocable", () => {
    assert.match(portal, /sessionHash = await sha256\(sessionToken\)/);
    assert.match(portal, /revoked_at IS NULL AND s\.expires_at>/);
  }],
  ["reset and disable revoke active sessions and invites", () => {
    assert.match(portal, /UPDATE client_portal_sessions SET revoked_at/);
    assert.match(portal, /UPDATE client_portal_invites SET revoked_at/);
    assert.match(portal, /CLIENT_PORTAL_ACCESS_DISABLED/);
  }],
  ["client login has brute-force protection", () => {
    assert.match(portal, /auth_attempts/);
    assert.match(portal, />= 5/);
    assert.match(portal, /15 минут/);
  }],
  ["portal activity has a dedicated immutable audit trail", () => {
    assert.match(migration, /CREATE TABLE client_portal_audit_events/);
    assert.match(portal, /CLIENT_PORTAL_LOGIN/);
    assert.match(portal, /CLIENT_PORTAL_LOGOUT/);
  }],
  ["portal supports multiple real objects for one client", () => {
    assert.match(portal, /WHERE p\.client_id=\$1/);
    assert.match(portal, /WHERE o\.client_id=\$1/);
    assert.match(portalUi, /data\.objects\.length>1/);
  }],
  ["design-only clients receive a safe design mode", () => {
    assert.match(portal, /mode: "DESIGN_ONLY"/);
    assert.match(portal, /progressLabel: "Готовность дизайн-проекта"/);
  }],
  ["combined progress uses explicit design and production weights", () => {
    assert.match(portal, /design_weight,production_weight/);
    assert.match(portal, /designWeight \+ productionProgress \* productionWeight/);
  }],
  ["client gets only the published forecast", () => {
    const home = portal.slice(portal.indexOf("export async function getClientPortalHome"), portal.indexOf("async function createAcceptedStageObligations"));
    assert.match(home, /published_forecast_end_date/);
    assert.doesNotMatch(home, /internal_forecast_end_date/);
  }],
  ["tasks and delays are filtered by client visibility", () => {
    assert.match(portal, /tasks WHERE stage_id=ANY\(\$1\) AND client_visible=1/);
    assert.match(portal, /project_delays WHERE project_id=\$1 AND client_visible=1/);
  }],
  ["daily report comments require explicit client visibility", () => {
    assert.match(portal, /CASE WHEN dr\.comment_client_visible=1 THEN dr\.comment ELSE NULL END/);
  }],
  ["daily photos and hidden-work photos require client visibility", () => {
    assert.ok((portal.match(/a\.visibility='CLIENT' OR a\.client_visible=1/g) ?? []).length >= 2);
  }],
  ["documents are explicitly allowlisted for the portal", () => {
    assert.match(portal, /a\.category IN\('ESTIMATE','CONTRACT','CONTRACT_PDF','SIGNED_CONTRACT','FINAL_ALBUM','OTHER'\)/);
  }],
  ["client file download verifies object or claim ownership", () => {
    assert.match(files, /p\.client_id=\$2/);
    assert.match(files, /pc\.client_id=\$2/);
    assert.match(files, /Файл недоступен/);
  }],
  ["payment proof uploads stay private and type/size limited", () => {
    assert.match(files, /\.private\.blob\.vercel-storage\.com/);
    assert.match(files, /DOCUMENT_MAX_BYTES/);
    assert.match(files, /PROOF_MIMES/);
  }],
  ["completing an acceptance-required stage awaits acceptance", () => {
    assert.match(production, /client_acceptance_required=1 THEN 'AWAITING_ACCEPTANCE'/);
    assert.match(production, /STAGE_SENT_FOR_ACCEPTANCE/);
  }],
  ["stage acceptance events preserve the full workflow", () => {
    for (const value of ["AWAITING_ACCEPTANCE", "STAGE_ACCEPTED_BY_CLIENT", "STAGE_REJECTED_BY_CLIENT", "STAGE_RESUBMITTED_FOR_ACCEPTANCE", "STAGE_ACCEPTED_MANUALLY_BY_DEPA"]) assert.match(migration, new RegExp(value));
  }],
  ["client acceptance is ownership checked and idempotent", () => {
    assert.match(portal, /p\.client_id=\$2 AND s\.status='COMPLETED'/);
    assert.match(portal, /idempotent: true/);
  }],
  ["client rejection requires a comment", () => {
    assert.match(portal, /if \(!reason\) throw new ClientPortalError\("Опишите замечания к этапу\."\)/);
  }],
  ["DEPA can resubmit only a rejected stage", () => {
    assert.match(portal, /acceptance_status !== "REJECTED"/);
    assert.match(portal, /stageAcceptance\.resubmit/);
  }],
  ["manual DEPA acceptance requires a reason and is audited", () => {
    assert.match(portal, /Укажите основание ручной приёмки/);
    assert.match(portal, /STAGE_ACCEPTED_MANUALLY_BY_DEPA/);
  }],
  ["payment terms keep versioned stage snapshots", () => {
    assert.match(migration, /project_stage_payment_terms_stage_version_unique UNIQUE\(stage_id,payment_plan_version\)/);
    assert.match(portal, /payment_plan_version/);
  }],
  ["activating a payment plan creates the first advance once", () => {
    assert.match(portal, /PAYMENT_PLAN_ACTIVATED/);
    assert.match(portal, /STAGE_ADVANCE/);
    assert.match(portal, /ON CONFLICT\(source_key\)[\s\S]*DO NOTHING/);
  }],
  ["acceptance creates stage balance and next-stage advance obligations", () => {
    assert.match(portal, /STAGE_BALANCE/);
    assert.match(portal, /sort_order>\$3/);
    assert.match(portal, /stage:\$\{next\.stage_id\}:advance/);
  }],
  ["the existing obligations table remains the debt source", () => {
    assert.doesNotMatch(migration, /CREATE TABLE (debts|client_debts|payment_obligations)/i);
    assert.match(portal, /INSERT INTO obligations/);
  }],
  ["a client claim is not a financial transaction", () => {
    const claim = portal.slice(portal.indexOf("export async function createPaymentClaim"), portal.indexOf("export async function cancelPaymentClaim"));
    assert.match(claim, /INSERT INTO client_payment_claims/);
    assert.doesNotMatch(claim, /financial_transactions|UPDATE cashboxes/);
  }],
  ["claim proof is optional in the client UI", () => {
    assert.match(portalUi, /Скрин или чек \(необязательно\)/);
    assert.match(portalUi, /if\(proof\)/);
  }],
  ["claim confirmation locks and processes only pending claims", () => {
    assert.match(portal, /FOR UPDATE/);
    assert.match(portal, /eligible AS \(SELECT \* FROM locked WHERE status='PENDING'\)/);
  }],
  ["confirmation atomically creates exactly one Finance income", () => {
    assert.match(portal, /inserted_transaction AS \(INSERT INTO financial_transactions/);
    assert.match(portal, /'INCOME'/);
    assert.match(migration, /financial_transactions_payment_claim_unique/);
  }],
  ["confirmation updates cashbox and claim in the same statement", () => {
    assert.match(portal, /updated_cashbox AS \(UPDATE cashboxes/);
    assert.match(portal, /updated_claim AS \(UPDATE client_payment_claims/);
  }],
  ["partial payments allocate and update obligation status", () => {
    assert.match(portal, /LEAST\(r\.remaining,GREATEST\(0,\$3-r\.prior\)\)/);
    assert.match(portal, /'PARTIALLY_PAID'/);
  }],
  ["overpayment is preserved as unapplied client funds", () => {
    assert.match(migration, /CREATE TABLE client_unapplied_funds/);
    assert.match(portal, /unapplied AS \(INSERT INTO client_unapplied_funds/);
  }],
  ["cashbox confirmation respects owner, own-box, and elevated permission", () => {
    assert.match(portal, /box\.owner_user_id !== actor\.id/);
    assert.match(portal, /clientPayments\.confirmToAnyCashbox/);
    assert.match(permissions, /clientPayments\.confirmToAnyCashbox/);
  }],
  ["portal UI is mobile-first and exposes the five agreed sections", () => {
    for (const label of ["Главная", "Ход работ", "Фото", "Оплаты", "Документы"]) assert.match(portalUi, new RegExp(label));
    assert.match(portalCss, /@media\(max-width:760px\)/);
    assert.match(portalCss, /min-height:44px/);
  }],
];

assert.equal(cases.length, 40);
for (const [name, assertion] of cases) test(name, assertion);
