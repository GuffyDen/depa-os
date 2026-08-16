import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { cashboxDelta, parseAmountKopecks, projectLedgerTotals, transferPreview, validateExpense } from "../lib/finance-rules.ts";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("transfer is one balanced operation and may make the source negative", () => {
  assert.deepEqual(transferPreview(50_000_000, 5_000_000, 10_000_000), { fromAfterKopecks: 40_000_000, toAfterKopecks: 15_000_000, warning: null });
  assert.equal(cashboxDelta("TRANSFER", "SOURCE") + cashboxDelta("TRANSFER", "DESTINATION"), 0);
  assert.equal(transferPreview(5_000_000, 0, 7_000_000).fromAfterKopecks, -2_000_000);
  assert.ok(transferPreview(5_000_000, 0, 7_000_000).warning);
});

test("expenses require a positive amount and project expenses require an object", () => {
  assert.equal(parseAmountKopecks("38 000"), 3_800_000);
  assert.equal(parseAmountKopecks("0"), null);
  assert.equal(parseAmountKopecks("-10"), null);
  assert.match(validateExpense("PROJECT", "Материалы", null), /объект/i);
  assert.equal(validateExpense("PROJECT", "Материалы", "project_1"), null);
  assert.equal(validateExpense("ADMIN", "Реклама", null), null);
  assert.equal(cashboxDelta("EXPENSE") * 3_800_000, -3_800_000);
});

test("refund is positive, linked to the original expense, and common cashbox is retired", async () => {
  const [finance, migration, client] = await Promise.all([read("lib/finance.ts"), read("drizzle/0002_personal_cashboxes.sql"), read("app/depa-os.tsx")]);
  assert.equal(cashboxDelta("REFUND"), 1);
  assert.deepEqual(projectLedgerTotals(10_000_000, 8_000_000, 1_500_000), { actualExpenseKopecks: 6_500_000, clientBalanceKopecks: 3_500_000 });
  assert.match(finance, /original_transaction_id/);
  assert.match(finance, /Сумма возврата превышает остаток исходного расхода/);
  assert.match(migration, /lower\(`name`\) LIKE '%общ%'/);
  assert.doesNotMatch(client, /Общая касса/);
});

test("cashbox access is Owner-managed and deactivation preserves history", async () => {
  const [finance, route] = await Promise.all([read("lib/finance.ts"), read("app/api/team/finance-access/route.ts")]);
  assert.match(finance, /Только Owner управляет правами сотрудников/);
  assert.match(finance, /status='INACTIVE'/);
  assert.doesNotMatch(finance, /DELETE FROM cashboxes|DELETE FROM financial_transactions/);
  assert.match(finance, /requiresConfirmation/);
  assert.match(route, /setTeamFinanceAccess/);
});

test("live finance API enforces personal visibility for employees and audits every operation", async () => {
  const [finance, route] = await Promise.all([read("lib/finance.ts"), read("app/api/finance/route.ts")]);
  assert.match(finance, /source_box\.owner_user_id = \$1 OR destination_box\.owner_user_id = \$1/);
  assert.match(finance, /FINANCE_\$\{type\}_CREATED/);
  assert.match(route, /getRequestUser/);
});
