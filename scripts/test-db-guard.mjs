const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function assertTestDatabaseUrl(rawUrl = process.env.DATABASE_URL) {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Refusing test database operation: NODE_ENV must equal test.");
  }
  if (!rawUrl) throw new Error("Refusing test database operation: DATABASE_URL is missing.");
  const url = new URL(rawUrl);
  const database = url.pathname.replace(/^\//, "");
  if (!LOOPBACK_HOSTS.has(url.hostname) || !database.startsWith("depa_os_test")) {
    throw new Error(`Refusing test database operation for non-isolated target ${url.hostname}/${database}.`);
  }
  return { url, database };
}

export function isLocalPostgresUrl(rawUrl) {
  if (!rawUrl) return false;
  try { return LOOPBACK_HOSTS.has(new URL(rawUrl).hostname); }
  catch { return false; }
}
