import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl, "DATABASE_URL is required");
assert.equal(process.env.NODE_ENV, "test", "Integration tests must only run with NODE_ENV=test");
const parsed = new URL(databaseUrl);
assert.ok(["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname));
assert.match(parsed.pathname.slice(1), /^depa_os_test(?:_|$)/);

const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
const stamp = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const ids = {
  employee: `itest_investment_employee_${stamp}`,
  user: `itest_investment_user_${stamp}`,
  cashbox: `itest_investment_cashbox_${stamp}`,
  account: `itest_investment_account_${stamp}`,
  expense: `itest_investment_expense_${stamp}`,
  contribution: `itest_investment_contribution_${stamp}`,
  repayment: `itest_investment_repayment_${stamp}`,
};
const now = Math.floor(Date.now() / 1000);

async function inTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

test.before(async () => {
  await pool.query("INSERT INTO employees(id,full_name,status,created_at,updated_at) VALUES($1,'Investment Owner','ACTIVE',$2,$2)", [ids.employee, now]);
  await pool.query("INSERT INTO users(id,employee_id,auth_provider,username,username_normalized,display_name,role,status,is_protected_owner,created_at,updated_at) VALUES($1,$2,'LOCAL',$3,$3,'Investment Owner','OWNER','ACTIVE',0,$4,$4)", [ids.user, ids.employee, ids.user, now]);
  await pool.query("INSERT INTO cashboxes(id,owner_user_id,owner_employee_id,name,type,currency,is_active,status,balance_kopecks,opening_balance_kopecks,created_at,updated_at) VALUES($1,$2,$3,'Investment Test Cashbox','PERSONAL','RUB',1,'ACTIVE',30000000,30000000,$4,$4)", [ids.cashbox, ids.user, ids.employee, now]);
  await pool.query("INSERT INTO investment_accounts(id,owner_user_id,name,currency,status,created_at,updated_at) VALUES($1,$2,'Investment Test Account','RUB','ACTIVE',$3,$3)", [ids.account, ids.user, now]);
});

async function cleanup() {
  await pool.query("DELETE FROM investment_movements WHERE investment_account_id=$1", [ids.account]);
  await pool.query("DELETE FROM financial_transactions WHERE author_user_id=$1", [ids.user]);
  await pool.query("DELETE FROM investment_accounts WHERE id=$1", [ids.account]);
  await pool.query("DELETE FROM cashboxes WHERE id=$1", [ids.cashbox]);
  await pool.query("DELETE FROM users WHERE id=$1", [ids.user]);
  await pool.query("DELETE FROM employees WHERE id=$1", [ids.employee]);
}

test.after(async () => { await cleanup(); await pool.end(); });

test("personal expense raises investment without changing cash and repayment does not duplicate expense", async () => {
  await inTransaction(async (client) => {
    await client.query("INSERT INTO financial_transactions(id,amount_kopecks,transaction_date,type,expense_type,author_user_id,cashbox_id,investment_account_id,category,title,show_to_client,created_at,updated_at) VALUES($1,15000000,$2,'EXPENSE','ADMIN',$3,NULL,$4,'OFFICE','Office furniture',0,$2,$2)", [ids.expense, now, ids.user, ids.account]);
    await client.query("INSERT INTO investment_movements(id,investment_account_id,financial_transaction_id,type,amount_kopecks,transaction_date,source_cashbox_id,created_by_user_id,created_at,updated_at) VALUES($1,$2,$3,'CONTRIBUTION',15000000,$4,NULL,$5,$4,$4)", [ids.contribution, ids.account, ids.expense, now, ids.user]);
  });
  let facts = await pool.query(`SELECT
    (SELECT balance_kopecks FROM cashboxes WHERE id=$1)::int cash,
    (SELECT COALESCE(SUM(amount_kopecks),0) FROM financial_transactions WHERE author_user_id=$2 AND type='EXPENSE')::int expenses,
    (SELECT COALESCE(SUM(CASE WHEN type='CONTRIBUTION' THEN amount_kopecks ELSE -amount_kopecks END),0) FROM investment_movements WHERE investment_account_id=$3)::int outstanding`, [ids.cashbox, ids.user, ids.account]);
  assert.deepEqual(facts.rows[0], { cash: 30000000, expenses: 15000000, outstanding: 15000000 });

  await inTransaction(async (client) => {
    await client.query("SELECT id FROM cashboxes WHERE id=$1 FOR UPDATE", [ids.cashbox]);
    await client.query("SELECT id FROM investment_accounts WHERE id=$1 FOR UPDATE", [ids.account]);
    await client.query("INSERT INTO financial_transactions(id,amount_kopecks,transaction_date,type,author_user_id,cashbox_id,investment_account_id,category,title,show_to_client,created_at,updated_at) VALUES($1,5000000,$2,'INVESTMENT_REPAYMENT',$3,$4,$5,'INVESTMENT_REPAYMENT','Investment repayment',0,$2,$2)", [ids.repayment, now + 1, ids.user, ids.cashbox, ids.account]);
    await client.query("UPDATE cashboxes SET balance_kopecks=balance_kopecks-5000000 WHERE id=$1", [ids.cashbox]);
    await client.query("INSERT INTO investment_movements(id,investment_account_id,financial_transaction_id,type,amount_kopecks,transaction_date,source_cashbox_id,created_by_user_id,created_at,updated_at) VALUES($1,$2,$3,'REPAYMENT',5000000,$4,$5,$6,$4,$4)", [`itest_investment_repayment_movement_${stamp}`, ids.account, ids.repayment, now + 1, ids.cashbox, ids.user]);
  });
  facts = await pool.query(`SELECT
    (SELECT balance_kopecks FROM cashboxes WHERE id=$1)::int cash,
    (SELECT COALESCE(SUM(amount_kopecks),0) FROM financial_transactions WHERE author_user_id=$2 AND type='EXPENSE')::int expenses,
    (SELECT COALESCE(SUM(CASE WHEN type='CONTRIBUTION' THEN amount_kopecks ELSE -amount_kopecks END),0) FROM investment_movements WHERE investment_account_id=$3)::int outstanding`, [ids.cashbox, ids.user, ids.account]);
  assert.deepEqual(facts.rows[0], { cash: 25000000, expenses: 15000000, outstanding: 10000000 });
});

test("account row lock prevents concurrent repayments from making investment negative", async () => {
  async function repay(suffix) {
    return inTransaction(async (client) => {
      await client.query("SELECT id FROM investment_accounts WHERE id=$1 AND status='ACTIVE' FOR UPDATE", [ids.account]);
      const balance = await client.query("SELECT COALESCE(SUM(CASE WHEN type='CONTRIBUTION' THEN amount_kopecks ELSE -amount_kopecks END),0)::int outstanding FROM investment_movements WHERE investment_account_id=$1", [ids.account]);
      if (balance.rows[0].outstanding < 8000000) throw Object.assign(new Error("investment repayment exceeds remainder"), { code: "409" });
      const transactionId = `itest_investment_parallel_tx_${suffix}_${stamp}`;
      await client.query("INSERT INTO financial_transactions(id,amount_kopecks,transaction_date,type,author_user_id,cashbox_id,investment_account_id,category,title,show_to_client,created_at,updated_at) VALUES($1,8000000,$2,'INVESTMENT_REPAYMENT',$3,$4,$5,'INVESTMENT_REPAYMENT','Parallel repayment',0,$2,$2)", [transactionId, now + 2, ids.user, ids.cashbox, ids.account]);
      await client.query("UPDATE cashboxes SET balance_kopecks=balance_kopecks-8000000 WHERE id=$1", [ids.cashbox]);
      await client.query("INSERT INTO investment_movements(id,investment_account_id,financial_transaction_id,type,amount_kopecks,transaction_date,source_cashbox_id,created_by_user_id,created_at,updated_at) VALUES($1,$2,$3,'REPAYMENT',8000000,$4,$5,$6,$4,$4)", [`itest_investment_parallel_movement_${suffix}_${stamp}`, ids.account, transactionId, now + 2, ids.cashbox, ids.user]);
    });
  }
  const settled = await Promise.allSettled([repay("a"), repay("b")]);
  assert.equal(settled.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(settled.filter((result) => result.status === "rejected").length, 1);
  const balance = await pool.query("SELECT COALESCE(SUM(CASE WHEN type='CONTRIBUTION' THEN amount_kopecks ELSE -amount_kopecks END),0)::int outstanding FROM investment_movements WHERE investment_account_id=$1", [ids.account]);
  assert.equal(balance.rows[0].outstanding, 2000000);
});
