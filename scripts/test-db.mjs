import pg from "pg";
import { assertTestDatabaseUrl } from "./test-db-guard.mjs";

const action = process.argv[2];
if (!["up", "reset", "down"].includes(action)) throw new Error("Usage: test-db.mjs <up|reset|down>");
const { url, database } = assertTestDatabaseUrl();
const adminUrl = new URL(url);
adminUrl.pathname = "/postgres";
const client = new pg.Client({ connectionString: adminUrl.toString() });
await client.connect();
try {
  const exists = Number((await client.query("SELECT COUNT(*)::int count FROM pg_database WHERE datname=$1", [database])).rows[0].count) === 1;
  if (action === "down" || action === "reset") {
    if (exists) {
      await client.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()", [database]);
      await client.query(`DROP DATABASE "${database.replaceAll('"', '""')}"`);
      console.log(`Dropped isolated test database ${database}.`);
    }
  }
  if (action === "up" || action === "reset") {
    await client.query(`CREATE DATABASE "${database.replaceAll('"', '""')}"`);
    console.log(`Created isolated test database ${database}.`);
  }
} finally { await client.end(); }
