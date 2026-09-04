import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { countOpenFinanceAttentionIssues, deriveFinanceAttentionStatus, financeAttentionAcceptanceAllowed } from "../lib/finance-attention.ts";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("A. expense without a linked receipt derives an OPEN issue", () => {
  assert.equal(deriveFinanceAttentionStatus(true, null), "OPEN");
});

test("B. accepted receipt issue is no longer active attention", () => {
  assert.equal(deriveFinanceAttentionStatus(true, "ACCEPTED"), "ACCEPTED");
  assert.equal(countOpenFinanceAttentionIssues([{ status: "ACCEPTED" }]), 0);
});

test("C. active counter decreases after acceptance", () => {
  assert.equal(countOpenFinanceAttentionIssues([{ status: "OPEN" }, { status: "OPEN" }]), 2);
  assert.equal(countOpenFinanceAttentionIssues([{ status: "ACCEPTED" }, { status: "OPEN" }]), 1);
});

test("D. attention transition never updates financial balances or transactions", async () => {
  const finance = await read("lib/finance.ts");
  const transition = finance.slice(finance.indexOf("export async function updateFinanceAttentionIssue"), finance.indexOf("export async function updateFinanceOperation"));
  assert.doesNotMatch(transition, /UPDATE cashboxes|UPDATE investment_accounts|UPDATE investment_movements|UPDATE financial_transactions SET|amount_kopecks\s*=/i);
  assert.match(transition, /finance_attention_acknowledgements/);
});

test("E. optional acceptance comment is persisted and rendered", async () => {
  const [migration, finance, ui] = await Promise.all([read("drizzle/postgres/0023_finance_attention_acknowledgements.sql"), read("lib/finance.ts"), read("app/finance-ui.tsx")]);
  assert.match(migration, /acceptance_comment text/);
  assert.match(finance, /acceptance_comment=EXCLUDED\.acceptance_comment/);
  assert.match(ui, /Причина: \{receiptIssue\.comment\}/);
  assert.match(ui, /placeholder="Чек не выдавался"/);
});

test("F. acceptance creates the required audit event with previous state", async () => {
  const finance = await read("lib/finance.ts");
  assert.match(finance, /EXPENSE_WITHOUT_RECEIPT_ACCEPTED/);
  assert.match(finance, /transactionId, issueType, acceptedBy:[\s\S]*acceptedAt:[\s\S]*comment, previousState, nextState/);
});

test("G. accepted issue can be reverted without deleting its history row", async () => {
  const [finance, ui] = await Promise.all([read("lib/finance.ts"), read("app/finance-ui.tsx")]);
  assert.match(finance, /EXPENSE_WITHOUT_RECEIPT_ACCEPTANCE_REVERTED/);
  assert.match(finance, /SET status='OPEN',previous_status='ACCEPTED',reverted_by_user_id=/);
  assert.doesNotMatch(finance.slice(finance.indexOf("export async function updateFinanceAttentionIssue"), finance.indexOf("export async function updateFinanceOperation")), /DELETE FROM finance_attention_acknowledgements/);
  assert.match(ui, /Вернуть в Требует внимания/);
});

test("H. reverted issue returns to OPEN attention", () => {
  assert.equal(deriveFinanceAttentionStatus(true, "OPEN"), "OPEN");
  assert.equal(countOpenFinanceAttentionIssues([{ status: "OPEN" }]), 1);
});

test("I. linked receipt resolves even a previously accepted issue", () => {
  assert.equal(deriveFinanceAttentionStatus(false, "ACCEPTED"), "RESOLVED");
});

test("J. accepted and resolved issues are excluded from active count", () => {
  assert.equal(countOpenFinanceAttentionIssues([{ status: "OPEN" }, { status: "ACCEPTED" }, { status: "RESOLVED" }]), 1);
});

test("K. employees need the existing finance edit permission", async () => {
  const finance = await read("lib/finance.ts");
  const transition = finance.slice(finance.indexOf("async function financeTransactionForAttention"), finance.indexOf("export async function updateFinanceOperation"));
  assert.match(transition, /assertModuleAction\(actor, "finance", "finance\.editTransaction"\)/);
  assert.match(transition, /Нет права принимать финансовые замечания/);
});

test("L. every issue type explicitly declares whether acceptance is allowed", async () => {
  const finance = await read("lib/finance.ts");
  assert.equal(financeAttentionAcceptanceAllowed("MISSING_RECEIPT"), true);
  assert.equal(financeAttentionAcceptanceAllowed("UNALLOCATED_EXPENSE"), false);
  assert.equal(financeAttentionAcceptanceAllowed("NEGATIVE_CASHBOX"), false);
  assert.match(finance, /if \(!financeAttentionAcceptanceAllowed\(issueType\)\)/);
});

test("migration is additive and leaves existing missing-receipt expenses OPEN", async () => {
  const migration = await read("drizzle/postgres/0023_finance_attention_acknowledgements.sql");
  assert.match(migration, /CREATE TABLE finance_attention_acknowledgements/);
  assert.doesNotMatch(migration, /INSERT INTO finance_attention_acknowledgements|UPDATE financial_transactions|UPDATE cashboxes|UPDATE investment/);
});

test("attention API requires authentication and uses the guarded domain transition", async () => {
  const route = await read("app/api/finance/attention/route.ts");
  assert.match(route, /getRequestUser/);
  assert.match(route, /updateFinanceAttentionIssue/);
  assert.match(route, /status: 401/);
});
