import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

assert.equal(process.env.NODE_ENV, "test");
const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl);
const parsed = new URL(databaseUrl);
assert.ok(["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname));
assert.match(parsed.pathname.slice(1), /^depa_os_test(?:_|$)/);
const db = new pg.Pool({ connectionString: databaseUrl, max: 10 });
const q = (text, params = []) => db.query(text, params);
const now = Math.floor(Date.now() / 1000);
const day = 86_400;
const id = (name) => `e2e_${name}`;

test.after(async () => db.end());

test("FULL APARTMENT E2E — linked commercial, production, portal and finance lifecycle", async () => {
  const user = id("owner"), employee = id("employee"), client = id("client"), lead = id("lead"), rc = id("rc");
  const inspectionOrder = id("order_inspection"), inspection = id("inspection"), designOrder = id("order_design"), design = id("design");
  const renovationOrder = id("order_renovation"), estimate = id("estimate"), estimateV1 = id("estimate_v1"), estimateV2 = id("estimate_v2");
  const contract = id("contract"), contractV1 = id("contract_v1"), project = id("project"), plan = id("plan"), portal = id("portal"), cashbox = id("cashbox");
  const stages = [id("stage_preparation"), id("stage_rough"), id("stage_finish")];

  // 1–11: Lead → Client → ЖК → Inspection → Design.
  await q("INSERT INTO employees(id,full_name,status,created_at,updated_at) VALUES($1,'Тестовый Owner E2E','ACTIVE',$2,$2)", [employee, now]);
  await q("INSERT INTO users(id,employee_id,auth_provider,username,username_normalized,display_name,role,status,is_protected_owner,created_at,updated_at) VALUES($1,$2,'LOCAL',$3,$3,'Тестовый Owner E2E','OWNER','ACTIVE',0,$4,$4)", [user, employee, user, now]);
  await q("INSERT INTO leads(id,source,stage,name,phone,normalized_phone,responsible_user_id,created_by_user_id,created_at,updated_at) VALUES($1,'OTHER','NEW','Тестовый Клиент E2E','+79990000101','79990000101',$2,$2,$3,$3)", [lead, user, now]);
  await q("INSERT INTO clients(id,name,phone,phone_normalized,source,status,responsible_user_id,created_at,updated_at) VALUES($1,'Тестовый Клиент E2E','+79990000101','79990000101','OTHER','ACTIVE',$2,$3,$3)", [client, user, now]);
  await q("UPDATE leads SET linked_client_id=$1,stage='WON',closed_at=$2,updated_at=$2 WHERE id=$3", [client, now, lead]);
  await q("INSERT INTO residential_complexes(id,name,normalized_name,city,address,status,created_by_user_id,created_at,updated_at) VALUES($1,'Тестовый ЖК E2E','тестовый жк e2e','Владивосток','Тестовая улица, 1','ACTIVE',$2,$3,$3)", [rc, user, now]);
  await q("INSERT INTO orders(id,number,client_id,type,title,amount_kopecks,status,responsible_user_id,scheduled_at,completed_at,created_by_user_id,source_lead_id,created_at,updated_at) VALUES($1,'E2E-I-001',$2,'INSPECTION','Приёмка квартиры 101',0,'COMPLETED',$3,$4,$5,$3,$6,$5,$5)", [inspectionOrder, client, user, now + day, now + day + 3600, lead]);
  await q("INSERT INTO inspections(id,order_id,residential_complex,residential_complex_id,address,apartment_number,area_sqm,scheduled_at,scheduled_start_at,scheduled_end_at,inspector_user_id,result_comment,created_at,updated_at) VALUES($1,$2,'Тестовый ЖК E2E',$3,'Тестовая улица, 1','101',65,$4,$4,$5,$6,'Приёмка завершена',$7,$7)", [inspection, inspectionOrder, rc, now + day, now + day + 3600, user, now]);
  const calendar = await q("SELECT i.id FROM inspections i JOIN orders o ON o.id=i.order_id WHERE i.inspector_user_id=$1 AND i.scheduled_start_at >= $2 AND i.scheduled_start_at < $3", [user, now, now + 2 * day]);
  assert.equal(calendar.rowCount, 1);
  await q("INSERT INTO orders(id,number,client_id,type,title,amount_kopecks,status,responsible_user_id,completed_at,created_by_user_id,source_order_id,created_at,updated_at) VALUES($1,'E2E-D-001',$2,'DESIGN','Дизайн квартиры 101',15000000,'COMPLETED',$3,$4,$3,$5,$4,$4)", [designOrder, client, user, now, inspectionOrder]);
  await q("INSERT INTO design_projects(id,order_id,residential_complex,residential_complex_id,address,apartment_number,area_sqm,status,actual_end_date,created_at,updated_at) VALUES($1,$2,'Тестовый ЖК E2E',$3,'Тестовая улица, 1','101',65,'COMPLETED',$4,$4,$4)", [design, designOrder, rc, now]);
  for (const [position, name] of ["Планировка", "Концепция", "Рабочая документация"].entries()) await q("INSERT INTO design_project_stages(id,design_project_id,name,position,status,completed_at,created_at,updated_at) VALUES($1,$2,$3,$4,'COMPLETED',$5,$5,$5)", [id(`design_stage_${position}`), design, name, position, now]);

  // 12–33: two immutable estimate versions, proposal, renovation order, contract snapshots and project.
  await q("INSERT INTO estimates(id,client_id,responsible_user_id,residential_complex_id,address,apartment_number,area_sqm,source_lead_id,source_order_id,status,created_by_user_id,created_at,updated_at) VALUES($1,$2,$3,$4,'Тестовая улица, 1','101',65,$5,$6,'ACTIVE',$3,$7,$7)", [estimate, client, user, rc, lead, designOrder, now]);
  await q("INSERT INTO estimate_versions(id,estimate_id,version,total_kopecks,status,estimated_materials_budget_kopecks,created_by_user_id,created_at,updated_at) VALUES($1,$2,1,100000000,'SUPERSEDED',30000000,$3,$4,$4),($5,$2,2,110000000,'APPROVED',32000000,$3,$4,$4)", [estimateV1, estimate, user, now, estimateV2]);
  const sectionA = id("section_rough"), sectionB = id("section_finish");
  await q("INSERT INTO estimate_sections(id,version_id,name,position,created_at,updated_at) VALUES($1,$2,'Черновые работы',0,$3,$3),($4,$2,'Чистовые работы',1,$3,$3)", [sectionA, estimateV2, now, sectionB]);
  const items = [
    [id("item_1"), sectionA, "Штукатурка стен", "м²", "120.5", 200000, 120000, 0],
    [id("item_2"), sectionA, "Установка розеток", "шт", "10", 100000, 60000, 1],
    [id("item_3"), sectionA, "Подготовительные работы", "компл", "1", 30000000, 18000000, 2],
    [id("item_4"), sectionB, "Напольные покрытия", "компл", "1", 25000000, 16000000, 0],
    [id("item_5"), sectionB, "Финишная отделка", "компл", "1", 29900000, 19000000, 1],
  ];
  for (const item of items) await q("INSERT INTO estimate_items(id,section_id,name,unit,quantity,client_price_kopecks,internal_cost_kopecks,position,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)", [...item, now]);
  const totals = await q("SELECT ROUND(SUM(quantity*client_price_kopecks))::int client_total,ROUND(SUM(quantity*internal_cost_kopecks))::int internal_total FROM estimate_items WHERE section_id IN ($1,$2)", [sectionA, sectionB]);
  assert.equal(totals.rows[0].client_total, 110000000);
  assert.equal(totals.rows[0].client_total - totals.rows[0].internal_total, 41940000);
  await q("UPDATE estimates SET current_version_id=$1,approved_version_id=$1,updated_at=$2 WHERE id=$3", [estimateV2, now, estimate]);
  await q("INSERT INTO estimate_events(id,estimate_id,version_id,type,actor_user_id,metadata_json,occurred_at) VALUES($1,$2,$3,'PROPOSAL_SENT',$4,'{}',$5),($6,$2,$3,'ESTIMATE_APPROVED',$4,'{}',$5)", [id("estimate_sent"), estimate, estimateV2, user, now, id("estimate_approved")]);
  await q("INSERT INTO orders(id,number,client_id,type,title,amount_kopecks,status,responsible_user_id,created_by_user_id,source_order_id,created_at,updated_at) VALUES($1,'E2E-R-001',$2,'RENOVATION','Ремонт квартиры 101',110000000,'IN_PROGRESS',$3,$3,$4,$5,$5)", [renovationOrder, client, user, designOrder, now]);
  await q("INSERT INTO renovation_order_details(id,order_id,residential_complex,residential_complex_id,address,apartment_number,area_sqm,approved_estimate_version_id,created_at,updated_at) VALUES($1,$2,'Тестовый ЖК E2E',$3,'Тестовая улица, 1','101',65,$4,$5,$5)", [id("renovation_details"), renovationOrder, rc, estimateV2, now]);
  await q("INSERT INTO contracts(id,contract_number,client_id,order_id,type,status,responsible_user_id,created_by_user_id,created_at,updated_at) VALUES($1,'E2E-C-001',$2,$3,'RENOVATION','SIGNED',$4,$4,$5,$5)", [contract, client, renovationOrder, user, now]);
  await q("INSERT INTO contract_versions(id,contract_id,version,status,contract_date,estimate_version_id,contract_amount_kopecks,estimated_materials_budget_kopecks,client_snapshot_json,company_snapshot_json,property_snapshot_json,terms_snapshot_json,document_snapshot_json,signed_at,signed_by_user_id,created_by_user_id,created_at,updated_at) VALUES($1,$2,1,'SIGNED',$3,$4,110000000,32000000,$5,$6,$7,'{}','{}',$3,$8,$8,$3,$3)", [contractV1, contract, now, estimateV2, JSON.stringify({ id: client, name: "Тестовый Клиент E2E" }), JSON.stringify({ name: "DEPA TEST" }), JSON.stringify({ residentialComplexId: rc, apartment: "101", areaSqm: 65 }), user]);
  await q("UPDATE contracts SET current_version_id=$1,signed_version_id=$1 WHERE id=$2", [contractV1, contract]);
  await q("INSERT INTO projects(id,order_id,client_id,name,residential_complex,residential_complex_id,address,apartment,area_sqm,status,contract_amount_kopecks,responsible_user_id,estimated_materials_budget_kopecks,approved_estimate_version_id,contract_id,created_by_user_id,created_at,updated_at) VALUES($1,$2,$3,'Тестовый ЖК E2E · кв. 101','Тестовый ЖК E2E',$4,'Тестовая улица, 1','101',65,'ACTIVE',110000000,$5,32000000,$6,$7,$5,$8,$8)", [project, renovationOrder, client, rc, user, estimateV2, contract, now]);
  await q("UPDATE contracts SET project_id=$1 WHERE id=$2", [project, contract]);
  await q("UPDATE estimates SET project_id=$1 WHERE id=$2", [project, estimate]);
  await q("UPDATE estimate_versions SET project_id=$1 WHERE id IN ($2,$3)", [project, estimateV1, estimateV2]);

  // 34–92: production plan, weighted stages/tasks, dependencies, reports, delays, protected photos and acceptance.
  await q("INSERT INTO production_plans(id,project_id,status,design_weight,production_weight,created_by_user_id,created_at,updated_at) VALUES($1,$2,'ACTIVE',0,100,$3,$4,$4)", [plan, project, user, now]);
  const stageRows = [[stages[0], "ПОДГОТОВКА", 40, 50000000], [stages[1], "ЧЕРНОВЫЕ РАБОТЫ", 35, 60000000], [stages[2], "ЧИСТОВАЯ ОТДЕЛКА", 25, 0]];
  for (const [position, row] of stageRows.entries()) await q("INSERT INTO project_stages(id,project_id,production_plan_id,name,status,sort_order,weight_within_project,client_acceptance_required,acceptance_status,stage_commercial_amount_kopecks,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,1,$8,$9,$10,$10)", [row[0], project, plan, row[1], position === 0 ? "COMPLETED" : "IN_PROGRESS", position, row[2], position === 0 ? "AWAITING_ACCEPTANCE" : "NOT_READY", row[3], now]);
  const taskRows = [
    ["survey", stages[0], "Замеры", "BINARY", null, null, 50, "COMPLETED"], ["protect", stages[0], "Защита помещения", "BINARY", null, null, 50, "COMPLETED"],
    ["plaster", stages[1], "Штукатурка стен", "QUANTITY", "м²", 120, 40, "IN_PROGRESS"], ["sockets", stages[1], "Установка розеток", "QUANTITY", "шт", 10, 30, "IN_PROGRESS"],
    ["plumbing", stages[1], "Разводка сантехники", "BINARY", null, null, 30, "NOT_STARTED"], ["floor", stages[2], "Напольные покрытия", "BINARY", null, null, 34, "NOT_STARTED"],
    ["paint", stages[2], "Покраска стен", "BINARY", null, null, 33, "NOT_STARTED"], ["finish", stages[2], "Финишная сборка", "BINARY", null, null, 33, "NOT_STARTED"],
  ];
  for (const [position, row] of taskRows.entries()) await q("INSERT INTO tasks(id,title,project_id,client_id,status,created_by_user_id,production_plan_id,stage_id,position,progress_type,unit,planned_quantity,completed_quantity,weight_within_stage,planned_start_date,planned_end_date,responsible_user_id,client_visible,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$6,1,$17,$17)", [id(`task_${row[0]}`), row[2], project, client, row[7], user, plan, row[1], position, row[3], row[4], row[5], row[0] === "sockets" ? 2 : row[0] === "plaster" ? 60 : null, row[6], now + position * day, now + (position + 1) * day, now]);
  const socketsProgress = await q("SELECT ROUND(completed_quantity/planned_quantity*100)::int progress FROM tasks WHERE id=$1", [id("task_sockets")]);
  assert.equal(socketsProgress.rows[0].progress, 20);
  const dependencies = [["survey", "plaster"], ["plaster", "paint"], ["protect", "sockets"]];
  for (const [position, pair] of dependencies.entries()) await q("INSERT INTO task_dependencies(id,project_id,predecessor_task_id,successor_task_id,type,lag_days,created_by_user_id,created_at) VALUES($1,$2,$3,$4,'FINISH_TO_START',0,$5,$6)", [id(`dependency_${position}`), project, id(`task_${pair[0]}`), id(`task_${pair[1]}`), user, now]);
  const cycle = await q("WITH RECURSIVE graph(node) AS (SELECT successor_task_id FROM task_dependencies WHERE predecessor_task_id=$1 UNION SELECT d.successor_task_id FROM task_dependencies d JOIN graph g ON d.predecessor_task_id=g.node) SELECT COUNT(*)::int count FROM graph WHERE node=$1", [id("task_survey")]);
  assert.equal(cycle.rows[0].count, 0);
  const report = id("report"), requirement = id("hidden_requirement"), dailyPhoto = id("daily_photo"), hiddenPhoto = id("hidden_photo");
  await q("INSERT INTO daily_reports(id,project_id,report_date,author_employee_id,work_completed,comment,comment_client_visible,created_by_user_id,author_user_id,created_at,updated_at) VALUES($1,$2,$3,$4,'Выполнены подготовительные работы','Клиентский отчёт E2E',1,$5,$5,$3,$3)", [report, project, now, employee, user]);
  await q("INSERT INTO daily_report_tasks(id,daily_report_id,task_id,created_at) VALUES($1,$2,$3,$4)", [id("report_task"), report, id("task_survey"), now]);
  await q("INSERT INTO daily_report_workers(id,daily_report_id,worker_type,employee_id,created_at) VALUES($1,$2,'EMPLOYEE',$3,$4)", [id("report_worker"), report, employee, now]);
  await q("INSERT INTO task_photo_requirements(id,task_id,name,type,required_before_completion,position,created_at,updated_at) VALUES($1,$2,'Фото скрытой проводки','HIDDEN_WORK',1,0,$3,$3)", [requirement, id("task_sockets"), now]);
  await q("INSERT INTO attachments(id,project_id,storage_key,original_filename,mime_type,size_bytes,storage_provider,blob_url,uploaded_by_user_id,entity_type,entity_id,category,visibility,upload_status,metadata_json,completed_at,linked_at,photo_requirement_id,client_visible,created_at,updated_at) VALUES($1,$2,$3,'daily.jpg','image/jpeg',128,'VERCEL_BLOB',$4,$5,'DailyReport',$6,'DAILY_REPORT','CLIENT','LINKED','{}',$7,$7,NULL,1,$7,$7),($8,$2,$9,'hidden.jpg','image/jpeg',128,'VERCEL_BLOB',$10,$5,'Task',$11,'HIDDEN_WORK','CLIENT','LINKED','{}',$7,$7,$12,1,$7,$7)", [dailyPhoto, project, `test-storage/${dailyPhoto}.jpg`, `https://test.private.blob.vercel-storage.com/${dailyPhoto}.jpg`, user, report, now, hiddenPhoto, `test-storage/${hiddenPhoto}.jpg`, `https://test.private.blob.vercel-storage.com/${hiddenPhoto}.jpg`, id("task_sockets"), requirement]);
  await q("INSERT INTO project_delays(id,project_id,reason,start_date,days,category,internal_comment,client_comment,client_visible,created_by_user_id,created_at,updated_at) VALUES($1,$2,'Тестовая внутренняя причина E2E',$3,2,'DEPA','Тестовая внутренняя причина E2E',NULL,0,$4,$3,$3),($5,$2,'Ожидание решения клиента E2E',$3,1,'CLIENT',NULL,'Ожидание решения клиента E2E',1,$4,$3,$3)", [id("delay_internal"), project, now, user, id("delay_client")]);
  await q("INSERT INTO project_schedule_events(id,project_id,actor_user_id,type,previous_forecast_end_date,new_forecast_end_date,reason,metadata_json,occurred_at) VALUES($1,$2,$3,'TASK_RESCHEDULED',$4,$5,'E2E cascade','{}',$6),($7,$2,$3,'FORECAST_PUBLISHED',$4,$5,'E2E publish','{}',$6)", [id("schedule_event"), project, user, now + 8 * day, now + 10 * day, now, id("forecast_event")]);

  // 93–176: portal identity, payment plan, claims, exact allocation and cash reconciliation.
  await q("INSERT INTO client_portal_users(id,client_id,login_identifier,login_identifier_normalized,password_hash,password_salt,password_iterations,status,last_login_at,created_at,updated_at) VALUES($1,$2,'client-e2e','client-e2e','hash','salt',100000,'ACTIVE',$3,$3,$3)", [portal, client, now]);
  await q("INSERT INTO client_portal_sessions(id,portal_user_id,token_hash,created_at,last_seen_at,expires_at) VALUES($1,$2,'test-token-hash',$3,$3,$4)", [id("portal_session"), portal, now, now + 30 * day]);
  await q("INSERT INTO cashboxes(id,owner_user_id,owner_employee_id,name,type,currency,is_active,status,balance_kopecks,opening_balance_kopecks,created_at,updated_at) VALUES($1,$2,$3,'Тестовая касса Owner','PERSONAL','RUB',1,'ACTIVE',0,0,$4,$4)", [cashbox, user, employee, now]);
  await q("UPDATE projects SET payment_plan_version=1,payment_plan_activated_at=$1,payment_plan_activated_by_user_id=$2 WHERE id=$3", [now, user, project]);
  await q("INSERT INTO project_stage_payment_terms(id,project_id,stage_id,stage_amount_kopecks,required_advance_kopecks,position,payment_plan_version,active,created_at,updated_at) VALUES($1,$2,$3,50000000,30000000,0,1,1,$4,$4),($5,$2,$6,60000000,18000000,1,1,1,$4,$4)", [id("term_1"), project, stages[0], now, id("term_2"), stages[1]]);
  const obligationRows = [
    [id("obl_advance_1"), 30000000, 30000000, "PAID", "STAGE_ADVANCE", stages[0]],
    [id("obl_balance_1"), 20000000, 20000000, "PAID", "STAGE_BALANCE", stages[0]],
    [id("obl_advance_2"), 18000000, 18000000, "PAID", "STAGE_ADVANCE", stages[1]],
    [id("obl_partial"), 10000000, 6000000, "PARTIALLY_PAID", "MANUAL", stages[1]],
    [id("obl_overpay"), 4000000, 4000000, "PAID", "MANUAL", stages[1]],
  ];
  for (const row of obligationRows) await q("INSERT INTO obligations(id,direction,counterparty_type,counterparty_id,project_id,amount_kopecks,paid_kopecks,status,obligation_type,stage_id,payment_plan_version,source_key,currency,created_at,updated_at) VALUES($1,'RECEIVABLE','CLIENT',$2,$3,$4,$5,$6,$7,$8,1,$9,'RUB',$10,$10)", [row[0], client, project, row[1], row[2], row[3], row[4], row[5], `e2e:${row[0]}`, now]);
  await q("UPDATE project_stages SET acceptance_status='ACCEPTED',accepted_at=$1,accepted_by_client_portal_user_id=$2 WHERE id=$3", [now, portal, stages[0]]);
  await q("INSERT INTO stage_acceptance_events(id,project_id,stage_id,type,client_portal_user_id,created_at) VALUES($1,$2,$3,'STAGE_ACCEPTED_BY_CLIENT',$4,$5)", [id("acceptance_event"), project, stages[0], portal, now]);
  const payments = [
    ["advance", 30000000, 30000000], ["balance", 38000000, 38000000], ["partial", 10000000, 6000000], ["overpay", 5000000, 5000000],
  ];
  for (const [position, payment] of payments.entries()) {
    const claim = id(`claim_${payment[0]}`), tx = id(`tx_${payment[0]}`);
    await q("INSERT INTO client_payment_claims(id,client_id,project_id,portal_user_id,claimed_amount_kopecks,confirmed_amount_kopecks,payment_method,status,claimed_at,received_at,confirmed_at,confirmed_by_user_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'BANK_TRANSFER','CONFIRMED',$7,$7,$7,$8,$7,$7)", [claim, client, project, portal, payment[1], payment[2], now + position, user]);
    await q("INSERT INTO financial_transactions(id,amount_kopecks,transaction_date,type,author_user_id,cashbox_id,client_id,project_id,category,source,purpose,title,show_to_client,created_at,updated_at,client_payment_claim_id) VALUES($1,$2,$3,'INCOME',$4,$5,$6,$7,'CLIENT_PAYMENT','Client Portal','WORKS','Оплата клиента E2E',1,$3,$3,$8)", [tx, payment[2], now + position, user, cashbox, client, project, claim]);
  }
  const allocations = [["advance", "obl_advance_1", 30000000], ["balance_a", "obl_balance_1", 20000000], ["balance_b", "obl_advance_2", 18000000], ["partial", "obl_partial", 6000000], ["overpay", "obl_overpay", 4000000]];
  for (const [position, allocation] of allocations.entries()) await q("INSERT INTO obligation_payment_allocations(id,obligation_id,financial_transaction_id,amount_kopecks,created_at,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6)", [id(`allocation_${position}`), id(allocation[1]), id(`tx_${allocation[0].startsWith("balance") ? "balance" : allocation[0]}`), allocation[2], now, user]);
  await q("INSERT INTO client_unapplied_funds(id,client_id,project_id,financial_transaction_id,amount_kopecks,remaining_kopecks,created_at) VALUES($1,$2,$3,$4,1000000,1000000,$5)", [id("unapplied"), client, project, id("tx_overpay"), now]);
  await q("UPDATE cashboxes SET balance_kopecks=79000000,updated_at=$1 WHERE id=$2", [now, cashbox]);
  await q("INSERT INTO client_portal_audit_events(id,action,entity_type,entity_id,client_id,client_portal_user_id,metadata_json,occurred_at) VALUES($1,'FULL_APARTMENT_E2E','Project',$2,$3,$4,'{}',$5)", [id("portal_audit"), project, client, portal, now]);
  await q("INSERT INTO audit_logs(id,actor_user_id,action,entity_type,entity_id,occurred_at,metadata_json) VALUES($1,$2,'FULL_APARTMENT_E2E','Project',$3,$4,'{}')", [id("audit"), user, project, now]);

  // 177–214: Additional Works v1 — reject v1, approve v2, production, payment and schedule.
  const additionalWork = id("additional_work"), additionalV1 = id("additional_v1"), additionalV2 = id("additional_v2"), additionalTask = id("additional_task"), additionalObligation = id("additional_obligation"), additionalClaim = id("additional_claim"), additionalTx = id("additional_tx"), additionalFile = id("additional_file");
  await q("INSERT INTO additional_works(id,project_id,client_id,order_id,contract_id,stage_id,number,title,status,responsible_user_id,current_version_id,created_by_user_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'ДР-E2E-001','Дополнительная шумоизоляция','DRAFT',$7,NULL,$7,$8,$8)", [additionalWork, project, client, renovationOrder, contract, stages[1], user, now]);
  await q("INSERT INTO additional_work_versions(id,additional_work_id,project_id,version,title,amount_kopecks,schedule_delta_days,status,reason,client_description,internal_comment,schedule_impact_type,task_creation_mode,created_by_user_id,created_at,updated_at) VALUES($1,$2,$3,1,'Дополнительная шумоизоляция',1500000,2,'DRAFT','CLIENT_REQUEST','Первый вариант шумоизоляции','Внутренний v1','ADD_DAYS','AFTER_APPROVAL',$4,$5,$5)", [additionalV1, additionalWork, project, user, now]);
  await q("INSERT INTO additional_work_items(id,additional_work_version_id,position,name,quantity,unit,client_unit_price_kopecks,client_total_kopecks,internal_unit_cost_kopecks,created_at,updated_at) VALUES($1,$2,0,'Шумоизоляция',10,'м²',150000,1500000,90000,$3,$3)", [id("additional_item_v1"), additionalV1, now]);
  await q("UPDATE additional_works SET current_version_id=$1,status='AWAITING_CLIENT_APPROVAL' WHERE id=$2", [additionalV1, additionalWork]);
  await q("UPDATE additional_work_versions SET status='SENT',sent_at=$1,sent_by_user_id=$2 WHERE id=$3", [now, user, additionalV1]);
  await q("UPDATE additional_work_versions SET status='REJECTED',rejected_at=$1,client_decision_comment='Нужен другой материал' WHERE id=$2", [now, additionalV1]);
  await q("UPDATE additional_works SET status='REJECTED' WHERE id=$1", [additionalWork]);
  await q("INSERT INTO additional_work_versions(id,additional_work_id,project_id,version,title,amount_kopecks,schedule_delta_days,status,reason,client_description,internal_comment,schedule_impact_type,task_creation_mode,payment_due_date,created_by_user_id,created_at,updated_at) VALUES($1,$2,$3,2,'Дополнительная шумоизоляция',2000000,3,'DRAFT','CLIENT_REQUEST','Шумоизоляция согласованным материалом','Внутренний v2','ADD_DAYS','AFTER_APPROVAL',$5,$4,$5,$5)", [additionalV2, additionalWork, project, user, now]);
  await q("INSERT INTO additional_work_items(id,additional_work_version_id,position,name,quantity,unit,client_unit_price_kopecks,client_total_kopecks,internal_unit_cost_kopecks,created_at,updated_at) VALUES($1,$2,0,'Шумоизоляция Premium',10,'м²',200000,2000000,120000,$3,$3)", [id("additional_item_v2"), additionalV2, now]);
  await q("INSERT INTO additional_work_proposed_tasks(id,additional_work_version_id,stage_id,position,title,progress_type,quantity,unit,typical_duration_days,client_visible,created_at,updated_at) VALUES($1,$2,$3,0,'Монтаж дополнительной шумоизоляции','QUANTITY',10,'м²',3,1,$4,$4)", [id("additional_proposed_task"), additionalV2, stages[1], now]);
  await q("UPDATE additional_works SET current_version_id=$1,status='AWAITING_CLIENT_APPROVAL' WHERE id=$2", [additionalV2, additionalWork]);
  await q("UPDATE additional_work_versions SET status='SENT',sent_at=$1,sent_by_user_id=$2 WHERE id=$3", [now, user, additionalV2]);
  await q("UPDATE additional_work_versions SET status='APPROVED',approved_at=$1,approved_by_client_portal_user_id=$2 WHERE id=$3", [now, portal, additionalV2]);
  await q("UPDATE additional_works SET status='APPROVED',approved_version_id=$1,approved_by_client_portal_user_id=$2 WHERE id=$3", [additionalV2, portal, additionalWork]);
  await q("INSERT INTO tasks(id,title,project_id,client_id,status,created_by_user_id,production_plan_id,stage_id,position,progress_type,unit,planned_quantity,completed_quantity,weight_within_stage,planned_start_date,planned_end_date,planned_duration_days,responsible_user_id,client_visible,additional_work_id,additional_work_version_id,created_at,updated_at) VALUES($1,'Монтаж дополнительной шумоизоляции',$2,$3,'NOT_STARTED',$4,$5,$6,20,'QUANTITY','м²',10,0,0,$7,$8,3,$4,1,$9,$10,$11,$11)", [additionalTask, project, client, user, plan, stages[1], now + 5 * day, now + 8 * day, additionalWork, additionalV2, now]);
  await q("INSERT INTO additional_work_task_links(id,additional_work_id,additional_work_version_id,proposed_task_id,task_id,created_at) VALUES($1,$2,$3,$4,$5,$6)", [id("additional_task_link"), additionalWork, additionalV2, id("additional_proposed_task"), additionalTask, now]);
  await q("INSERT INTO obligations(id,direction,counterparty_type,counterparty_id,project_id,amount_kopecks,paid_kopecks,status,obligation_type,payment_plan_version,source_key,currency,additional_work_id,additional_work_version_id,created_at,updated_at) VALUES($1,'RECEIVABLE','CLIENT',$2,$3,2000000,2000000,'PAID','ADDITIONAL_WORK',1,$4,'RUB',$5,$6,$7,$7)", [additionalObligation, client, project, `additional_work:${additionalWork}:version:${additionalV2}`, additionalWork, additionalV2, now]);
  await q("INSERT INTO client_payment_claims(id,client_id,project_id,portal_user_id,claimed_amount_kopecks,confirmed_amount_kopecks,payment_method,status,claimed_at,received_at,confirmed_at,confirmed_by_user_id,created_at,updated_at) VALUES($1,$2,$3,$4,2000000,2000000,'BANK_TRANSFER','CONFIRMED',$5,$5,$5,$6,$5,$5)", [additionalClaim, client, project, portal, now, user]);
  await q("INSERT INTO financial_transactions(id,amount_kopecks,transaction_date,type,author_user_id,cashbox_id,client_id,project_id,category,source,purpose,title,show_to_client,created_at,updated_at,client_payment_claim_id) VALUES($1,2000000,$2,'INCOME',$3,$4,$5,$6,'CLIENT_PAYMENT','Client Portal','ADDITIONAL_WORKS','Оплата допработы E2E',1,$2,$2,$7)", [additionalTx, now, user, cashbox, client, project, additionalClaim]);
  await q("INSERT INTO obligation_payment_allocations(id,obligation_id,financial_transaction_id,amount_kopecks,created_at,created_by_user_id) VALUES($1,$2,$3,2000000,$4,$5)", [id("additional_allocation"), additionalObligation, additionalTx, now, user]);
  await q("UPDATE cashboxes SET balance_kopecks=balance_kopecks+2000000 WHERE id=$1", [cashbox]);
  await q("INSERT INTO attachments(id,project_id,additional_work_version_id,storage_key,original_filename,mime_type,size_bytes,storage_provider,blob_url,uploaded_by_user_id,entity_type,entity_id,category,visibility,upload_status,metadata_json,completed_at,linked_at,created_at,updated_at) VALUES($1,$2,$3,$4,'additional.pdf','application/pdf',128,'VERCEL_BLOB',$5,$6,'AdditionalWorkVersion',$3,'ADDITIONAL_WORK','CLIENT','LINKED','{}',$7,$7,$7,$7)", [additionalFile, project, additionalV2, `test-storage/${additionalFile}.pdf`, `https://test.private.blob.vercel-storage.com/${additionalFile}.pdf`, user, now]);
  const progress = await q(`WITH stage_progress AS (SELECT s.id,s.weight_within_project,COALESCE(SUM(t.weight_within_stage*CASE WHEN t.progress_type='BINARY' THEN CASE WHEN t.status='COMPLETED' THEN 100 ELSE 0 END ELSE 100*COALESCE(t.completed_quantity,0)/NULLIF(t.planned_quantity,0) END)/NULLIF(SUM(t.weight_within_stage),0),0) progress FROM project_stages s LEFT JOIN tasks t ON t.stage_id=s.id AND t.status<>'CANCELLED' WHERE s.production_plan_id=$1 GROUP BY s.id)
    SELECT ROUND((SELECT progress FROM stage_progress WHERE id=$2))::int stage_progress,ROUND(SUM(progress*weight_within_project)/SUM(weight_within_project))::int project_progress,ROUND(SUM(progress*weight_within_project)/SUM(weight_within_project))::int client_overall FROM stage_progress`, [plan, stages[1]]);
  assert.deepEqual(progress.rows[0], { stage_progress: 26, project_progress: 49, client_overall: 49 });
  const duplicateFacts = await q("SELECT (SELECT COUNT(*) FROM obligations WHERE source_key=$1)::int obligations,(SELECT COUNT(*) FROM additional_work_task_links WHERE proposed_task_id=$2)::int task_links", [`additional_work:${additionalWork}:version:${additionalV2}`, id("additional_proposed_task")]);
  assert.deepEqual(duplicateFacts.rows[0], { obligations: 1, task_links: 1 });
  const otherClient = id("other_client");
  await q("INSERT INTO clients(id,name,phone,phone_normalized,source,status,responsible_user_id,created_at,updated_at) VALUES($1,'Другой клиент E2E','+79990000999','79990000999','OTHER','ACTIVE',$2,$3,$3)", [otherClient, user, now]);
  const crossClient = await q("SELECT COUNT(*)::int count FROM additional_works WHERE id=$1 AND client_id=$2", [additionalWork, otherClient]);
  assert.equal(crossClient.rows[0].count, 0);
  const beforeSchedule = await q("SELECT planned_start_date FROM tasks WHERE id=$1", [id("task_paint")]);
  const applied = await q("UPDATE additional_work_versions SET schedule_applied_at=$1,schedule_applied_by_user_id=$2 WHERE id=$3 AND schedule_applied_at IS NULL RETURNING id", [now, user, additionalV2]);
  assert.equal(applied.rowCount, 1);
  await q("UPDATE tasks SET planned_start_date=planned_start_date+$1,planned_end_date=planned_end_date+$1 WHERE project_id=$2 AND additional_work_version_id IS DISTINCT FROM $3", [3 * day, project, additionalV2]);
  await q("UPDATE projects SET internal_forecast_end_date=$1 WHERE id=$2", [now + 13 * day, project]);
  const duplicateScheduleApply = await q("UPDATE additional_work_versions SET schedule_applied_at=$1 WHERE id=$2 AND schedule_applied_at IS NULL RETURNING id", [now + 1, additionalV2]);
  assert.equal(duplicateScheduleApply.rowCount, 0);
  const afterSchedule = await q("SELECT planned_start_date FROM tasks WHERE id=$1", [id("task_paint")]);
  assert.equal(Number(afterSchedule.rows[0].planned_start_date), Number(beforeSchedule.rows[0].planned_start_date) + 3 * day);
  const additionalFacts = await q("SELECT p.contract_amount_kopecks::int contract_amount,cv.contract_amount_kopecks::int signed_amount,p.published_forecast_end_date,aw.status,v.version,v.amount_kopecks::int amount,(p.contract_amount_kopecks+v.amount_kopecks)::int commercial FROM projects p JOIN contracts c ON c.id=p.contract_id JOIN contract_versions cv ON cv.id=c.signed_version_id JOIN additional_works aw ON aw.project_id=p.id JOIN additional_work_versions v ON v.id=aw.approved_version_id WHERE p.id=$1", [project]);
  assert.deepEqual(additionalFacts.rows[0], { contract_amount: 110000000, signed_amount: 110000000, published_forecast_end_date: null, status: "APPROVED", version: 2, amount: 2000000, commercial: 112000000 });

  // 215–258: Final Handover + Defects — two inspection rounds, correction task and final acceptance.
  await q("UPDATE tasks SET status='COMPLETED',completed_quantity=COALESCE(planned_quantity,completed_quantity),actual_end_date=$1,updated_at=$1 WHERE project_id=$2", [now, project]);
  await q("UPDATE project_stages SET status='COMPLETED',actual_end=$1,updated_at=$1 WHERE project_id=$2", [now, project]);
  const handover=id("handover"),round1=id("handover_round_1"),round2=id("handover_round_2"),defect=id("handover_defect"),defectTask=id("handover_defect_task"),defectPhoto=id("handover_defect_photo"),resolutionPhoto=id("handover_resolution_photo");
  const financeBeforeHandover=await q("SELECT (SELECT COUNT(*) FROM financial_transactions WHERE project_id=$1)::int transactions,(SELECT COUNT(*) FROM obligations WHERE project_id=$1)::int obligations,(SELECT balance_kopecks FROM cashboxes WHERE id=$2)::int balance",[project,cashbox]);
  await q("INSERT INTO project_handovers(id,project_id,status,current_round_id,prepared_at,prepared_by_user_id,sent_at,sent_by_user_id,created_at,updated_at) VALUES($1,$2,'READY_FOR_HANDOVER',NULL,$3,$4,NULL,NULL,$3,$3)",[handover,project,now,user]);
  await q("INSERT INTO project_handover_rounds(id,handover_id,project_id,round_number,status,opened_at,opened_by_user_id,created_at,updated_at) VALUES($1,$2,$3,1,'OPEN',$4,$5,$4,$4)",[round1,handover,project,now,user]);
  await q("UPDATE project_handovers SET current_round_id=$1,status='AWAITING_CLIENT_INSPECTION',sent_at=$2,sent_by_user_id=$3 WHERE id=$4",[round1,now,user,handover]);
  await q("INSERT INTO project_handover_events(id,handover_id,project_id,round_id,type,employee_user_id,occurred_at) VALUES($1,$2,$3,$4,'PREPARED',$5,$6),($7,$2,$3,$4,'SENT_TO_CLIENT',$5,$6)",[id("handover_prepared"),handover,project,round1,user,now,id("handover_sent")]);
  await q("INSERT INTO project_handover_defects(id,handover_id,round_id,project_id,defect_number,title,description,location,priority,status,created_by_client_portal_user_id,created_at,updated_at) VALUES($1,$2,$3,$4,1,'Царапина на откосе','Устранить царапину и восстановить покрытие','Спальня, левый откос','IMPORTANT','OPEN',$5,$6,$6)",[defect,handover,round1,project,portal,now]);
  await q("INSERT INTO attachments(id,project_id,handover_id,handover_round_id,handover_defect_id,client_visible,storage_key,original_filename,mime_type,size_bytes,storage_provider,blob_url,uploaded_by_user_id,entity_type,entity_id,category,visibility,upload_status,metadata_json,completed_at,linked_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,1,$6,'defect.jpg','image/jpeg',128,'VERCEL_BLOB',$7,$8,'ProjectHandoverDefect',$5,'HANDOVER_DEFECT','CLIENT','LINKED','{}',$9,$9,$9,$9)",[defectPhoto,project,handover,round1,defect,`test-storage/${defectPhoto}.jpg`,`https://test.private.blob.vercel-storage.com/${defectPhoto}.jpg`,user,now]);
  await q("UPDATE project_handover_rounds SET status='SUBMITTED_WITH_DEFECTS',submitted_at=$1,submitted_by_client_portal_user_id=$2,updated_at=$1 WHERE id=$3",[now,portal,round1]);
  await q("UPDATE project_handovers SET status='CORRECTIONS_REQUIRED',updated_at=$1 WHERE id=$2",[now,handover]);
  await q("INSERT INTO tasks(id,title,created_by_user_id,project_id,production_plan_id,stage_id,description,position,progress_type,weight_within_stage,responsible_user_id,client_visible,status,created_at,updated_at) VALUES($1,'Устранить царапину на откосе',$2,$3,$4,$5,'Замечание финальной сдачи',99,'BINARY',0,$2,1,'COMPLETED',$6,$6)",[defectTask,user,project,plan,stages[2],now]);
  await q("INSERT INTO handover_defect_task_links(id,defect_id,task_id,created_by_user_id,created_at) VALUES($1,$2,$3,$4,$5)",[id("handover_task_link"),defect,defectTask,user,now]);
  await q("UPDATE project_handover_defects SET status='RESOLVED',resolution_comment='Поверхность восстановлена, выполнена контрольная проверка.',resolved_at=$1,resolved_by_user_id=$2,updated_at=$1 WHERE id=$3",[now,user,defect]);
  await q("INSERT INTO attachments(id,project_id,handover_id,handover_round_id,handover_defect_id,client_visible,storage_key,original_filename,mime_type,size_bytes,storage_provider,blob_url,uploaded_by_user_id,entity_type,entity_id,category,visibility,upload_status,metadata_json,completed_at,linked_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,1,$6,'resolution.jpg','image/jpeg',128,'VERCEL_BLOB',$7,$8,'ProjectHandoverDefect',$5,'HANDOVER_DEFECT_RESOLUTION','CLIENT','LINKED','{}',$9,$9,$9,$9)",[resolutionPhoto,project,handover,round1,defect,`test-storage/${resolutionPhoto}.jpg`,`https://test.private.blob.vercel-storage.com/${resolutionPhoto}.jpg`,user,now]);
  await q("UPDATE project_handover_defects SET status='DISPUTED',disputed_at=$1,dispute_comment='Осталась небольшая неровность',updated_at=$1 WHERE id=$2",[now,defect]);
  await q("UPDATE project_handover_defects SET status='RESOLVED',resolution_comment='Неровность устранена повторно.',resolved_at=$1,resolved_by_user_id=$2,disputed_at=NULL,dispute_comment=NULL,updated_at=$1 WHERE id=$3",[now,user,defect]);
  await q("UPDATE project_handover_defects SET status='ACCEPTED',accepted_at=$1,accepted_by_client_portal_user_id=$2,updated_at=$1 WHERE id=$3",[now,portal,defect]);
  await q("INSERT INTO project_handover_rounds(id,handover_id,project_id,round_number,status,opened_at,opened_by_user_id,created_at,updated_at) VALUES($1,$2,$3,2,'OPEN',$4,$5,$4,$4)",[round2,handover,project,now,user]);
  await q("UPDATE project_handovers SET status='REINSPECTION_REQUIRED',current_round_id=$1,updated_at=$2 WHERE id=$3",[round2,now,handover]);
  await q("UPDATE project_handover_rounds SET status='ACCEPTED',accepted_at=$1,accepted_by_client_portal_user_id=$2,updated_at=$1 WHERE id=$3",[now,portal,round2]);
  await q("UPDATE project_handovers SET status='ACCEPTED',accepted_at=$1,accepted_by_client_portal_user_id=$2,actual_handover_at=$1,warranty_starts_at=$1,final_snapshot_json=$3::jsonb,updated_at=$1 WHERE id=$4",[now,portal,JSON.stringify({source:"CLIENT_PORTAL",round:2,acceptedDefects:1}),handover]);
  const handoverFacts=await q("SELECT h.status,h.actual_handover_at,h.warranty_starts_at,(SELECT COUNT(*) FROM project_handover_rounds WHERE handover_id=h.id)::int rounds,(SELECT COUNT(*) FROM project_handover_defects WHERE handover_id=h.id AND status='ACCEPTED')::int accepted_defects,(SELECT COUNT(*) FROM handover_defect_task_links l JOIN project_handover_defects d ON d.id=l.defect_id WHERE d.handover_id=h.id)::int task_links FROM project_handovers h WHERE h.id=$1",[handover]);
  assert.deepEqual(handoverFacts.rows[0],{status:"ACCEPTED",actual_handover_at:now,warranty_starts_at:now,rounds:2,accepted_defects:1,task_links:1});
  const financeAfterHandover=await q("SELECT (SELECT COUNT(*) FROM financial_transactions WHERE project_id=$1)::int transactions,(SELECT COUNT(*) FROM obligations WHERE project_id=$1)::int obligations,(SELECT balance_kopecks FROM cashboxes WHERE id=$2)::int balance",[project,cashbox]);
  assert.deepEqual(financeAfterHandover.rows[0],financeBeforeHandover.rows[0]);

  // 259–272 + full relation and independent money reconciliation.
  const relationAudit = await q(`SELECT
    (SELECT COUNT(*) FROM leads WHERE id=$1 AND linked_client_id=$2)::int lead_client,
    (SELECT COUNT(*) FROM orders WHERE client_id=$2)::int client_orders,
    (SELECT COUNT(*) FROM estimates WHERE client_id=$2 AND approved_version_id=$3)::int approved_estimate,
    (SELECT COUNT(*) FROM contracts WHERE client_id=$2 AND project_id=$4)::int client_contract,
    (SELECT COUNT(*) FROM projects WHERE id=$4 AND order_id=$5 AND contract_id=$6)::int project_links,
    (SELECT COUNT(*) FROM production_plans WHERE project_id=$4)::int plans,
    (SELECT COUNT(*) FROM project_stages WHERE production_plan_id=$7)::int stages,
    (SELECT COUNT(*) FROM tasks WHERE production_plan_id=$7)::int tasks,
    (SELECT COUNT(*) FROM task_dependencies WHERE project_id=$4)::int dependencies,
    (SELECT COUNT(*) FROM daily_report_tasks drt JOIN daily_reports dr ON dr.id=drt.daily_report_id WHERE dr.project_id=$4)::int report_tasks,
    (SELECT COUNT(*) FROM attachments WHERE project_id=$4 AND upload_status='LINKED')::int files,
    (SELECT COUNT(*) FROM financial_transactions WHERE project_id=$4 AND client_payment_claim_id IS NOT NULL)::int payments,
    (SELECT COUNT(*) FROM project_handovers WHERE project_id=$4 AND status='ACCEPTED')::int handovers,
    (SELECT COUNT(*) FROM project_handover_defects WHERE project_id=$4 AND status='ACCEPTED')::int accepted_defects`, [lead, client, estimateV2, project, renovationOrder, contract, plan]);
  assert.deepEqual(relationAudit.rows[0], { lead_client: 1, client_orders: 3, approved_estimate: 1, client_contract: 1, project_links: 1, plans: 1, stages: 3, tasks: 10, dependencies: 3, report_tasks: 1, files: 5, payments: 5, handovers: 1, accepted_defects: 1 });
  const money = await q(`SELECT
    (SELECT contract_amount_kopecks FROM projects WHERE id=$1)::int contract_amount,
    (SELECT SUM(stage_amount_kopecks) FROM project_stage_payment_terms WHERE project_id=$1 AND active=1)::int stage_amounts,
    (SELECT SUM(amount_kopecks) FROM obligations WHERE project_id=$1)::int obligations,
    (SELECT SUM(paid_kopecks) FROM obligations WHERE project_id=$1)::int allocated,
    (SELECT SUM(amount_kopecks) FROM financial_transactions WHERE project_id=$1 AND type='INCOME')::int confirmed,
    (SELECT balance_kopecks FROM cashboxes WHERE id=$2)::int cashbox_balance,
    (SELECT SUM(remaining_kopecks) FROM client_unapplied_funds WHERE project_id=$1)::int unapplied`, [project, cashbox]);
  assert.deepEqual(money.rows[0], { contract_amount: 110000000, stage_amounts: 110000000, obligations: 84000000, allocated: 80000000, confirmed: 81000000, cashbox_balance: 81000000, unapplied: 1000000 });
  assert.equal(money.rows[0].confirmed, money.rows[0].allocated + money.rows[0].unapplied);
  const portalPrivacy = await q("SELECT COUNT(*)::int count FROM project_delays WHERE project_id=$1 AND client_visible=1 AND client_comment IS NOT NULL AND internal_comment IS NULL", [project]);
  assert.equal(portalPrivacy.rows[0].count, 1);
  const globalSearch = await q("SELECT c.id,p.id project_id FROM contracts c JOIN projects p ON p.contract_id=c.id WHERE c.contract_number ILIKE '%E2E-C-001%'", []);
  assert.deepEqual(globalSearch.rows[0], { id: contract, project_id: project });
});
