import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("0012 adds one shared non-destructive registry with restrictive relations", async () => {
  const migration = await read("drizzle/postgres/0012_residential_complexes.sql");
  assert.match(migration, /CREATE TABLE residential_complexes/);
  for (const table of ["inspections", "design_projects", "renovation_order_details", "projects"])
    assert.match(migration, new RegExp(`${table}_residential_complex_id_fkey`));
  assert.match(migration, /ACTIVE','ARCHIVED/);
  assert.match(migration, /ON DELETE RESTRICT/g);
  assert.doesNotMatch(migration, /DELETE FROM|TRUNCATE|DROP TABLE|UPDATE\s+\w+\s+SET|INSERT INTO/i);
});

test("registry backend provides normalized duplicate checks, lifecycle and audit", async () => {
  const service = await read("lib/residential-complexes.ts");
  assert.match(service, /replace\(\/\^жк/iu);
  assert.match(service, /POSSIBLE_DUPLICATE/);
  for (const action of ["RESIDENTIAL_COMPLEX_CREATED", "RESIDENTIAL_COMPLEX_UPDATED", "RESIDENTIAL_COMPLEX_ARCHIVED", "RESIDENTIAL_COMPLEX_RESTORED", "RESIDENTIAL_COMPLEX_RELATION_CHANGED"])
    assert.match(service, new RegExp(action));
  assert.doesNotMatch(service, /DELETE FROM residential_complexes/i);
});

test("0021 safely backfills many addresses and adds exact restrictive relations", async () => {
  const migration = await read("drizzle/postgres/0021_residential_complex_addresses.sql");
  assert.match(migration, /CREATE TABLE residential_complex_addresses/);
  assert.match(migration, /INSERT INTO residential_complex_addresses[\s\S]*FROM residential_complexes/);
  assert.match(migration, /Residential Complex address backfill failed/);
  assert.match(migration, /UNIQUE\(residential_complex_id, normalized_address\)/);
  assert.match(migration, /UNIQUE\(residential_complex_id, position\)/);
  for (const table of ["inspections", "design_projects", "renovation_order_details", "projects", "estimates"]) {
    assert.match(migration, new RegExp(`ALTER TABLE ${table} ADD COLUMN residential_complex_address_id`));
    assert.match(migration, new RegExp(`${table}_residential_complex_address_owner_fkey`));
  }
  assert.match(migration, /prevent_last_residential_complex_address_delete/);
  assert.match(migration, /ALTER TABLE residential_complexes DROP COLUMN address/);
  assert.match(migration, /ALTER TABLE residential_complexes DROP COLUMN district/);
  assert.doesNotMatch(migration, /DELETE FROM residential_complexes|DROP TABLE residential_complexes|TRUNCATE/i);
});

test("registry permissions protect directory API while selectors remain available in work modules", async () => {
  const [definitions, service, route] = await Promise.all([read("lib/permission-definitions.ts"), read("lib/residential-complexes.ts"), read("app/api/residential-complexes/route.ts")]);
  for (const permission of ["residentialComplexes.view", "residentialComplexes.create", "residentialComplexes.edit", "residentialComplexes.archive"])
    assert.match(definitions, new RegExp(permission.replaceAll(".", "\\.")));
  assert.match(service, /assertSelectorAccess/);
  assert.match(service, /assertActionPermission\(actor, "residentialComplexes\.view"\)/);
  assert.match(route, /getRequestUser/);
  assert.doesNotMatch(route, /export async function DELETE/);
});

test("Inspection, Design, Estimate and Project store the exact address id and preserve snapshot text", async () => {
  const [orders, design, estimates, projects] = await Promise.all([read("lib/orders.ts"), read("lib/design.ts"), read("lib/estimates.ts"), read("lib/projects.ts")]);
  for (const source of [orders, design, estimates, projects]) {
    assert.match(source, /residentialComplexId/);
    assert.match(source, /residentialComplexAddressId/);
    assert.match(source, /residential_complex_id/);
    assert.match(source, /residential_complex_address_id/);
    assert.match(source, /residential_complex/);
    assert.match(source, /resolveResidentialComplexLocation/);
  }
});

test("conversion flows transfer the registry id without creating duplicate complexes", async () => {
  const [design, projects, renovation] = await Promise.all([read("lib/design.ts"), read("lib/projects.ts"), read("app/renovation-order-card.tsx")]);
  assert.match(design, /sourceLocation/);
  assert.match(design, /inheritedLocation\?\.residential_complex_id/);
  assert.match(design, /inheritedLocation\?\.residential_complex_address_id/);
  assert.match(projects, /rod\.residential_complex_id/);
  assert.match(projects, /rod\.residential_complex_address_id/);
  assert.match(renovation, /residentialComplexId: details\.residentialComplexId/);
  assert.doesNotMatch(design, /createResidentialComplex/);
  assert.doesNotMatch(projects, /createResidentialComplex/);
});

test("directory, global search and reusable selector are connected without mock data", async () => {
  const [shell, directory, selector] = await Promise.all([read("app/depa-os.tsx"), read("app/residential-complexes-ui.tsx"), read("app/residential-complex-selector.tsx")]);
  assert.match(shell, /ResidentialComplexesScreen/);
  assert.match(shell, /ЖИЛЫЕ КОМПЛЕКСЫ/);
  assert.match(directory, /Архивировать ЖК/);
  assert.match(selector, /Добавить ЖК/);
  assert.match(selector, /Выбрать существующий/);
  assert.doesNotMatch(directory, /Novatoria|demo|mock/i);
});

test("order, Design and Project forms all use the shared selector", async () => {
  const [order, design, project] = await Promise.all([read("app/order-create-form.tsx"), read("app/design-order-card.tsx"), read("app/projects-ui.tsx")]);
  for (const source of [order, design, project]) assert.match(source, /ResidentialComplexFields/);
});
