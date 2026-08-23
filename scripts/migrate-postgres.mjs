import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createSqlClient } from "./sql-client.mjs";
import { assertTestDatabaseUrl } from "./test-db-guard.mjs";
import { ensureLegacyTestBaseline } from "./test-legacy-baseline.mjs";
import { createRequestId, emitStructuredLog } from "../lib/structured-logger.mjs";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not configured");
if (process.env.NODE_ENV === "test") assertTestDatabaseUrl(databaseUrl);

const sql = createSqlClient(databaseUrl);
const splitStatements = (source) => source.split("--> statement-breakpoint").map((statement) => statement.trim()).filter(Boolean);
const requestId = createRequestId();
const migrationStartedAt = performance.now();
let activeMigration = null;

try {
  await sql.query("CREATE TABLE IF NOT EXISTS depa_migrations (name text PRIMARY KEY, applied_at integer NOT NULL)");
  await ensureLegacyTestBaseline(sql);

  const migrationDirectory = resolve("drizzle/postgres");
  const migrationFiles = (await readdir(migrationDirectory)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
  const migrationNames = migrationFiles.map((fileName) => `drizzle/postgres/${fileName}`);
  if (process.argv.includes("--status")) {
    const appliedRows = await sql.query("SELECT name FROM depa_migrations WHERE name=ANY($1)", [migrationNames]);
    const appliedNames = new Set(appliedRows.map((row) => row.name));
    console.log(JSON.stringify({ applied: migrationNames.filter((name) => appliedNames.has(name)), pending: migrationNames.filter((name) => !appliedNames.has(name)) }, null, 2));
  } else {
    for (const [index, fileName] of migrationFiles.entries()) {
      const migrationName = migrationNames[index];
      activeMigration = migrationName;
      const applied = await sql.query("SELECT name FROM depa_migrations WHERE name=$1 LIMIT 1", [migrationName]);
      if (applied.length > 0) continue;
      const source = await readFile(resolve(migrationDirectory, fileName), "utf8");
      const statements = splitStatements(source).map((text) => ({ text }));
      statements.push({ text: "INSERT INTO depa_migrations(name,applied_at) VALUES($1,$2)", params: [migrationName, Math.floor(Date.now() / 1000)] });
      await sql.transaction(statements);
      console.log(`Applied ${migrationName}`);
    }
    console.log("PostgreSQL-first migrations are up to date.");
  }
} catch (error) {
  emitStructuredLog({ level: "ERROR", requestId, route: "scripts/migrate-postgres.mjs", action: "MIGRATION_RUNNER", method: "RUN", actorType: "SYSTEM", entityId: activeMigration, eventCode: "MIGRATION_RUNNER_FAILURE", durationMs: Math.round(performance.now() - migrationStartedAt), status: "FAILURE", errorCode: error instanceof Error ? error.name : "MIGRATION_UNKNOWN", error });
  throw error;
} finally { await sql.close(); }
