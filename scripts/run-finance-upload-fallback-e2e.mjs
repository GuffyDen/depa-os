import { spawnSync } from "node:child_process";
import { assertTestDatabaseUrl } from "./test-db-guard.mjs";

assertTestDatabaseUrl(process.env.DATABASE_URL);
if (process.env.NODE_ENV !== "test") throw new Error("Finance upload fallback E2E requires NODE_ENV=test");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: process.cwd(), env: process.env, stdio: "inherit" });
  if (result.status !== 0) throw Object.assign(new Error(`${command} ${args.join(" ")} failed`), { status: result.status ?? 1 });
}

let testStatus = 0;
try {
  run("node", ["scripts/test-db.mjs", "reset"]);
  run("node", ["scripts/migrate-postgres.mjs"]);
  run("./node_modules/.bin/esbuild", ["tests/e2e/finance-upload-fallback-e2e.mjs", "--bundle", "--platform=node", "--format=esm", "--packages=external", "--outfile=.next/depa-finance-upload-fallback-e2e.mjs"]);
  run("node", [".next/depa-finance-upload-fallback-e2e.mjs"]);
} catch (error) {
  testStatus = error.status ?? 1;
} finally {
  run("node", ["scripts/test-db.mjs", "reset"]);
  run("node", ["scripts/migrate-postgres.mjs"]);
}
process.exitCode = testStatus;
