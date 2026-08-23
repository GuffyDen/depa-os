import { randomUUID } from "node:crypto";

const SENSITIVE_KEY = /(?:password|passphrase|authorization|cookie|session|token|secret|credential|database_url|proof(?:data|content|binary)?|file(?:content|data)?|password_hash|password_salt|salt)/i;
const ALLOWED_REQUEST_ID = /^[A-Za-z0-9_-]{8,128}$/;

export function createRequestId(request) {
  const incoming = request?.headers?.get?.("x-request-id")?.trim();
  return incoming && ALLOWED_REQUEST_ID.test(incoming) ? incoming : randomUUID();
}

export function sanitizeLogValue(value, seen = new WeakSet()) {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.slice(0, 1000);
  if (value instanceof Error) return { name: value.name, message: value.message.slice(0, 1000), stack: value.stack?.slice(0, 4000) ?? null };
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeLogValue(item, seen));
  if (typeof value !== "object") return String(value).slice(0, 1000);
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  const result = {};
  for (const [key, item] of Object.entries(value)) result[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitizeLogValue(item, seen);
  seen.delete(value);
  return result;
}

export function emitStructuredLog(event, sink) {
  const payload = sanitizeLogValue({
    timestamp: new Date().toISOString(),
    level: "INFO",
    requestId: null,
    route: null,
    action: null,
    method: null,
    actorType: "SYSTEM",
    actorId: null,
    projectId: null,
    clientId: null,
    entityId: null,
    eventCode: "UNSPECIFIED",
    durationMs: 0,
    status: "SUCCESS",
    errorCode: null,
    ...event,
  });
  const output = JSON.stringify(payload);
  if (sink) sink(output, payload);
  else if (payload.level === "ERROR") console.error(output);
  else if (payload.level === "WARN") console.warn(output);
  else console.info(output);
  return payload;
}
