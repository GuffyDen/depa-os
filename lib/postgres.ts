import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { Pool, type PoolClient } from "pg";

type Statement = { text: string; params?: unknown[] };

let cachedUrl: string | undefined;
let cachedSql: NeonQueryFunction<false, false> | undefined;
let cachedPool: Pool | undefined;

function shouldUseLocalDriver(url: string) {
  if (process.env.DATABASE_DRIVER === "pg") return true;
  try { return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(url).hostname); }
  catch { return false; }
}

function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  if (!cachedSql || cachedUrl !== url) {
    cachedUrl = url;
    cachedSql = neon(url);
  }
  return cachedSql;
}

function pool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  if (!cachedPool || cachedUrl !== url) {
    cachedUrl = url;
    cachedPool = new Pool({ connectionString: url, max: 10 });
  }
  return cachedPool;
}

export async function query<T extends Record<string, unknown>>(text: string, params: unknown[] = []) {
  const url = process.env.DATABASE_URL;
  if (url && shouldUseLocalDriver(url)) return (await pool().query(text, params)).rows as T[];
  return await sql().query(text, params) as T[];
}

export async function first<T extends Record<string, unknown>>(text: string, params: unknown[] = []) {
  return (await query<T>(text, params))[0] ?? null;
}

export async function transaction(statements: Statement[]) {
  const url = process.env.DATABASE_URL;
  if (url && shouldUseLocalDriver(url)) {
    const client = await pool().connect();
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
  }
  return sql().transaction((tx) => statements.map((statement) => tx.query(statement.text, statement.params ?? [])));
}

export async function withTransaction<T>(callback: (client: PoolClient) => Promise<T>) {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
