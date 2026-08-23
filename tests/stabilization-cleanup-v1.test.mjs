import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createRequestId, emitStructuredLog, sanitizeLogValue } from "../lib/structured-logger.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("structured logger creates or safely propagates request IDs", () => {
  const trusted = new Request("https://depa.test/api", { headers: { "X-Request-ID": "req_ABC12345" } });
  assert.equal(createRequestId(trusted), "req_ABC12345");
  const generated = createRequestId(new Request("https://depa.test/api", { headers: { "X-Request-ID": "bad id with spaces" } }));
  assert.match(generated, /^[0-9a-f-]{36}$/i);
});

test("structured logger emits required success and failure fields", () => {
  const captured = [];
  emitStructuredLog({ requestId: "req_12345678", route: "/api/finance", action: "FINANCE_MUTATION", method: "POST", actorType: "EMPLOYEE", actorId: "user-1", eventCode: "EXPENSE_SUCCESS", durationMs: 12, status: "SUCCESS" }, (_line, payload) => captured.push(payload));
  emitStructuredLog({ requestId: "req_12345678", route: "/api/finance", action: "FINANCE_MUTATION", method: "POST", actorType: "EMPLOYEE", actorId: "user-1", eventCode: "EXPENSE_FAILURE", durationMs: 14, status: "FAILURE", level: "ERROR", errorCode: "FINANCE_400" }, (_line, payload) => captured.push(payload));
  assert.equal(captured.length, 2);
  for (const event of captured) for (const field of ["timestamp", "level", "requestId", "route", "action", "method", "actorType", "actorId", "projectId", "clientId", "entityId", "eventCode", "durationMs", "status", "errorCode"]) assert.ok(field in event, `missing ${field}`);
  assert.equal(captured[0].status, "SUCCESS");
  assert.equal(captured[1].status, "FAILURE");
});

test("structured logger redacts credentials, sessions, proof and file content", () => {
  const safe = sanitizeLogValue({ username: "owner", password: "NeverLogMe", authorization: "Bearer secret", cookie: "depa_session=secret", inviteToken: "invite-secret", proofData: "binary-proof", fileContent: "full-file", nested: { passwordHash: "hash", passwordSalt: "salt" } });
  const serialized = JSON.stringify(safe);
  assert.doesNotMatch(serialized, /NeverLogMe|Bearer secret|depa_session=secret|invite-secret|binary-proof|full-file|"hash"|"salt"/);
  assert.match(serialized, /\[REDACTED\]/);
  assert.equal(safe.username, "owner");
});

test("critical auth and client payment routes use central request logging", async () => {
  const [employeeAuth, clientAuth, payments, logger] = await Promise.all([read("app/api/auth/login/route.ts"), read("app/api/client/auth/login/route.ts"), read("app/api/client-payments/route.ts"), read("lib/request-logger.ts")]);
  assert.match(employeeAuth, /EMPLOYEE_AUTH_FAILURE/);
  assert.match(clientAuth, /CLIENT_AUTH_FAILURE/);
  assert.match(payments, /CLIENT_PAYMENT_CONFIRMATION_SUCCESS/);
  assert.match(payments, /claimId/);
  assert.match(payments, /projectId/);
  assert.doesNotMatch(payments, /proofData|proofContent|cookie|authorization/i);
  assert.match(logger, /X-Request-ID/);
  assert.doesNotMatch(`${employeeAuth}${clientAuth}`, /log\.(?:success|failure)\([^\n]*body\.password/);
});

test("production business input no longer uses browser prompt", async () => {
  const sources = await Promise.all(["app/crm-ui.tsx", "app/contracts-ui.tsx", "app/estimates-ui.tsx", "app/production-core-ui.tsx"].map(read));
  assert.doesNotMatch(sources.join("\n"), /window\.prompt/);
  assert.match(sources.join("\n"), /StructuredActionDialog/);
  const dialog = await read("app/structured-action-dialog.tsx");
  const css = await read("app/globals.css");
  assert.match(dialog, /if \(saving\) return/);
  assert.match(dialog, /disabled=\{saving\}/);
  assert.match(dialog, /role="alert"/);
  assert.match(dialog, /type="button" disabled=\{saving\} onClick=\{onClose\}>Отмена/);
  assert.match(css, /max-width:600px[\s\S]*align-items:flex-end/);
});

test("internal navigation uses Next router without location.assign warnings", async () => {
  const source = `${await read("app/depa-os.tsx")}\n${await read("app/login/login-form.tsx")}\n${await read("app/orders-ui.tsx")}`;
  assert.doesNotMatch(source, /window\.location\.assign/);
  assert.match(source, /useRouter/);
  assert.match(source, /router\.push/);
});
