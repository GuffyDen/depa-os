import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PROJECT_STATUSES, buildProjectName } from "../lib/project-config.ts";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("project statuses and automatic display names are centralized", () => {
  assert.deepEqual(PROJECT_STATUSES.map((item) => item.value), ["PLANNING", "ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"]);
  assert.equal(buildProjectName("Novatoria", "ул. Русская, 57", "124А"), "ЖК Novatoria · кв. 124А");
  assert.equal(buildProjectName(null, "ул. Русская, 57", "124А"), "ул. Русская, 57 · кв. 124А");
});

test("objects v1 routes the working screen to real project APIs", async () => {
  const [app, ui, collection, detail] = await Promise.all([read("app/depa-os.tsx"), read("app/projects-ui.tsx"), read("app/api/projects/route.ts"), read("app/api/projects/[id]/route.ts")]);
  assert.match(app, /<ProjectsScreen/);
  assert.match(ui, /\/api\/projects/);
  assert.match(ui, /Объектов пока нет/);
  assert.match(ui, /Для создания объекта сначала необходимо добавить клиента/);
  assert.match(collection, /listProjects/);
  assert.match(detail, /setProjectArchived/);
  assert.doesNotMatch(`${collection}${detail}`, /DELETE/);
});

test("project list applies backend search, filters, pagination and assigned scope", async () => {
  const data = await read("lib/projects.ts");
  for (const field of ["p.name ILIKE", "p.residential_complex ILIKE", "p.address ILIKE", "p.apartment ILIKE", "c.name ILIKE"]) assert.match(data, new RegExp(field.replace(".", "\\.")));
  assert.match(data, /p\.responsible_user_id=/);
  assert.match(data, /p\.foreman_employee_id=/);
  assert.match(data, /user_project_access/);
  assert.match(data, /LIMIT \$\{add\(limit \+ 1\)\} OFFSET/);
  assert.match(data, /nextOffset/);
});

test("project finance counts allocations once and protects sensitive summaries", async () => {
  const [data, financeUi] = await Promise.all([read("lib/projects.ts"), read("app/finance-ui.tsx")]);
  assert.match(data, /NOT EXISTS \(SELECT 1 FROM transaction_allocations/);
  assert.match(data, /ta\.amount_kopecks/);
  assert.match(data, /access\.actions\["projects\.viewCost"\]/);
  assert.match(financeUi, /initialProjectId/);
  assert.match(financeUi, /initialClientId/);
});

test("objects migration extends projects without replacing it or inserting demo records", async () => {
  const migration = await read("drizzle/postgres/0007_objects_v1.sql");
  assert.match(migration, /ALTER TABLE projects ALTER COLUMN order_id DROP NOT NULL/);
  assert.match(migration, /responsible_user_id/);
  assert.match(migration, /estimated_materials_budget_kopecks/);
  assert.match(migration, /REFERENCES users\(id\)/);
  assert.doesNotMatch(migration, /CREATE TABLE projects/);
  assert.doesNotMatch(migration, /INSERT INTO projects/);
});

test("project mutations preserve history through audit events and archive state", async () => {
  const data = await read("lib/projects.ts");
  for (const event of ["PROJECT_CREATED", "PROJECT_UPDATED", "PROJECT_RESPONSIBLE_CHANGED", "PROJECT_STATUS_CHANGED", "PROJECT_ARCHIVED", "PROJECT_RESTORED"]) assert.match(data, new RegExp(event));
  assert.match(data, /status=\$1,archived_at=\$2/);
  assert.doesNotMatch(data, /DELETE FROM projects/);
});
