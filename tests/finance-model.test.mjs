import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { cashboxDelta, investmentBalance, investmentMovementDelta, parseAmountKopecks, projectLedgerTotals, projectPurposeBalances, transferPreview, validateAllocations, validateExpense, validateInvestmentRepayment } from "../lib/finance-rules.ts";

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
  assert.match(validateExpense("PROJECT", "MATERIALS", null), /объект/i);
  assert.equal(validateExpense("PROJECT", "MATERIALS", "project_1"), null);
  assert.equal(validateExpense("ADMIN", "ADVERTISING", null), null);
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
  assert.match(finance, /FINANCIAL_TRANSACTION_CREATED/);
  assert.match(route, /getRequestUser/);
});

test("client material and works budgets stay separate and may become negative", () => {
  assert.deepEqual(projectPurposeBalances({ materialsIncomeKopecks: 50_000_000, materialsExpenseKopecks: 55_200_000, worksIncomeKopecks: 30_000_000, worksExpenseKopecks: 0 }), {
    materialsBalanceKopecks: -5_200_000,
    worksBalanceKopecks: 30_000_000,
  });
});

test("multi-project allocations must exactly match the source expense", () => {
  assert.equal(validateAllocations(9_000_000, [{ projectId: "sea", amountKopecks: 5_500_000 }, { projectId: "atmosphere", amountKopecks: 3_500_000 }]), null);
  assert.match(validateAllocations(9_000_000, [{ projectId: "sea", amountKopecks: 5_500_000 }, { projectId: "atmosphere", amountKopecks: 3_000_000 }]), /совпадать/i);
  assert.match(validateAllocations(9_000_000, [{ projectId: "sea", amountKopecks: 5_500_000 }, { projectId: "sea", amountKopecks: 3_500_000 }]), /два/iu);
});

test("finance writes, allocations, attachment link and reconciliation are atomic and audited", async () => {
  const [finance, migration, ui] = await Promise.all([read("lib/finance.ts"), read("drizzle/postgres/0005_finance_daily_operations.sql"), read("app/finance-ui.tsx")]);
  assert.match(finance, /TRANSACTION_ALLOCATION_CREATED/);
  assert.match(finance, /ATTACHMENT_LINKED/);
  assert.match(finance, /TRANSFER_CREATED/);
  assert.match(finance, /opening_balance_kopecks/);
  assert.match(migration, /financial_transactions_transfer_shape_check/);
  assert.match(ui, /Распределить между несколькими объектами/);
  assert.match(ui, /Осталось распределить/);
});

test("finance UI and dashboard use live API values instead of financial demo totals", async () => {
  const [dashboard, financeUi] = await Promise.all([read("app/depa-os.tsx"), read("app/finance-ui.tsx")]);
  assert.match(dashboard, /readFinance/);
  assert.match(dashboard, /finance\.physicalTotalKopecks/);
  assert.doesNotMatch(dashboard, /Расход без чека<\/strong><span>18 400/);
  assert.match(financeUi, /clientFundsKopecks/);
  assert.match(financeUi, /reconciliation/);
});

test("finance summary hides sensitive indicators without explicit permissions", async () => {
  const [financeUi, styles, finance] = await Promise.all([read("app/finance-ui.tsx"), read("app/globals.css"), read("lib/finance.ts")]);
  const summary = financeUi.match(/<div className="metrics-grid finance-metrics finance-summary">([\s\S]*?)<\/div>\n      \{data\.attentionItems/)?.[1] ?? "";
  assert.match(summary, /МОЯ КАССА/);
  assert.match(summary, /СРЕДСТВА КЛИЕНТОВ/);
  assert.match(summary, /ПРИБЫЛЬ DEPA/);
  assert.match(summary, /data\.capabilities\.viewClientFunds/);
  assert.match(summary, /data\.capabilities\.viewProfit/);
  assert.match(styles, /\.finance-summary\{grid-template-columns:repeat\(auto-fit/);
  assert.match(finance, /clientFundsKopecks: access\.actions\["finance\.viewClientFunds"\]/);
  assert.match(finance, /depaProfitKopecks: access\.actions\["finance\.viewProfit"\]/);
  assert.match(finance, /purpose='OTHER'/);
  assert.match(finance, /project\.otherIncomeKopecks/);
});

test("investment balance is contributions minus repayments and never permits an ordinary overpayment", () => {
  assert.equal(investmentMovementDelta("CONTRIBUTION") * 15_000_000, 15_000_000);
  assert.equal(investmentMovementDelta("REPAYMENT") * 5_000_000, -5_000_000);
  assert.equal(investmentBalance(15_000_000, 5_000_000), 10_000_000);
  assert.equal(validateInvestmentRepayment(10_000_000, 10_000_000), null);
  assert.match(validateInvestmentRepayment(10_000_000, 10_000_001), /превышает остаток инвестиции/i);
  assert.equal(cashboxDelta("INVESTMENT_REPAYMENT") * 5_000_000, -5_000_000);
});

test("investment-funded expense and repayment use distinct linked records without double-counting expense", async () => {
  const [finance, migration, schema, ui, permissions] = await Promise.all([
    read("lib/finance.ts"), read("drizzle/postgres/0022_investment_accounts.sql"), read("db/schema.ts"), read("app/finance-ui.tsx"), read("lib/permission-definitions.ts"),
  ]);
  assert.match(migration, /CREATE TABLE investment_accounts/);
  assert.match(migration, /id IN \('user_owner_denis','user_owner_pavel'\)/);
  assert.doesNotMatch(migration, /ELSE 'Инвестиция ' \|\| split_part/);
  assert.match(migration, /CREATE TABLE investment_movements/);
  assert.match(migration, /ALTER COLUMN cashbox_id DROP NOT NULL/);
  assert.match(migration, /investment_movements_transaction_unique/);
  assert.match(schema, /export const investmentAccounts/);
  assert.match(schema, /export const investmentMovements/);
  assert.match(finance, /const sourceDelta = personalExpense \? 0/);
  assert.match(finance, /INVESTMENT_REPAYMENT/);
  assert.match(finance, /INSERT INTO investment_movements/);
  assert.match(finance, /id IN \('user_owner_denis','user_owner_pavel'\)/);
  assert.match(finance, /type='EXPENSE'/);
  assert.doesNotMatch(finance, /type='EXPENSE'[^\n]*INVESTMENT_REPAYMENT/);
  assert.match(ui, /Операции<\/button>.*Кассы<\/button>.*Инвестиции<\/button>/s);
  assert.match(ui, /activeTab === "OPERATIONS" \? <div id="finance-operations-panel"[\s\S]*ClientPaymentInboxForm[\s\S]*Требует внимания[\s\S]*Все операции/);
  assert.match(ui, /activeTab === "CASHBOXES" \? <CashboxWorkspace/);
  assert.match(ui, /url\.pathname = "\/dashboard"/);
  assert.match(ui, /url\.searchParams\.set\("tab", financeTabSlugs\[nextTab\]\)/);
  assert.match(ui, /aria-expanded=\{account\.id === selectedId\}/);
  assert.match(ui, /const \[selectedId, setSelectedId\] = useState\(""\)/);
  assert.match(ui, /Дата<\/span><span>Тип<\/span><span>Описание<\/span><span>Связанный расход<\/span><span>Источник возврата<\/span><span>Сумма/);
  assert.match(ui, /Личные средства \/ Инвестиция/);
  assert.match(permissions, /finance\.viewInvestments/);
  assert.match(permissions, /finance\.repayInvestments/);
});
