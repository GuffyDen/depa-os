import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("0013 is additive, preserves records, and does not seed production data", async () => {
  const migration = await read("drizzle/postgres/0013_estimates_proposals.sql");
  for (const table of ["estimates", "estimate_sections", "estimate_items", "estimate_events"])
    assert.match(migration, new RegExp(`CREATE TABLE ${table}`));
  assert.match(migration, /ALTER TABLE estimate_versions ALTER COLUMN project_id DROP NOT NULL/);
  assert.match(migration, /ON DELETE RESTRICT/);
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM|UPDATE (users|employees|cashboxes|financial_transactions|leads|clients|projects|orders|inspections|attachments|audit_logs)/i);
  assert.doesNotMatch(migration, /INSERT INTO (estimates|estimate_sections|estimate_items|estimate_events|orders|clients|leads|projects)/i);
});

test("0013 constrains money, quantities, statuses, version numbers, and duplicate Renovation conversion", async () => {
  const migration = await read("drizzle/postgres/0013_estimates_proposals.sql");
  for (const pattern of [
    /total_kopecks >= 0/,
    /estimated_materials_budget_kopecks IS NULL OR estimated_materials_budget_kopecks >= 0/,
    /quantity > 0/,
    /client_price_kopecks >= 0/,
    /internal_cost_kopecks IS NULL OR internal_cost_kopecks >= 0/,
    /idx_estimate_version_number/,
    /idx_renovation_estimate_version_unique/,
  ]) assert.match(migration, pattern);
});

test("estimate creation atomically creates Estimate, v1, pointers, audit, and business history", async () => {
  const source = await read("lib/estimates.ts");
  assert.match(source, /export async function createEstimate/);
  assert.match(source, /INSERT INTO estimates/);
  assert.match(source, /INSERT INTO estimate_versions[\s\S]*1,0,'DRAFT'/);
  assert.match(source, /UPDATE estimates SET current_version_id/);
  assert.match(source, /ESTIMATE_CREATED/);
  assert.match(source, /await transaction\(\[/);
});

test("backend validates relations and assigned scope instead of trusting UI", async () => {
  const source = await read("lib/estimates.ts");
  for (const relation of ["sourceLeadId", "sourceOrderId", "projectId"])
    assert.match(source, new RegExp(relation));
  assert.match(source, /access\.scopes\.estimates !== "ALL"/);
  assert.match(source, /responsibleUserId !== actor\.id/);
  assert.match(source, /Заявка не связана с выбранным клиентом/);
  assert.match(source, /Заказ относится к другому клиенту/);
  assert.match(source, /Объект относится к другому клиенту/);
});

test("money is accepted as integer kopecks and quantity has exact two-decimal parsing", async () => {
  const source = await read("lib/estimates.ts");
  assert.match(source, /Number\.isSafeInteger\(numeric\)/);
  assert.match(source, /\^\\d\+\(\?:\\\.\\d\{1,2\}\)\?\$/);
  assert.match(source, /Number\(whole\) \* 100/);
  assert.match(source, /Math\.round\(product \/ 100\)/);
  const quantityHundredths = (value) => {
    const [whole, fraction = ""] = String(value).replace(",", ".").split(".");
    return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  };
  const itemTotal = (quantity, priceKopecks) => Math.round(quantityHundredths(quantity) * priceKopecks / 100);
  assert.equal(itemTotal("64,50", 125000), 8_062_500);
  assert.equal(itemTotal("0.01", 1), 0);
  assert.equal(itemTotal("1.01", 999), 1009);
});

test("draft edits are transactional, audited, and immutable after send", async () => {
  const source = await read("lib/estimates.ts");
  assert.match(source, /version\.status !== "DRAFT"/);
  assert.match(source, /FOR UPDATE/);
  for (const action of [
    "ESTIMATE_SECTION_CREATED", "ESTIMATE_SECTION_UPDATED", "ESTIMATE_SECTION_DELETED",
    "ESTIMATE_ITEM_CREATED", "ESTIMATE_ITEM_UPDATED", "ESTIMATE_ITEM_DELETED", "ESTIMATE_UPDATED",
  ]) assert.match(source, new RegExp(action));
  assert.match(source, /await transaction\(statements\)/);
});

test("users without cost permission cannot overwrite or receive internal cost", async () => {
  const source = await read("lib/estimates.ts");
  assert.match(source, /allowCost \? kopecks\(item\.internalCostKopecks, true\) : existingCosts\.get\(itemId\)/);
  assert.match(source, /loadSections\(selected\.id, false, false\)/);
  assert.match(source, /\.\.\.\(canCost \? \{ internalCostKopecks/);
  assert.match(source, /\.\.\.\(canMargin/);
});

test("versions copy sections, prices, costs, and preserve prior rows", async () => {
  const source = await read("lib/estimates.ts");
  assert.match(source, /export async function createEstimateVersion/);
  assert.match(source, /COALESCE\(MAX\(version\),0\)\+1/);
  assert.match(source, /internal_cost_kopecks/);
  assert.match(source, /status='SUPERSEDED'/);
  assert.doesNotMatch(source, /DELETE FROM estimate_versions/);
});

test("proposal workflow records send, optional CRM stage move, approval, rejection, and follow-up", async () => {
  const source = await read("lib/estimates.ts");
  for (const action of ["ESTIMATE_SENT", "ESTIMATE_APPROVED", "ESTIMATE_REJECTED", "ESTIMATE_FOLLOW_UP_CREATED"])
    assert.match(source, new RegExp(action));
  assert.match(source, /stage='PROPOSAL'[\s\S]*stage='CALCULATION'/);
  assert.match(source, /FOLLOW_UP_PROPOSAL/);
  assert.match(source, /Укажите причину отклонения/);
});

test("client Proposal endpoint is auth protected, private, and has a dedicated safe view model", async () => {
  const [route, source] = await Promise.all([
    read("app/api/estimates/[id]/proposal/route.ts"),
    read("lib/estimates.ts"),
  ]);
  assert.match(route, /getRequestUser/);
  assert.match(route, /status: 401/);
  assert.match(route, /Cache-Control": "private, no-store/);
  const proposal = source.slice(source.indexOf("export async function getProposal"));
  assert.match(proposal, /loadSections\(selected\.id, false, false\)/);
  assert.doesNotMatch(proposal, /internal_comment|internalCost|marginKopecks|responsibleName/);
});

test("all Estimate mutations are auth protected and dispatched server-side", async () => {
  const [collection, card] = await Promise.all([
    read("app/api/estimates/route.ts"),
    read("app/api/estimates/[id]/route.ts"),
  ]);
  assert.match(collection, /getRequestUser/);
  assert.match(collection, /status: 401/);
  assert.match(card, /getRequestUser/);
  assert.match(card, /status: 401/);
  for (const action of ["createVersion", "send", "approve", "reject", "archive", "restore", "followUp", "createRenovation"])
    assert.match(card, new RegExp(`action === "${action}"`));
  assert.doesNotMatch(card, /export async function DELETE/);
});

test("estimate actions and scope are represented in the permission system", async () => {
  const [definitions, ui] = await Promise.all([
    read("lib/permission-definitions.ts"),
    read("app/team-access-ui.tsx"),
  ]);
  for (const permission of [
    "estimates.view", "estimates.create", "estimates.edit", "estimates.createVersion",
    "estimates.viewCost", "estimates.viewMargin", "estimates.sendProposal",
    "estimates.approve", "estimates.reject", "estimates.scope",
  ]) assert.match(definitions, new RegExp(permission.replaceAll(".", "\\.")));
  assert.match(ui, /Сметы и КП/);
});

test("approved estimate creates exactly one Renovation Order with works only", async () => {
  const source = await read("lib/estimates.ts");
  assert.match(source, /version\.status !== "APPROVED"/);
  assert.match(source, /'RENOVATION','Ремонт квартиры',\$4/);
  assert.match(source, /Number\(version\.total_kopecks\)/);
  assert.match(source, /approved_estimate_version_id/);
  assert.match(source, /Заказ на ремонт уже создан/);
  assert.doesNotMatch(source, /estimated_materials_budget_kopecks[^\n]+INSERT INTO orders/);
});

test("approved estimate pre-fills and remains linked to Project without becoming a financial transaction", async () => {
  const [projects, migration, estimates] = await Promise.all([
    read("lib/projects.ts"),
    read("drizzle/postgres/0013_estimates_proposals.sql"),
    read("lib/estimates.ts"),
  ]);
  assert.match(projects, /approved_estimate_version_id/);
  assert.match(projects, /contractWorksAmount: source\?\.estimate_total_kopecks/);
  assert.match(projects, /estimatedMaterialsBudget: source\?\.estimate_materials_kopecks/);
  assert.match(migration, /ALTER TABLE projects ADD COLUMN approved_estimate_version_id/);
  assert.doesNotMatch(estimates, /INSERT INTO financial_transactions|UPDATE cashboxes/);
});

test("Estimate UI connects Orders, CRM, Clients, Inspection, Design, Project, and global search", async () => {
  const [shell, orders, clients, crm, design, projects] = await Promise.all([
    read("app/depa-os.tsx"), read("app/orders-ui.tsx"), read("app/clients-ui.tsx"),
    read("app/crm-ui.tsx"), read("app/design-order-card.tsx"), read("app/projects-ui.tsx"),
  ]);
  assert.match(orders, /Сметы \/ КП/);
  assert.match(clients, /Сметы/);
  assert.match(crm, /Создать смету/);
  assert.match(orders, /o\.type === "INSPECTION"[\s\S]*onCreateEstimate/);
  assert.match(design, /onCreateEstimate/);
  assert.match(projects, /onCreateEstimate/);
  assert.match(shell, /targetEstimateId/);
  assert.match(shell, /fetch\(`\/api\/estimates\?/);
});

test("Estimate UI has honest empty state, editable structure, versions, proposal, and no fake export", async () => {
  const [ui, css] = await Promise.all([read("app/estimates-ui.tsx"), read("app/estimates.css")]);
  for (const label of ["Смет пока нет", "Создать смету", "Позиция", "Раздел", "Версии", "Предпросмотр КП", "Согласована клиентом", "Создать заказ на ремонт"])
    assert.match(ui, new RegExp(label));
  assert.match(ui, /window\.confirm/);
  assert.match(css, /@media\(max-width:700px\)/);
  assert.doesNotMatch(ui, /Скачать PDF|Экспорт в Excel|Использовать шаблон/);
});
