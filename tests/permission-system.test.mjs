import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { emptyAccessProfile, ownerAccessProfile, profileFromPreset } from "../lib/permission-definitions.ts";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Owners receive immutable full effective access", () => {
  const owner = ownerAccessProfile();
  assert.equal(owner.isOwner, true);
  assert.ok(Object.values(owner.modules).every(Boolean));
  assert.ok(Object.values(owner.actions).every(Boolean));
  assert.ok(Object.values(owner.scopes).every((scope) => scope === "ALL"));
  assert.equal(owner.ownCashbox, true);
});

test("custom access is deny-by-default and presets remain editable snapshots", () => {
  const custom = emptyAccessProfile();
  assert.ok(Object.values(custom.modules).every((value) => value === false));
  assert.ok(Object.values(custom.actions).every((value) => value === false));
  const brigadier = profileFromPreset("FOREMAN");
  assert.equal(brigadier.modules.dashboard, true);
  assert.equal(brigadier.modules.crm, false);
  assert.equal(brigadier.modules.projects, true);
  assert.equal(brigadier.actions["finance.createExpense"], true);
  assert.equal(brigadier.actions["finance.createIncome"], false);
  assert.equal(brigadier.actions["finance.createTransfer"], true);
  assert.equal(brigadier.actions["finance.viewProfit"], false);
  assert.equal(brigadier.scopes.cashboxes, "OWN");
  brigadier.modules.crm = true;
  assert.equal(profileFromPreset("FOREMAN").modules.crm, false);
  const accountant = profileFromPreset("ACCOUNTANT");
  assert.equal(accountant.scopes.cashboxes, "ALL");
  assert.equal(accountant.actions["finance.viewProfit"], true);
});

test("finance writes are hard-bound to the current user's cashbox", async () => {
  const [finance, ui] = await Promise.all([read("lib/finance.ts"), read("app/finance-ui.tsx")]);
  assert.match(finance, /row\.owner_user_id !== actor\.id/);
  assert.match(finance, /ownCashboxForWrite\(actor, cashboxId\)/);
  assert.match(finance, /destinationCashbox = await cashboxById\(destinationId, true\)/);
  assert.match(ui, /readOnly/);
  assert.match(ui, /result\.transferRecipients/);
  assert.doesNotMatch(finance, /actor\.role !== "OWNER" && type !== "EXPENSE"/);
});

test("module menu, direct routes and API reads share server permissions", async () => {
  const [client, page, api, moduleData, dashboard] = await Promise.all([
    read("app/depa-os.tsx"), read("app/[module]/page.tsx"), read("app/api/[module]/route.ts"), read("lib/module-data.ts"), read("app/dashboard/page.tsx"),
  ]);
  assert.match(client, /access\.modules\[moduleBySection\[item\.id\]\]/);
  assert.match(page, /hasModuleAccess/);
  assert.match(api, /getModuleData/);
  assert.match(moduleData, /assertModuleAction/);
  assert.match(moduleData, /user_project_access/);
  assert.match(dashboard, /accessDenied/);
});

test("permission changes, presets, cashboxes and access state are audited", async () => {
  const team = await read("lib/team-access.ts");
  for (const event of ["EMPLOYEE_CREATED", "EMPLOYEE_ACCESS_ENABLED", "EMPLOYEE_ACCESS_DISABLED", "EMPLOYEE_PERMISSION_CHANGED", "EMPLOYEE_CASHBOX_CREATED", "EMPLOYEE_CASHBOX_DEACTIVATED", "EMPLOYEE_PRESET_APPLIED"]) assert.match(team, new RegExp(event));
  assert.match(team, /oldValue/);
  assert.match(team, /newValue/);
  assert.match(team, /targetUserId/);
  assert.match(team, /target\.role === "OWNER"/);
});

test("legacy finance flags are read compatibly without a production data migration", async () => {
  const permissions = await read("lib/permissions.ts");
  assert.match(permissions, /FINANCE_ACCESS:COMPANY/);
  assert.match(permissions, /OWN_CASHBOX:COMPANY/);
  assert.match(permissions, /Read-only compatibility/);
});
