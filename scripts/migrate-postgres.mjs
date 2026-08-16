import { readFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not configured");

const sql = neon(databaseUrl);
const migrationFiles = ["drizzle/0000_clumsy_skrulls.sql", "drizzle/0001_lucky_dracula.sql", "drizzle/0002_personal_cashboxes.sql", "drizzle/0003_remove_finance_reference_mocks.sql"];

await sql`CREATE TABLE IF NOT EXISTS depa_migrations (
  name text PRIMARY KEY,
  applied_at integer NOT NULL
)`;

for (const file of migrationFiles) {
  const applied = await sql`SELECT name FROM depa_migrations WHERE name = ${file} LIMIT 1`;
  if (applied.length > 0) continue;

  const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
  const statements = source
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean)
    .filter((statement) => !statement.startsWith("PRAGMA "))
    .filter((statement) => !statement.startsWith("CREATE TRIGGER "))
    .map((statement) => statement
      .replaceAll("`", '"')
      .replace(/integer DEFAULT true/g, "integer DEFAULT 1")
      .replace(/integer DEFAULT false/g, "integer DEFAULT 0")
      .replace(/CAST\(strftime\('%s','now'\) AS integer\)/g, "CAST(EXTRACT(EPOCH FROM NOW()) AS integer)"));

  await sql.transaction((tx) => [
    ...statements.map((statement) => tx.query(statement)),
    tx`INSERT INTO depa_migrations (name, applied_at) VALUES (${file}, ${Math.floor(Date.now() / 1000)})`,
  ]);
}

await sql.transaction((tx) => [
  tx.query(`CREATE OR REPLACE FUNCTION protect_owner_delete_fn() RETURNS trigger AS $$
    BEGIN
      IF OLD.is_protected_owner = 1 THEN
        RAISE EXCEPTION 'Protected Owner cannot be deleted';
      END IF;
      RETURN OLD;
    END;
  $$ LANGUAGE plpgsql`),
  tx.query(`CREATE OR REPLACE FUNCTION protect_owner_identity_update_fn() RETURNS trigger AS $$
    BEGIN
      IF OLD.is_protected_owner = 1 AND (
        NEW.role IS DISTINCT FROM OLD.role OR
        NEW.status IS DISTINCT FROM OLD.status OR
        NEW.is_protected_owner IS DISTINCT FROM OLD.is_protected_owner OR
        NEW.username IS DISTINCT FROM OLD.username OR
        NEW.username_normalized IS DISTINCT FROM OLD.username_normalized OR
        NEW.employee_id IS DISTINCT FROM OLD.employee_id
      ) THEN
        RAISE EXCEPTION 'Protected Owner identity cannot be changed';
      END IF;
      RETURN NEW;
    END;
  $$ LANGUAGE plpgsql`),
  tx.query(`CREATE OR REPLACE FUNCTION audit_logs_immutable_fn() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'Audit Log is immutable';
    END;
  $$ LANGUAGE plpgsql`),
  tx.query("DROP TRIGGER IF EXISTS protect_owner_delete ON users"),
  tx.query("CREATE TRIGGER protect_owner_delete BEFORE DELETE ON users FOR EACH ROW EXECUTE FUNCTION protect_owner_delete_fn()"),
  tx.query("DROP TRIGGER IF EXISTS protect_owner_identity_update ON users"),
  tx.query("CREATE TRIGGER protect_owner_identity_update BEFORE UPDATE OF role, status, is_protected_owner, username, username_normalized, employee_id ON users FOR EACH ROW EXECUTE FUNCTION protect_owner_identity_update_fn()"),
  tx.query("DROP TRIGGER IF EXISTS audit_logs_immutable_update ON audit_logs"),
  tx.query("CREATE TRIGGER audit_logs_immutable_update BEFORE UPDATE ON audit_logs FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable_fn()"),
  tx.query("DROP TRIGGER IF EXISTS audit_logs_immutable_delete ON audit_logs"),
  tx.query("CREATE TRIGGER audit_logs_immutable_delete BEFORE DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable_fn()"),
]);

console.log("Postgres migrations are up to date.");
