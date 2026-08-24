import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

assert.equal(process.env.NODE_ENV, "test");
const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl);
const parsed = new URL(databaseUrl);
assert.ok(["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname));
assert.match(parsed.pathname.slice(1), /^depa_os_test(?:_|$)/);
const db = new pg.Pool({ connectionString: databaseUrl, max: 8 });
const stamp = `${Date.now()}_${Math.random().toString(16).slice(2)}`, key = (name) => `aw_itest_${name}_${stamp}`, now = Math.floor(Date.now() / 1000);
const ids = { employee: key("employee"), owner: key("owner"), client: key("client"), project: key("project"), plan: key("plan"), stage: key("stage"), portal: key("portal"), work: key("work"), v1: key("v1"), v2: key("v2") };

test.before(async () => {
  await db.query("INSERT INTO employees(id,full_name,status,created_at,updated_at) VALUES($1,'AW Owner','ACTIVE',$2,$2)", [ids.employee, now]);
  await db.query("INSERT INTO users(id,employee_id,auth_provider,username,username_normalized,display_name,role,status,is_protected_owner,created_at,updated_at) VALUES($1,$2,'LOCAL',$3,$3,'AW Owner','OWNER','ACTIVE',0,$4,$4)", [ids.owner, ids.employee, key("login"), now]);
  await db.query("INSERT INTO clients(id,name,phone,phone_normalized,source,status,responsible_user_id,created_at,updated_at) VALUES($1,'AW Client',$2,$3,'OTHER','ACTIVE',$4,$5,$5)", [ids.client, `+7${String(Date.now()).slice(-10)}`, String(Date.now()).slice(-10), ids.owner, now]);
  await db.query("INSERT INTO projects(id,client_id,name,address,apartment,status,contract_amount_kopecks,responsible_user_id,estimated_materials_budget_kopecks,created_by_user_id,created_at,updated_at) VALUES($1,$2,'AW Project','Test','42','ACTIVE',10000000,$3,0,$3,$4,$4)", [ids.project, ids.client, ids.owner, now]);
  await db.query("INSERT INTO production_plans(id,project_id,status,design_weight,production_weight,created_by_user_id,created_at,updated_at) VALUES($1,$2,'ACTIVE',0,100,$3,$4,$4)", [ids.plan, ids.project, ids.owner, now]);
  await db.query("INSERT INTO project_stages(id,project_id,production_plan_id,name,status,sort_order,weight_within_project,created_at,updated_at) VALUES($1,$2,$3,'AW Stage','IN_PROGRESS',0,100,$4,$4)", [ids.stage, ids.project, ids.plan, now]);
  await db.query("INSERT INTO client_portal_users(id,client_id,login_identifier,login_identifier_normalized,password_hash,password_salt,password_iterations,status,created_at,updated_at) VALUES($1,$2,$3,$3,'hash','salt',100000,'ACTIVE',$4,$4)", [ids.portal, ids.client, key("portal"), now]);
});
test.after(async () => db.end());

test("reject v1, preserve immutable content and create v2", async () => {
  await db.query("INSERT INTO additional_works(id,project_id,client_id,stage_id,number,title,status,responsible_user_id,current_version_id,created_by_user_id,created_at,updated_at) VALUES($1,$2,$3,$4,'ДР-TEST-1','Допработа','DRAFT',$5,NULL,$5,$6,$6)", [ids.work, ids.project, ids.client, ids.stage, ids.owner, now]);
  await db.query("INSERT INTO additional_work_versions(id,additional_work_id,project_id,version,title,amount_kopecks,schedule_delta_days,status,reason,client_description,schedule_impact_type,task_creation_mode,created_by_user_id,created_at,updated_at) VALUES($1,$2,$3,1,'Допработа',31250,2,'DRAFT','CLIENT_REQUEST','Версия 1','ADD_DAYS','AFTER_APPROVAL',$4,$5,$5)", [ids.v1, ids.work, ids.project, ids.owner, now]);
  await db.query("UPDATE additional_works SET current_version_id=$1 WHERE id=$2", [ids.v1, ids.work]);
  await db.query("INSERT INTO additional_work_items(id,additional_work_version_id,position,name,quantity,unit,client_unit_price_kopecks,client_total_kopecks,created_at,updated_at) VALUES($1,$2,0,'Монтаж',2.500,'м²',12500,31250,$3,$3)", [key("item_v1"), ids.v1, now]);
  await db.query("UPDATE additional_work_versions SET status='SENT',sent_at=$1,sent_by_user_id=$2 WHERE id=$3", [now, ids.owner, ids.v1]);
  await db.query("UPDATE additional_works SET status='AWAITING_CLIENT_APPROVAL' WHERE id=$1", [ids.work]);
  await db.query("UPDATE additional_work_versions SET status='REJECTED',rejected_at=$1,client_decision_comment='Изменить условия' WHERE id=$2", [now, ids.v1]);
  await db.query("UPDATE additional_works SET status='REJECTED' WHERE id=$1", [ids.work]);
  await assert.rejects(db.query("UPDATE additional_work_versions SET title='tampered' WHERE id=$1", [ids.v1]), /immutable/i);
  await assert.rejects(db.query("DELETE FROM additional_work_items WHERE additional_work_version_id=$1", [ids.v1]), /immutable/i);
  await db.query("INSERT INTO additional_work_versions(id,additional_work_id,project_id,version,title,amount_kopecks,schedule_delta_days,status,reason,client_description,schedule_impact_type,task_creation_mode,created_by_user_id,created_at,updated_at) VALUES($1,$2,$3,2,'Допработа v2',50000,2,'DRAFT','CLIENT_REQUEST','Версия 2','ADD_DAYS','AFTER_APPROVAL',$4,$5,$5)", [ids.v2, ids.work, ids.project, ids.owner, now]);
  await db.query("INSERT INTO additional_work_items(id,additional_work_version_id,position,name,quantity,unit,client_unit_price_kopecks,client_total_kopecks,created_at,updated_at) VALUES($1,$2,0,'Монтаж',2.500,'м²',20000,50000,$3,$3)", [key("item_v2"), ids.v2, now]);
  await db.query("INSERT INTO additional_work_proposed_tasks(id,additional_work_version_id,stage_id,position,title,progress_type,quantity,unit,typical_duration_days,client_visible,created_at,updated_at) VALUES($1,$2,$3,0,'Дополнительный монтаж','QUANTITY',2.500,'м²',2,1,$4,$4)", [key("proposed"), ids.v2, ids.stage, now]);
  await db.query("UPDATE additional_works SET current_version_id=$1,status='AWAITING_CLIENT_APPROVAL' WHERE id=$2", [ids.v2, ids.work]);
  await db.query("UPDATE additional_work_versions SET status='SENT',sent_at=$1,sent_by_user_id=$2 WHERE id=$3", [now, ids.owner, ids.v2]);
});

async function approve() {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query("SELECT aw.id FROM additional_works aw JOIN additional_work_versions v ON v.id=aw.current_version_id WHERE aw.id=$1 AND aw.status='AWAITING_CLIENT_APPROVAL' AND v.status='SENT' FOR UPDATE OF aw,v", [ids.work]);
    if (locked.rowCount !== 1) throw new Error("already decided");
    await client.query("UPDATE additional_work_versions SET status='APPROVED',approved_at=$1,approved_by_client_portal_user_id=$2 WHERE id=$3", [now, ids.portal, ids.v2]);
    await client.query("UPDATE additional_works SET status='APPROVED',approved_version_id=$1,approved_by_client_portal_user_id=$2 WHERE id=$3", [ids.v2, ids.portal, ids.work]);
    await client.query("INSERT INTO obligations(id,direction,counterparty_type,counterparty_id,project_id,amount_kopecks,paid_kopecks,status,obligation_type,payment_plan_version,source_key,currency,additional_work_id,additional_work_version_id,created_at,updated_at) VALUES($1,'RECEIVABLE','CLIENT',$2,$3,50000,0,'OPEN','ADDITIONAL_WORK',1,$4,'RUB',$5,$6,$7,$7) ON CONFLICT(source_key) WHERE source_key IS NOT NULL DO NOTHING", [key("obligation"), ids.client, ids.project, `additional_work:${ids.work}:version:${ids.v2}`, ids.work, ids.v2, now]);
    await client.query("INSERT INTO tasks(id,title,created_by_user_id,project_id,status,production_plan_id,stage_id,position,progress_type,unit,planned_quantity,completed_quantity,weight_within_stage,planned_duration_days,client_visible,additional_work_id,additional_work_version_id,created_at,updated_at) VALUES($1,'Дополнительный монтаж',$2,$3,'NOT_STARTED',$4,$5,10,'QUANTITY','м²',2.500,0,0,2,1,$6,$7,$8,$8)", [key("task"), ids.owner, ids.project, ids.plan, ids.stage, ids.work, ids.v2, now]);
    await client.query("INSERT INTO additional_work_events(id,additional_work_id,additional_work_version_id,type,client_portal_user_id,occurred_at) VALUES($1,$2,$3,'APPROVED',$4,$5)", [key("approved_event"), ids.work, ids.v2, ids.portal, now]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

test("parallel approvals materialize exactly one obligation and zero-weight task", async () => {
  const settled = await Promise.allSettled([approve(), approve()]);
  assert.equal(settled.filter((result) => result.status === "fulfilled").length, 1);
  const facts = await db.query("SELECT (SELECT COUNT(*) FROM obligations WHERE additional_work_id=$1)::int obligations,(SELECT COUNT(*) FROM tasks WHERE additional_work_id=$1)::int tasks,(SELECT COUNT(*) FROM additional_work_events WHERE additional_work_id=$1 AND type='APPROVED')::int approvals", [ids.work]);
  assert.deepEqual(facts.rows[0], { obligations: 1, tasks: 1, approvals: 1 });
  const task = await db.query("SELECT weight_within_stage FROM tasks WHERE additional_work_id=$1", [ids.work]);
  assert.equal(Number(task.rows[0].weight_within_stage), 0);
});

test("zero price works are allowed without an obligation", async () => {
  const work = key("zero_work"), version = key("zero_version");
  await db.query("INSERT INTO additional_works(id,project_id,client_id,number,title,status,responsible_user_id,current_version_id,approved_version_id,created_by_user_id,created_at,updated_at) VALUES($1,$2,$3,'ДР-ZERO','Бесплатно','DRAFT',$4,NULL,NULL,$4,$5,$5)", [work, ids.project, ids.client, ids.owner, now]);
  await db.query("INSERT INTO additional_work_versions(id,additional_work_id,project_id,version,title,amount_kopecks,schedule_delta_days,status,reason,client_description,schedule_impact_type,task_creation_mode,created_by_user_id,created_at,updated_at) VALUES($1,$2,$3,1,'Бесплатно',0,0,'DRAFT','OTHER','Без оплаты','NO_IMPACT','NONE',$4,$5,$5)", [version, work, ids.project, ids.owner, now]);
  await db.query("UPDATE additional_works SET current_version_id=$1 WHERE id=$2", [version, work]);
  await db.query("UPDATE additional_work_versions SET status='APPROVED',approved_at=$1,approved_by_client_portal_user_id=$2 WHERE id=$3", [now, ids.portal, version]);
  await db.query("UPDATE additional_works SET status='APPROVED',approved_version_id=$1,approved_by_client_portal_user_id=$2 WHERE id=$3", [version, ids.portal, work]);
  const count = await db.query("SELECT COUNT(*)::int count FROM obligations WHERE additional_work_id=$1", [work]);
  assert.equal(count.rows[0].count, 0);
});
