import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createSqlClient } from "./sql-client.mjs";
import { assertTestDatabaseUrl } from "./test-db-guard.mjs";

const EXPECTED_HASH = "3c487305e0969a97f2707417c09972a10696988629b234b46408cdd715a8e07c";
const MIGRATION_NAME = "drizzle/postgres/0016_client_portal_payments_v1.sql";
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not configured");
const source = await readFile(new URL(`../${MIGRATION_NAME}`, import.meta.url), "utf8");
const hash = createHash("sha256").update(source).digest("hex");
if (hash !== EXPECTED_HASH) throw new Error(`0016 SHA-256 mismatch: expected ${EXPECTED_HASH}, received ${hash}.`);

const expectedTables = [...source.matchAll(/CREATE TABLE\s+(\w+)/g)].map((match) => match[1]);
const expectedIndexes = [...source.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(\w+)\s+ON\s+(\w+)/g)].map((match) => ({ name: match[1], table: match[2] }));
const expectedConstraints = [...source.matchAll(/CONSTRAINT\s+(\w+)/g)].map((match) => match[1]);
const expectedColumns = [];
for (const match of source.matchAll(/CREATE TABLE\s+(\w+)\s*\(([\s\S]*?)\);/g)) {
  for (const line of match[2].split("\n")) {
    const column = line.trim().match(/^(\w+)\s+(?:text|integer|jsonb)\b/i)?.[1];
    if (column && column.toUpperCase() !== "CONSTRAINT") expectedColumns.push({ table: match[1], column });
  }
}
for (const match of source.matchAll(/ALTER TABLE\s+(\w+)\s+ADD COLUMN\s+(\w+)/g)) expectedColumns.push({ table: match[1], column: match[2] });

const sql = createSqlClient(databaseUrl);
try {
  const tables = await sql.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
  const columns = await sql.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'");
  const constraints = await sql.query("SELECT conname FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public'");
  const indexes = await sql.query("SELECT tablename,indexname FROM pg_indexes WHERE schemaname='public'");
  const registry = await sql.query("SELECT name,applied_at FROM depa_migrations WHERE name=$1", [MIGRATION_NAME]);
  const tableSet = new Set(tables.map((row) => row.table_name));
  const columnSet = new Set(columns.map((row) => `${row.table_name}.${row.column_name}`));
  const constraintSet = new Set(constraints.map((row) => row.conname));
  const indexSet = new Set(indexes.map((row) => `${row.tablename}.${row.indexname}`));
  const missing = {
    tables: expectedTables.filter((table) => !tableSet.has(table)),
    columns: expectedColumns.filter(({ table, column }) => !columnSet.has(`${table}.${column}`)),
    constraints: expectedConstraints.filter((name) => !constraintSet.has(name)),
    indexes: expectedIndexes.filter(({ name, table }) => !indexSet.has(`${table}.${name}`)),
  };
  if (Object.values(missing).some((items) => items.length > 0)) {
    console.error(JSON.stringify({ migration: MIGRATION_NAME, hash, registry, missing }, null, 2));
    throw new Error("Production schema does not fully match migration 0016; registry repair is forbidden.");
  }
  const execute = process.argv.includes("--execute");
  if (execute && registry.length === 0) {
    if (process.env.NODE_ENV === "test") assertTestDatabaseUrl(databaseUrl);
    else if (process.env.ALLOW_0016_REGISTRY_REPAIR !== EXPECTED_HASH) throw new Error("Production registry repair requires explicit hash confirmation in ALLOW_0016_REGISTRY_REPAIR.");
    await sql.query("INSERT INTO depa_migrations(name,applied_at) VALUES($1,$2)", [MIGRATION_NAME, Math.floor(Date.now() / 1000)]);
  }
  console.log(JSON.stringify({ migration: MIGRATION_NAME, hash, schemaMatches: true, registryBefore: registry.length, repaired: execute && registry.length === 0 }, null, 2));
} finally { await sql.close(); }
