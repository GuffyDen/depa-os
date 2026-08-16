import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not configured");

const sql = neon(databaseUrl);
const legacyMigrations = [
  "drizzle/0000_clumsy_skrulls.sql",
  "drizzle/0001_lucky_dracula.sql",
  "drizzle/0002_personal_cashboxes.sql",
  "drizzle/0003_remove_finance_reference_mocks.sql",
];

await sql`CREATE TABLE IF NOT EXISTS depa_migrations (name text PRIMARY KEY, applied_at integer NOT NULL)`;
const legacyRows = await sql`SELECT name FROM depa_migrations WHERE name = ANY(${legacyMigrations})`;
const appliedLegacy = new Set(legacyRows.map((row) => row.name));
const missingLegacy = legacyMigrations.filter((name) => !appliedLegacy.has(name));
if (missingLegacy.length > 0) {
  throw new Error(`PostgreSQL baseline 0000-0003 is missing: ${missingLegacy.join(", ")}. This migrator never converts or reapplies legacy SQLite SQL.`);
}

const migrationDirectory = resolve("drizzle/postgres");
const migrationFiles = (await readdir(migrationDirectory)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
for (const fileName of migrationFiles) {
  const migrationName = `drizzle/postgres/${fileName}`;
  const applied = await sql`SELECT name FROM depa_migrations WHERE name=${migrationName} LIMIT 1`;
  if (applied.length > 0) continue;
  const source = await readFile(resolve(migrationDirectory, fileName), "utf8");
  const statements = source.split("--> statement-breakpoint").map((statement) => statement.trim()).filter(Boolean);
  await sql.transaction((tx) => [
    ...statements.map((statement) => tx.query(statement)),
    tx`INSERT INTO depa_migrations (name,applied_at) VALUES (${migrationName},${Math.floor(Date.now() / 1000)})`,
  ]);
  console.log(`Applied ${migrationName}`);
}

console.log("PostgreSQL-first migrations are up to date.");
