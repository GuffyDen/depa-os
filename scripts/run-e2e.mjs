import { spawnSync } from "node:child_process";
import pg from "pg";
import { assertTestDatabaseUrl } from "./test-db-guard.mjs";

const databaseUrl = process.env.DATABASE_URL;
assertTestDatabaseUrl(databaseUrl);
if (process.env.NODE_ENV !== "test") throw new Error("E2E requires NODE_ENV=test");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: process.cwd(), env: process.env, stdio: "inherit" });
  if (result.status !== 0) throw Object.assign(new Error(`${command} ${args.join(" ")} failed`), { status: result.status ?? 1 });
}

let testStatus = 0;
try {
  run("node", ["scripts/test-db.mjs", "reset"]);
  run("node", ["scripts/migrate-postgres.mjs"]);
  run("node", ["--experimental-strip-types", "--test", "tests/e2e/full-apartment-e2e.test.mjs"]);
} catch (error) {
  testStatus = error.status ?? 1;
} finally {
  run("node", ["scripts/test-db.mjs", "reset"]);
  run("node", ["scripts/migrate-postgres.mjs"]);
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const tables = ["leads", "clients", "residential_complexes", "orders", "inspections", "design_projects", "estimates", "contracts", "projects", "financial_transactions", "attachments", "audit_logs", "apartment_passports", "apartment_passport_versions", "apartment_passport_version_attachments"];
  const rows = await pool.query(`SELECT ${tables.map((table) => `(SELECT COUNT(*) FROM ${table})::int AS ${table}`).join(",")}`);
  await pool.end();
  const leftovers = Object.entries(rows.rows[0]).filter(([, count]) => count !== 0);
  if (leftovers.length) throw new Error(`E2E cleanup failed: ${JSON.stringify(leftovers)}`);
  console.log("E2E cleanup assertion passed: synthetic business records = 0.");
  run("node", ["scripts/migrate-postgres.mjs"]);
}
process.exitCode = testStatus;
