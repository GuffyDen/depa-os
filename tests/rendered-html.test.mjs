import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("DEPA OS is dark-first and uses the requested brand typography", async () => {
  const [globals, darkTheme, layout, login] = await Promise.all([
    read("app/globals.css"), read("app/dark-theme.css"), read("app/layout.tsx"), read("app/login/page.tsx"),
  ]);
  assert.match(globals, /--paper:#111111/);
  assert.match(globals, /--surface:#1b1b1b/);
  assert.match(globals, /--orange:#ff5a36/);
  assert.match(layout, /Manrope, Unbounded/);
  assert.match(darkTheme, /prefers-reduced-motion/);
  assert.match(login, /DEPA STROY/);
  assert.doesNotMatch(`${layout}${login}`, /DEPA Stroi/);
});

test("authentication keeps passwords server-side and protects internal routes", async () => {
  const [auth, loginRoute, passwordRoute, dashboard, client] = await Promise.all([
    read("lib/auth.ts"), read("app/api/auth/login/route.ts"), read("app/api/auth/password/route.ts"), read("app/dashboard/page.tsx"), read("app/depa-os.tsx"),
  ]);
  const source = `${auth}${loginRoute}${passwordRoute}${dashboard}${client}`;
  assert.match(auth, /PBKDF2/);
  assert.match(auth, /HttpOnly/);
  assert.match(auth, /token_hash/);
  assert.match(auth, /assertCanManageUser/);
  assert.match(dashboard, /redirect\("\/login"\)/);
  assert.doesNotMatch(source, /Denis123|Pavel123/);
  assert.doesNotMatch(client, /localStorage|sessionStorage/);
});

test("database migration enforces protected Owners and immutable audit records", async () => {
  const migration = await read("drizzle/0001_lucky_dracula.sql");
  assert.match(migration, /protect_owner_delete/);
  assert.match(migration, /protect_owner_identity_update/);
  assert.match(migration, /Protected Owner identity cannot be changed/);
  assert.match(migration, /audit_logs_immutable_update/);
  assert.match(migration, /audit_logs_immutable_delete/);
});
