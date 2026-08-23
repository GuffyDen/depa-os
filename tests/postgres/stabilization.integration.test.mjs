import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl, "DATABASE_URL is required");
assert.equal(process.env.NODE_ENV, "test", "Integration tests must only run with NODE_ENV=test");
const parsed = new URL(databaseUrl);
assert.ok(["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname));
assert.match(parsed.pathname.slice(1), /^depa_os_test(?:_|$)/);

const pool = new pg.Pool({ connectionString: databaseUrl, max: 12 });
const stamp = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const ids = {
  employee: `itest_employee_${stamp}`,
  user: `itest_user_${stamp}`,
  client: `itest_client_${stamp}`,
  project: `itest_project_${stamp}`,
  stage: `itest_stage_${stamp}`,
  portalUser: `itest_portal_${stamp}`,
  cashbox: `itest_cashbox_${stamp}`,
  expense: `itest_expense_${stamp}`,
  claim: `itest_claim_${stamp}`,
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

async function seed() {
  await pool.query("INSERT INTO employees(id,full_name,status,created_at,updated_at) VALUES($1,'Integration Owner','ACTIVE',$2,$2)", [ids.employee, now]);
  await pool.query("INSERT INTO users(id,employee_id,auth_provider,username,username_normalized,display_name,role,status,is_protected_owner,created_at,updated_at) VALUES($1,$2,'LOCAL',$3,$3,'Integration Owner','OWNER','ACTIVE',0,$4,$4)", [ids.user, ids.employee, ids.user, now]);
  await pool.query("INSERT INTO clients(id,name,phone,phone_normalized,source,status,responsible_user_id,created_at,updated_at) VALUES($1,'Integration Client','+70000000000','70000000000','OTHER','ACTIVE',$2,$3,$3)", [ids.client, ids.user, now]);
  await pool.query("INSERT INTO projects(id,client_id,name,address,apartment,status,contract_amount_kopecks,responsible_user_id,estimated_materials_budget_kopecks,created_by_user_id,payment_plan_version,created_at,updated_at) VALUES($1,$2,'Integration Project','Test','1','ACTIVE',100000,$3,0,$3,1,$4,$4)", [ids.project, ids.client, ids.user, now]);
  await pool.query("INSERT INTO project_stages(id,project_id,name,status,sort_order,weight_within_project,client_acceptance_required,acceptance_status,created_at,updated_at) VALUES($1,$2,'Integration Stage','COMPLETED',0,100,1,'AWAITING_ACCEPTANCE',$3,$3)", [ids.stage, ids.project, now]);
  await pool.query("INSERT INTO client_portal_users(id,client_id,login_identifier,login_identifier_normalized,password_hash,password_salt,password_iterations,status,created_at,updated_at) VALUES($1,$2,$3,$3,'hash','salt',100000,'ACTIVE',$4,$4)", [ids.portalUser, ids.client, ids.portalUser, now]);
  await pool.query("INSERT INTO cashboxes(id,owner_user_id,owner_employee_id,name,type,currency,is_active,status,balance_kopecks,opening_balance_kopecks,created_at,updated_at) VALUES($1,$2,$3,'Integration Cashbox','PERSONAL','RUB',1,'ACTIVE',-100000,0,$4,$4)", [ids.cashbox, ids.user, ids.employee, now]);
  await pool.query("INSERT INTO financial_transactions(id,amount_kopecks,transaction_date,type,expense_type,author_user_id,cashbox_id,category,title,show_to_client,created_at,updated_at) VALUES($1,100000,$2,'EXPENSE','ADMIN',$3,$4,'TEST','Integration expense',0,$2,$2)", [ids.expense, now, ids.user, ids.cashbox]);
  await pool.query("INSERT INTO client_payment_claims(id,client_id,project_id,portal_user_id,claimed_amount_kopecks,status,claimed_at,created_at,updated_at) VALUES($1,$2,$3,$4,300000,'PENDING',$5,$5,$5)", [ids.claim, ids.client, ids.project, ids.portalUser, now]);
}

test.before(seed);
test.after(async () => { await pool.end(); });

test("audit tables accept inserts and reject UPDATE/DELETE", async () => {
  const auditId = `itest_audit_${stamp}`;
  const portalAuditId = `itest_portal_audit_${stamp}`;
  await pool.query("INSERT INTO audit_logs(id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES($1,$2,'TEST','Test',$3,$4,'{}')", [auditId, ids.user, ids.project, now]);
  await pool.query("INSERT INTO client_portal_audit_events(id,action,entity_type,entity_id,client_id,client_portal_user_id,metadata_json,occurred_at) VALUES($1,'TEST','Test',$2,$3,$4,'{}',$5)", [portalAuditId, ids.project, ids.client, ids.portalUser, now]);
  for (const [table, id] of [["audit_logs", auditId], ["client_portal_audit_events", portalAuditId]]) {
    await assert.rejects(pool.query(`UPDATE ${table} SET entity_id='changed' WHERE id=$1`, [id]), /immutable/i);
    await assert.rejects(pool.query(`DELETE FROM ${table} WHERE id=$1`, [id]), /immutable/i);
  }
});

test("parallel accept/reject produces exactly one decision event", async () => {
  async function decide(status, eventType) {
    return inTransaction(async (client) => {
      const transitioned = await client.query("UPDATE project_stages SET acceptance_status=$1,updated_at=$2 WHERE id=$3 AND acceptance_status='AWAITING_ACCEPTANCE' RETURNING id", [status, now, ids.stage]);
      if (transitioned.rowCount !== 1) throw Object.assign(new Error("stage already decided"), { code: "409" });
      await client.query("INSERT INTO stage_acceptance_events(id,project_id,stage_id,type,client_portal_user_id,created_at) VALUES($1,$2,$3,$4,$5,$6)", [`itest_event_${eventType}_${stamp}`, ids.project, ids.stage, eventType, ids.portalUser, now]);
      return status;
    });
  }
  const settled = await Promise.allSettled([
    decide("ACCEPTED", "STAGE_ACCEPTED_BY_CLIENT"),
    decide("REJECTED", "STAGE_REJECTED_BY_CLIENT"),
  ]);
  assert.equal(settled.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(settled.filter((result) => result.status === "rejected").length, 1);
  const count = await pool.query("SELECT COUNT(*)::int count FROM stage_acceptance_events WHERE stage_id=$1 AND type IN ('STAGE_ACCEPTED_BY_CLIENT','STAGE_REJECTED_BY_CLIENT')", [ids.stage]);
  assert.equal(count.rows[0].count, 1);
});

test("parallel 70k refunds against a 100k expense allow only one", async () => {
  async function refund(suffix) {
    return inTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`refund:${ids.expense}`]);
      const guard = await client.query("WITH original AS (SELECT amount_kopecks FROM financial_transactions WHERE id=$1 AND type='EXPENSE') SELECT COUNT(*)=1 AND COALESCE(MAX(amount_kopecks),0)-COALESCE((SELECT SUM(amount_kopecks) FROM financial_transactions WHERE type='REFUND' AND original_transaction_id=$1),0)>=$2 allowed FROM original", [ids.expense, 70000]);
      if (!guard.rows[0].allowed) throw Object.assign(new Error("refund exceeds remainder"), { code: "409" });
      await client.query("INSERT INTO financial_transactions(id,amount_kopecks,transaction_date,type,author_user_id,cashbox_id,original_transaction_id,category,title,show_to_client,created_at,updated_at) VALUES($1,70000,$2,'REFUND',$3,$4,$5,'TEST','Integration refund',0,$2,$2)", [`itest_refund_${suffix}_${stamp}`, now, ids.user, ids.cashbox, ids.expense]);
    });
  }
  const settled = await Promise.allSettled([refund("a"), refund("b")]);
  assert.equal(settled.filter((result) => result.status === "fulfilled").length, 1);
  const total = await pool.query("SELECT COALESCE(SUM(amount_kopecks),0)::int total FROM financial_transactions WHERE type='REFUND' AND original_transaction_id=$1", [ids.expense]);
  assert.equal(total.rows[0].total, 70000);
});

test("double payment confirmation creates one transaction and one cashbox delta", async () => {
  async function confirm(suffix) {
    const tx = `itest_claim_tx_${suffix}_${stamp}`;
    return inTransaction(async (client) => {
      const result = await client.query(`WITH locked AS (SELECT * FROM client_payment_claims WHERE id=$1 FOR UPDATE),
        eligible AS (SELECT * FROM locked WHERE status='PENDING'),
        inserted AS (INSERT INTO financial_transactions(id,amount_kopecks,transaction_date,type,author_user_id,cashbox_id,client_id,project_id,category,title,show_to_client,client_payment_claim_id,created_at,updated_at)
          SELECT $2,300000,$3,'INCOME',$4,$5,e.client_id,e.project_id,'CLIENT_PAYMENT','Integration payment',1,e.id,$3,$3 FROM eligible e RETURNING id),
        claim AS (UPDATE client_payment_claims SET status='CONFIRMED',confirmed_amount_kopecks=300000,confirmed_at=$3,confirmed_by_user_id=$4,updated_at=$3 WHERE id=$1 AND EXISTS(SELECT 1 FROM inserted)),
        cashbox AS (UPDATE cashboxes SET balance_kopecks=balance_kopecks+300000,updated_at=$3 WHERE id=$5 AND EXISTS(SELECT 1 FROM inserted))
        SELECT COUNT(*)::int count FROM inserted`, [ids.claim, tx, now, ids.user, ids.cashbox]);
      if (result.rows[0].count !== 1) throw Object.assign(new Error("claim already processed"), { code: "409" });
      return tx;
    });
  }
  const settled = await Promise.allSettled([confirm("a"), confirm("b")]);
  assert.equal(settled.filter((result) => result.status === "fulfilled").length, 1);
  const facts = await pool.query("SELECT (SELECT COUNT(*) FROM financial_transactions WHERE client_payment_claim_id=$1)::int tx_count,(SELECT balance_kopecks FROM cashboxes WHERE id=$2)::int balance", [ids.claim, ids.cashbox]);
  assert.deepEqual(facts.rows[0], { tx_count: 1, balance: 200000 });
});

test("a transaction cannot pass the cashbox guard after deactivation wins", async () => {
  await inTransaction(async (client) => {
    await client.query("UPDATE cashboxes SET status='INACTIVE',is_active=0 WHERE id=$1", [ids.cashbox]);
  });
  await assert.rejects(inTransaction(async (client) => {
    const guard = await client.query("WITH locked AS (SELECT id FROM cashboxes WHERE id=$1 AND status='ACTIVE' FOR UPDATE) SELECT COUNT(*)::int count FROM locked", [ids.cashbox]);
    if (guard.rows[0].count !== 1) throw Object.assign(new Error("cashbox inactive"), { code: "409" });
    await client.query("INSERT INTO financial_transactions(id,amount_kopecks,transaction_date,type,author_user_id,cashbox_id,category,title,show_to_client,created_at,updated_at) VALUES($1,1,$2,'INCOME',$3,$4,'TEST','Must not exist',0,$2,$2)", [`itest_invalid_${stamp}`, now, ids.user, ids.cashbox]);
  }), /inactive/);
  const absent = await pool.query("SELECT COUNT(*)::int count FROM financial_transactions WHERE id=$1", [`itest_invalid_${stamp}`]);
  assert.equal(absent.rows[0].count, 0);
});
