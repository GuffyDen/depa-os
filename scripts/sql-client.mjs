import { neon } from "@neondatabase/serverless";
import pg from "pg";
import { isLocalPostgresUrl } from "./test-db-guard.mjs";

export function createSqlClient(databaseUrl) {
  if (process.env.DATABASE_DRIVER === "pg" || isLocalPostgresUrl(databaseUrl)) {
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
    return {
      query: async (text, params = []) => (await pool.query(text, params)).rows,
      transaction: async (statements) => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const results = [];
          for (const statement of statements) results.push((await client.query(statement.text, statement.params ?? [])).rows);
          await client.query("COMMIT");
          return results;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally { client.release(); }
      },
      close: () => pool.end(),
    };
  }
  const sql = neon(databaseUrl);
  return {
    query: (text, params = []) => sql.query(text, params),
    transaction: (statements) => sql.transaction((tx) => statements.map((statement) => tx.query(statement.text, statement.params ?? []))),
    close: async () => undefined,
  };
}
