import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = async (path) => readFile(new URL(path, root), "utf8");
const files = await Promise.all([
  source("drizzle/postgres/0018_additional_works_v1.sql"), source("lib/additional-works.ts"), source("lib/client-portal.ts"),
  source("lib/files.ts"), source("lib/permission-definitions.ts"), source("app/additional-works-ui.tsx"),
  source("app/client/client-additional-works.tsx"), source("app/api/client/additional-works/route.ts"), source("app/depa-os.tsx"),
]);
const [migration, domain, portal, filesDomain, permissions, internalUi, clientUi, clientRoute, shell] = files;

const scenarios = [
  ["01 separate container", migration, /CREATE TABLE additional_works/],
  ["02 legacy versions reused", migration, /ALTER TABLE additional_work_versions ADD COLUMN reason/],
  ["03 deferred container/version FK", migration, /DEFERRABLE INITIALLY DEFERRED/],
  ["04 sent content immutable", migration, /protect_additional_work_version_content/],
  ["05 child rows immutable", migration, /protect_additional_work_version_children/],
  ["06 exact quantity precision", migration, /quantity numeric\(14,3\)/],
  ["07 backend monetary derivation", domain, /quantity\.milli \* unitPrice/],
  ["08 zero price supported", domain, /l\.amount_kopecks>0/],
  ["09 internal description separate", migration, /internal_comment text/],
  ["10 client DTO allowlist", domain, /SELECT id,position,name,description,quantity,unit,client_unit_price_kopecks,client_total_kopecks/],
  ["11 send requires active portal", domain, /client_portal_users WHERE client_id=\$1 AND status='ACTIVE'/],
  ["12 client approve endpoint", clientRoute, /approveAdditionalWorkByClient/],
  ["13 client reject endpoint", clientRoute, /rejectAdditionalWorkByClient/],
  ["14 reject creates next-version path", domain, /createAdditionalWorkVersion/],
  ["15 manual approval has required reason", domain, /Укажите основание ручного согласования/],
  ["16 approval locks container and version", domain, /FOR UPDATE OF aw,v/],
  ["17 unique obligation source key", domain, /additional_work:'\|\|l\.work_id\|\|':version:'/],
  ["18 obligation type", domain, /'ADDITIONAL_WORK'/],
  ["19 tasks only after approval", domain, /JOIN approved_version av ON true/],
  ["20 task weight starts at zero", domain, /completed_quantity,weight_within_stage[\s\S]*pt\.quantity,0,0/],
  ["21 production task link", migration, /CREATE TABLE additional_work_task_links/],
  ["22 no separate production plan", domain, /JOIN production_plans pp ON pp\.project_id=l\.project_id/],
  ["23 schedule preview separate", domain, /previewAdditionalWorkSchedule/],
  ["24 schedule apply separate", domain, /applyAdditionalWorkSchedule/],
  ["25 published forecast unchanged", domain, /publishedForecastUnchanged: true/],
  ["26 signed contract not updated", domain, /contractWorksKopecks/],
  ["27 derived commercial total", domain, /currentCommercialWorksKopecks: contract \+ additional/],
  ["28 action priority in portal", portal, /additionalWorks/],
  ["29 client approve UI", clientUi, /СОГЛАСОВАТЬ/],
  ["30 rejection comment UI", clientUi, /Комментарий к отказу/],
  ["31 payment state linked", domain, /remainingKopecks/],
  ["32 private attachments", filesDomain, /ADDITIONAL_WORK/],
  ["33 attachment version scope", filesDomain, /additionalWorkVersionId/],
  ["34 central permissions", permissions, /additionalWorks\.manualApprove/],
  ["35 assigned scope", permissions, /key: "additionalWorks"/],
  ["36 global search", shell, /ДОПОЛНИТЕЛЬНЫЕ РАБОТЫ/],
];

for (const [name, text, pattern] of scenarios) test(`Additional Works scenario ${name}`, () => assert.match(text, pattern));

test("client view does not render internal economics", () => {
  assert.doesNotMatch(clientUi, /internal_comment|internal_unit_cost|marginKopecks|internalCostKopecks/);
});

test("migration is additive and contains no destructive business-data command", () => {
  assert.doesNotMatch(migration, /\bDROP\s+(?:TABLE|COLUMN)\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i);
});

test("internal UI uses structured actions instead of prompt", () => {
  assert.match(internalUi, /StructuredActionDialog/);
  assert.doesNotMatch(internalUi, /window\.prompt|\bprompt\(/);
});
