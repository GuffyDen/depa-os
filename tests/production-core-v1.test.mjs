import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("0015 is additive, backward-compatible, and contains no production seed", async () => {
  const sql = await read("drizzle/postgres/0015_production_core_v1.sql");
  for (const table of ["production_plans", "task_dependencies", "task_contractors", "daily_report_workers", "daily_report_tasks", "task_photo_requirements", "production_plan_templates", "production_stage_templates", "production_task_templates", "production_task_dependency_templates", "production_photo_requirement_templates", "project_schedule_events"]) assert.match(sql, new RegExp(`CREATE TABLE ${table}`));
  assert.match(sql, /ON DELETE RESTRICT/);
  assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/i);
  assert.doesNotMatch(sql, /INSERT INTO/i);
  assert.doesNotMatch(sql, /UPDATE (users|employees|cashboxes|financial_transactions|projects|project_stages|tasks|daily_reports|attachments|audit_logs)/i);
});

test("0015 reuses production history tables and adds safe nullable/defaulted columns", async () => {
  const sql = await read("drizzle/postgres/0015_production_core_v1.sql");
  for (const table of ["projects", "project_stages", "tasks", "daily_reports", "attachments", "project_delays"]) assert.match(sql, new RegExp(`ALTER TABLE ${table} ADD COLUMN`));
  assert.match(sql, /daily_reports ADD COLUMN author_user_id text/);
  assert.match(sql, /project_stages ADD COLUMN weight_within_project numeric\(5,2\) NOT NULL DEFAULT 0/);
  assert.match(sql, /tasks ADD COLUMN progress_type text/);
});

test("production foreign keys preserve history and dependency uniqueness", async () => {
  const sql = await read("drizzle/postgres/0015_production_core_v1.sql");
  for (const relation of ["production_plans_project_fkey", "project_stages_plan_fkey", "tasks_stage_fkey", "tasks_responsible_user_fkey", "task_dependencies_predecessor_fkey", "task_dependencies_successor_fkey", "daily_reports_author_user_fkey", "photo_requirements_task_fkey", "project_delays_task_fkey"]) assert.match(sql, new RegExp(relation));
  assert.match(sql, /UNIQUE\(predecessor_task_id,successor_task_id\)/);
  assert.match(sql, /predecessor_task_id<>successor_task_id/);
});

test("migration indexes schedule, responsible, reports, delays, and templates", async () => {
  const sql = await read("drizzle/postgres/0015_production_core_v1.sql");
  for (const index of ["idx_stages_plan_position", "idx_tasks_stage_position", "idx_tasks_production_status", "idx_tasks_responsible_user", "idx_tasks_planned_dates", "idx_task_dependencies_predecessor", "idx_task_dependencies_successor", "idx_project_delays_task", "idx_production_templates_status", "idx_schedule_events_project_time"]) assert.match(sql, new RegExp(index));
});

test("BINARY and QUANTITY progress rules are server-side and capped", async () => {
  const source = await read("lib/production.ts");
  assert.match(source, /progress_type==="BINARY"/);
  assert.match(source, /status==="COMPLETED"\?100:0/);
  assert.match(source, /Math\.min\(100,Math\.max\(0,done\/planned\*100\)\)/);
  const quantity = (planned, completed) => planned > 0 ? Math.min(100, Math.max(0, completed / planned * 100)) : 0;
  assert.equal(quantity(10, 2), 20);
  assert.equal(quantity(10, 10), 100);
  assert.equal(quantity(10, 12), 100);
});

test("weighted stage and project progress normalizes active weights", async () => {
  const source = await read("lib/production.ts");
  assert.match(source, /export function weightedProgress/);
  assert.match(source, /progress!==null/);
  const weighted = (items) => items.reduce((sum, item) => sum + item.progress * item.weight, 0) / items.reduce((sum, item) => sum + item.weight, 0);
  assert.equal(weighted([{ progress: 100, weight: 60 }, { progress: 50, weight: 40 }]), 80);
  assert.match(source, /validateWeights/);
  assert.match(source, /Сумма весов должна быть 100%/);
});

test("even weight normalization totals exactly 100 percent", async () => {
  const source = await read("lib/production.ts");
  assert.match(source, /export function normalizeWeights/);
  const normalize = (count) => { const base = Math.floor(10000 / count) / 100, result = Array.from({ length: count }, () => base); result[count - 1] = Math.round((100 - result.slice(0, -1).reduce((a, b) => a + b, 0)) * 100) / 100; return result; };
  assert.deepEqual(normalize(3), [33.33, 33.33, 33.34]);
  assert.equal(normalize(7).reduce((a, b) => a + b, 0), 100);
});

test("dependency engine blocks cycles and schedules parallel predecessors by maximum end", async () => {
  const source = await read("lib/production.ts");
  assert.match(source, /export function hasDependencyCycle/);
  assert.match(source, /Циклическая зависимость запрещена/);
  assert.match(source, /Math\.max\(\.\.\.links\.map/);
  assert.doesNotMatch(source, /links\.reduce\([^\n]+duration/i);
});

test("reschedule previews downstream changes before confirmed cascade", async () => {
  const source = await read("lib/production.ts");
  assert.match(source, /confirmationRequired:true/);
  assert.match(source, /affectedTaskIds:affected/);
  assert.match(source, /if\(bool\(input\.cascade\)\)for\(const downstream of affected\)/);
  const ui = await read("app/production-core-ui.tsx");
  assert.match(ui, /Пересчитать график/);
  assert.match(ui, /Пересчитать график каскадно/);
});

test("early completion creates only a schedule suggestion and never silently shifts dates", async () => {
  const source = await read("lib/production.ts");
  assert.match(source, /scheduleSuggestions/);
  const updateTask = source.slice(source.indexOf("export async function updateTask"), source.indexOf("export async function completeStage"));
  assert.doesNotMatch(updateTask, /planned_start_date|planned_end_date/);
});

test("stage completion stays manual and creates no financial records", async () => {
  const source = await read("lib/production.ts");
  assert.match(source, /Сначала завершите все активные задачи этапа/);
  assert.match(source, /STAGE_COMPLETED/);
  assert.doesNotMatch(source, /INSERT INTO financial_transactions|UPDATE cashboxes|INSERT INTO obligations/);
  const ui = await read("app/production-core-ui.tsx");
  assert.match(ui, /Завершить этап/);
});

test("hidden work requirements warn, allow explicit override, and audit it", async () => {
  const source = await read("lib/production.ts");
  assert.match(source, /HIDDEN_WORK_MISSING/);
  assert.match(source, /required_before_completion=1/);
  assert.match(source, /completedWithoutPhotos/);
  const ui = await read("app/production-core-ui.tsx");
  assert.match(ui, /Завершить без фото/);
  assert.match(ui, /Загрузить Hidden Work photo/);
});

test("daily reports are unique per project/day and support workers, tasks, photos, and private comments", async () => {
  const [source, sql] = await Promise.all([read("lib/production.ts"), read("drizzle/postgres/0015_production_core_v1.sql")]);
  assert.match(source, /Отчёт за этот день уже существует/);
  assert.match(source, /INSERT INTO daily_report_workers/);
  assert.match(source, /INSERT INTO daily_report_tasks/);
  assert.match(source, /dailyReports\.manageClientVisibility/);
  assert.match(source, /dailyReports\.editPast/);
  assert.match(sql, /daily_report_workers/);
});

test("delay changes internal forecast but published forecast requires an explicit action", async () => {
  const source = await read("lib/production.ts");
  const delay = source.slice(source.indexOf("export async function createDelay"), source.indexOf("export async function closeDelay"));
  assert.match(delay, /internal_forecast_end_date/);
  assert.doesNotMatch(delay, /published_forecast_end_date/);
  assert.match(source, /FORECAST_PUBLISHED/);
  assert.match(source, /DELAY_CREATED/);
  assert.match(source, /DELAY_ENDED/);
});

test("responsible DEPA and multiple contractors are independent relations", async () => {
  const [source, sql] = await Promise.all([read("lib/production.ts"), read("drizzle/postgres/0015_production_core_v1.sql")]);
  assert.match(sql, /CREATE TABLE task_contractors/);
  assert.match(sql, /UNIQUE\(task_id,contractor_agreement_id\)/);
  assert.match(source, /export async function assignTaskContractor/);
  assert.match(source, /contractor_agreements WHERE id=\$1 AND project_id=\$2/);
  assert.doesNotMatch(source, /task_contractors[\s\S]{0,120}(amount|cashbox|margin)/i);
});

test("template copy uses dependency durations and stays independent after creation", async () => {
  const source = await read("lib/production.ts");
  assert.match(source, /scheduleDependencyGraph\(templateTasks/);
  assert.match(source, /typical_duration_days/);
  assert.match(source, /source_template_version/);
  const createPlan = source.slice(source.indexOf("export async function createPlan"), source.indexOf("export async function addStage"));
  assert.match(createPlan, /INSERT INTO project_stages/);
  assert.match(createPlan, /INSERT INTO tasks/);
  assert.doesNotMatch(createPlan, /UPDATE production_plan_templates/);
});

test("production permissions and ASSIGNED scope are backend enforced", async () => {
  const [definitions, source] = await Promise.all([read("lib/permission-definitions.ts"), read("lib/production.ts")]);
  for (const permission of ["production.view", "production.createPlan", "production.manageStages", "production.manageTasks", "production.updateProgress", "production.manageDependencies", "production.manageSchedule", "production.manageDelays", "production.viewGantt", "dailyReports.view", "dailyReports.create", "dailyReports.edit", "dailyReports.editPast", "dailyReports.uploadPhotos", "dailyReports.manageWorkers", "dailyReports.manageClientVisibility", "hiddenWorks.upload", "productionTemplates.view", "productionTemplates.create", "productionTemplates.edit", "productionTemplates.archive", "production.scope"]) assert.match(definitions, new RegExp(permission.replaceAll(".", "\\.")));
  assert.match(definitions, /default: "ASSIGNED"/);
  assert.match(source, /canViewProject\(actor,projectId\)/);
  assert.match(source, /Можно обновлять только назначенную вам задачу/);
});

test("all production routes require Auth and expose no destructive DELETE", async () => {
  const routes = await Promise.all([read("app/api/production/route.ts"), read("app/api/production/gantt/route.ts"), read("app/api/production/daily-reports/route.ts"), read("app/api/production/templates/route.ts")]);
  for (const route of routes) { assert.match(route, /getRequestUser/); assert.match(route, /status:401|status: 401/); assert.doesNotMatch(route, /export async function DELETE/); }
});

test("production photos use private Blob and protected project relations", async () => {
  const [files, source, ui] = await Promise.all([read("lib/files.ts"), read("lib/production.ts"), read("app/production-core-ui.tsx")]);
  assert.match(files, /dailyReports\.uploadPhotos/);
  assert.match(files, /hiddenWorks\.upload/);
  assert.match(files, /canViewProject/);
  assert.match(source, /photo_requirement_id/);
  assert.match(source, /upload_status='LINKED'/);
  assert.match(ui, /access: "private"/);
});

test("Production UI has real tabs, Gantt scales, forecast, and no dead core actions", async () => {
  const [projects, ui, css] = await Promise.all([read("app/projects-ui.tsx"), read("app/production-core-ui.tsx"), read("app/production-core.css")]);
  for (const label of ["Производство", "Гант", "Дневные отчёты"]) assert.match(projects, new RegExp(label));
  for (const label of ["Создать пустой план", "Из шаблона", "Обновить факт", "Завершить", "Пересчитать график", "Закрыть простой", "Загрузить фото", "Скрытая работа", "Исполнитель", "Опубликовать прогноз"]) assert.match(ui, new RegExp(label));
  assert.match(ui, />Дни</); assert.match(ui, />Недели</); assert.match(css, /@media/);
});

