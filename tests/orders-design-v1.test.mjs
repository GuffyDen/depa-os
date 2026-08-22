import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("0011 extends Orders without demo data or destructive record changes", async () => {
  const migration = await read("drizzle/postgres/0011_design_orders.sql");
  assert.match(migration, /'INSPECTION','DESIGN','RENOVATION'/);
  assert.match(migration, /CREATE TABLE design_projects/);
  assert.match(migration, /CREATE TABLE design_project_stages/);
  assert.match(migration, /CREATE TABLE design_project_events/);
  assert.match(migration, /CREATE TABLE renovation_order_details/);
  assert.match(migration, /ALTER TABLE orders ADD COLUMN source_lead_id/);
  assert.match(migration, /ALTER TABLE orders ADD COLUMN source_order_id/);
  assert.match(migration, /ON DELETE RESTRICT/);
  assert.match(migration, /projects_order_type_guard/);
  assert.doesNotMatch(migration, /DELETE FROM|TRUNCATE|DROP TABLE|INSERT INTO (orders|clients|projects|design_projects)/i);
});

test("Design creation is an atomic Order plus DesignProject and six default stages", async () => {
  const design = await read("lib/design.ts");
  assert.match(design, /export async function createDesignOrder/);
  assert.match(design, /INSERT INTO orders[\s\S]*'DESIGN'/);
  assert.match(design, /INSERT INTO design_projects/);
  assert.match(design, /DEFAULT_DESIGN_STAGES\.map/);
  assert.match(design, /await transaction\(statements\)/);
  for (const stage of ["Обмеры", "Планировочное решение", "Концепция", "Визуализации", "Рабочая документация", "Комплектация"])
    assert.match(design, new RegExp(stage));
});

test("service chains are optional and source relations are explicit", async () => {
  const [migration, design, projects] = await Promise.all([
    read("drizzle/postgres/0011_design_orders.sql"),
    read("lib/design.ts"),
    read("lib/projects.ts"),
  ]);
  assert.match(migration, /source_lead_id text/);
  assert.match(migration, /source_order_id text/);
  assert.match(design, /sourceOrderId/);
  assert.match(design, /CONVERT_TO_RENOVATION/);
  assert.match(design, /projectCreated: false/);
  assert.match(projects, /order\.type !== "RENOVATION"/);
  assert.match(projects, /RENOVATION_PROJECT_LINKED/);
});

test("Design lifecycle has editable stages, completion warnings, cancellation and immutable history", async () => {
  const design = await read("lib/design.ts");
  for (const action of [
    "DESIGN_PROJECT_CREATED",
    "DESIGN_STAGE_CREATED",
    "DESIGN_STAGE_UPDATED",
    "DESIGN_STAGE_COMPLETED",
    "DESIGN_STAGE_DELETED",
    "DESIGN_ORDER_COMPLETED",
    "ORDER_CANCELLED",
  ]) assert.match(design, new RegExp(action));
  assert.match(design, /unfinishedStages/);
  assert.match(design, /finalAlbumMissing/);
  assert.match(design, /remainingKopecks/);
  assert.doesNotMatch(design, /DELETE FROM (orders|design_projects|design_project_stages|design_project_events)/);
});

test("Design permissions and scopes are enforced on the backend", async () => {
  const [definitions, permissions, design, route] = await Promise.all([
    read("lib/permission-definitions.ts"),
    read("lib/permissions.ts"),
    read("lib/design.ts"),
    read("app/api/design/[orderId]/route.ts"),
  ]);
  for (const permission of [
    "design.view", "design.create", "design.edit", "design.assignDesigner",
    "design.stages.view", "design.stages.edit", "design.stages.complete",
    "design.files.view", "design.files.upload", "design.files.manageVersions",
    "design.files.archive", "design.viewFinance", "design.complete", "design.scope",
  ]) assert.match(definitions, new RegExp(permission.replaceAll(".", "\\.")));
  assert.match(permissions, /canViewDesignProject/);
  assert.match(design, /assertModuleAction\(actor, "orders", "design\./);
  assert.match(route, /getRequestUser/);
  assert.doesNotMatch(route, /export async function DELETE/);
});

test("commercial order fields are masked without finance permissions", async () => {
  const [orders, design, clients] = await Promise.all([
    read("lib/orders.ts"),
    read("lib/design.ts"),
    read("lib/clients.ts"),
  ]);
  assert.match(orders, /serialize\(row, canViewCommercialFinance\)/);
  assert.match(orders, /priceKopecks: canViewFinance \? price : null/);
  assert.match(design, /priceKopecks: canViewFinance \? price : null/);
  assert.match(clients, /design\.viewFinance/);
});

test("private Blob files support Design categories and strict version chains", async () => {
  const [migration, files, design, ui] = await Promise.all([
    read("drizzle/postgres/0011_design_orders.sql"),
    read("lib/files.ts"),
    read("lib/design.ts"),
    read("app/design-order-card.tsx"),
  ]);
  assert.match(migration, /previous_version_id/);
  assert.match(migration, /idx_attachments_design_current_unique/);
  assert.match(files, /DesignProject|DesignStage/);
  assert.match(files, /access: "private"|visibility/);
  assert.match(design, /FILE_VERSION_REQUIRED/);
  assert.match(design, /current\?\.id !== previousVersionId/);
  assert.match(ui, /application\/pdf/);
  assert.match(ui, /\/api\/files\/\$\{file\.id\}/);
});

test("universal order UI connects CRM, clients, inspections, Design and Renovation", async () => {
  const [form, orders, crm, shell, renovation] = await Promise.all([
    read("app/order-create-form.tsx"),
    read("app/orders-ui.tsx"),
    read("app/crm-ui.tsx"),
    read("app/depa-os.tsx"),
    read("app/renovation-order-card.tsx"),
  ]);
  for (const type of ["INSPECTION", "DESIGN", "RENOVATION"])
    assert.match(form, new RegExp(type));
  assert.match(crm, /onCreateOrder/);
  assert.match(shell, /initialSourceLeadId/);
  assert.match(orders, /onCreateRelated/);
  assert.match(renovation, /Создать объект/);
  assert.match(renovation, /orderId: order\.id/);
});

test("Design UI exposes real overview, stages, finance, files and history", async () => {
  const [ui, css] = await Promise.all([
    read("app/design-order-card.tsx"),
    read("app/orders.css"),
  ]);
  for (const label of ["Обзор", "Этапы", "Финансы", "Файлы", "История"])
    assert.match(ui, new RegExp(label));
  assert.match(ui, /editingStageId/);
  assert.match(ui, /Завершить всё равно/);
  assert.match(ui, /Создать заказ на ремонт/);
  assert.match(css, /design-hero-facts/);
  assert.match(css, /@media\(max-width:780px\)/);
});
