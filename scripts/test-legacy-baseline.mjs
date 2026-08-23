import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const legacyMigrations = [
  "drizzle/0000_clumsy_skrulls.sql",
  "drizzle/0001_lucky_dracula.sql",
  "drizzle/0002_personal_cashboxes.sql",
  "drizzle/0003_remove_finance_reference_mocks.sql",
];

const split = (source) => source.split("--> statement-breakpoint").map((statement) => statement.trim()).filter(Boolean);
function translateForCleanTestBootstrap(source) {
  return split(source)
    .filter((statement) => !/^PRAGMA\b/i.test(statement) && !/^CREATE TRIGGER\b/i.test(statement))
    .map((statement) => statement
      .replaceAll("`", '"')
      .replace(/DEFAULT\s+true/gi, "DEFAULT 1")
      .replace(/DEFAULT\s+false/gi, "DEFAULT 0")
      .replace(/CAST\(strftime\('%s','now'\) AS integer\)/gi, "CAST(EXTRACT(EPOCH FROM NOW()) AS integer)"));
}

export async function ensureLegacyTestBaseline(sql) {
  let rows = await sql.query("SELECT name FROM depa_migrations WHERE name = ANY($1)", [legacyMigrations]);
  let applied = new Set(rows.map((row) => row.name));
  let missing = legacyMigrations.filter((name) => !applied.has(name));
  if (missing.length === legacyMigrations.length) {
    const applicationTables = await sql.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name<>'depa_migrations'");
    if (applicationTables.length > 0) throw new Error("PostgreSQL baseline registry is empty but application tables already exist; refusing to infer or replay legacy migrations.");
    for (const migrationName of legacyMigrations) {
      const statements = translateForCleanTestBootstrap(await readFile(resolve(migrationName), "utf8")).map((text) => ({ text }));
      statements.push({ text: "INSERT INTO depa_migrations(name,applied_at) VALUES($1,$2)", params: [migrationName, Math.floor(Date.now() / 1000)] });
      await sql.transaction(statements);
      console.log(`Applied PostgreSQL-compatible legacy baseline ${migrationName}`);
    }
    rows = await sql.query("SELECT name FROM depa_migrations WHERE name = ANY($1)", [legacyMigrations]);
    applied = new Set(rows.map((row) => row.name));
    missing = legacyMigrations.filter((name) => !applied.has(name));
  }
  if (missing.length > 0) throw new Error(`PostgreSQL baseline 0000-0003 is partially registered: ${missing.join(", ")}. Refusing an unsafe partial replay.`);
}
