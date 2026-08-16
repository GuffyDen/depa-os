import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

type Statement = { text: string; params?: unknown[] };

let cachedUrl: string | undefined;
let cachedSql: NeonQueryFunction<false, false> | undefined;

function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  if (!cachedSql || cachedUrl !== url) {
    cachedUrl = url;
    cachedSql = neon(url);
  }
  return cachedSql;
}

export async function query<T extends Record<string, unknown>>(text: string, params: unknown[] = []) {
  return await sql().query(text, params) as T[];
}

export async function first<T extends Record<string, unknown>>(text: string, params: unknown[] = []) {
  return (await query<T>(text, params))[0] ?? null;
}

export async function transaction(statements: Statement[]) {
  return sql().transaction((tx) => statements.map((statement) => tx.query(statement.text, statement.params ?? [])));
}
