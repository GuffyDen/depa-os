import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CLIENT_SOURCES, normalizePhone } from "../lib/client-config.ts";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("client sources and phone normalization are centralized", () => {
  assert.deepEqual(CLIENT_SOURCES.map((item) => item.value), ["WEBSITE", "FARPOST", "AVITO", "REFERRAL", "OTHER"]);
  assert.equal(normalizePhone("+7 999 123-45-67"), "79991234567");
  assert.equal(normalizePhone("(423) 200 10 20"), "4232001020");
});

test("clients v1 uses real Neon data without a client mock list", async () => {
  const [app, ui, data] = await Promise.all([read("app/depa-os.tsx"), read("app/clients-ui.tsx"), read("lib/clients.ts")]);
  assert.doesNotMatch(app, /clients:\s*\{\s*eyebrow/);
  assert.match(app, /<ClientsScreen/);
  assert.match(ui, /\/api\/clients/);
  assert.match(data, /FROM clients c JOIN users/);
  assert.match(ui, /Клиентов пока нет/);
});

test("client list search, filters and pagination are applied in SQL", async () => {
  const data = await read("lib/clients.ts");
  assert.match(data, /c\.name ILIKE/);
  assert.match(data, /c\.phone_normalized LIKE/);
  assert.match(data, /c\.source=/);
  assert.match(data, /c\.responsible_user_id=/);
  assert.match(data, /LIMIT \$\{add\(limit \+ 1\)\} OFFSET/);
  assert.match(data, /nextOffset/);
});

test("client writes enforce permissions, assigned scope and immutable audit history", async () => {
  const [data, collectionRoute, detailRoute] = await Promise.all([read("lib/clients.ts"), read("app/api/clients/route.ts"), read("app/api/clients/[id]/route.ts")]);
  assert.match(data, /assertModuleAction\(actor, "clients", "clients\.create"\)/);
  assert.match(data, /assertModuleAction\(actor, "clients", "clients\.edit"\)/);
  assert.match(data, /access\.scopes\.clients !== "ALL"/);
  for (const event of ["CLIENT_CREATED", "CLIENT_UPDATED", "CLIENT_ARCHIVED", "CLIENT_RESTORED", "CLIENT_RESPONSIBLE_CHANGED"]) assert.match(data, new RegExp(event));
  assert.match(collectionRoute, /forceDuplicate/);
  assert.match(detailRoute, /ARCHIVE/);
  assert.doesNotMatch(`${collectionRoute}${detailRoute}`, /DELETE/);
});

test("clients migration extends the existing table with real user responsibility", async () => {
  const migration = await read("drizzle/postgres/0006_clients_v1.sql");
  assert.match(migration, /ALTER TABLE clients ADD COLUMN IF NOT EXISTS responsible_user_id/);
  assert.match(migration, /REFERENCES users\(id\)/);
  assert.match(migration, /phone_normalized/);
  assert.doesNotMatch(migration, /CREATE TABLE clients/);
  assert.doesNotMatch(migration, /UNIQUE.*phone/i);
});
