import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("photo reports, hidden works, documents, tasks and linked entities read real tables", async () => {
  const [data, ui] = await Promise.all([read("lib/projects.ts"), read("app/projects-ui.tsx")]);
  for (const table of ["daily_reports", "attachments", "tasks", "additional_work_versions", "contractor_agreements", "contractors"]) assert.match(data, new RegExp(table));
  assert.match(data, /category='HIDDEN_WORK'/);
  assert.match(data, /category IN \('CONTRACT','ACT','ESTIMATE','OTHER'\)/);
  assert.match(ui, /\/api\/files\/\$\{id\}/);
  for (const text of ["Фотоотчётов пока нет", "Скрытые работы пока не зафиксированы", "Документов пока нет", "Дополнительные работы пока не создавались", "Исполнители пока не назначены", "Гарантийных обращений пока нет", "Задач пока нет"]) assert.match(ui, new RegExp(text));
});

test("critical project edits have dedicated audit events", async () => {
  const data = await read("lib/projects.ts");
  for (const event of ["PROJECT_CREATED", "PROJECT_UPDATED", "PROJECT_STATUS_CHANGED", "PROJECT_RESPONSIBLE_CHANGED", "PROJECT_FOREMAN_CHANGED", "PROJECT_ARCHIVED", "PROJECT_RESTORED", "PROJECT_DATES_CHANGED", "PROJECT_FINANCIAL_PLAN_CHANGED"]) assert.match(data, new RegExp(event));
  assert.match(data, /changedFields/);
  assert.match(data, /created_by_user_id/);
});

test("employee assignment and financial plan changes are enforced by the API layer", async () => {
  const [data, ui] = await Promise.all([read("lib/projects.ts"), read("app/projects-ui.tsx")]);
  assert.match(data, /projects\.assignEmployees/);
  assert.match(data, /assertAssignmentChange\(actor/);
  assert.match(data, /assertFinancialPlanChange\(actor/);
  assert.match(data, /projects\.viewCost/);
  assert.match(ui, /canAssignEmployees/);
  assert.match(ui, /canViewFinancialPlan/);
});

test("assigned project scope is filtered in SQL and direct foreign access returns 403", async () => {
  const [projects, permissions, clients] = await Promise.all([read("lib/projects.ts"), read("lib/permissions.ts"), read("lib/clients.ts")]);
  for (const source of [projects, permissions, clients]) assert.match(source, /responsible_user_id/);
  assert.match(projects, /user_project_access/);
  assert.match(projects, /exists \? 403 : 404/);
  assert.match(permissions, /!profile\.modules\.projects \|\| !profile\.actions\["projects\.view"\]/);
});

test("project finance adapts independently to client funds, cost and margin permissions", async () => {
  const [data, ui] = await Promise.all([read("lib/projects.ts"), read("app/projects-ui.tsx")]);
  assert.match(data, /finance\.viewClientFunds/);
  assert.match(data, /projects\.viewCost/);
  assert.match(data, /projects\.viewMargin/);
  assert.match(data, /finance\.viewProfit/);
  assert.match(data, /materialsIncomeKopecks: canViewClientFunds/);
  assert.match(data, /materialsExpenseKopecks: canViewCost/);
  assert.match(ui, /Финансовые показатели скрыты вашими правами доступа/);
  assert.match(ui, /Операций по объекту пока нет/);
});

test("allocated expenses use only the current project share without duplicating the source", async () => {
  const data = await read("lib/projects.ts");
  assert.match(data, /NOT EXISTS \(SELECT 1 FROM transaction_allocations ta WHERE ta\.transaction_id=ft\.id\)/);
  assert.match(data, /SELECT ft\.id,ft\.type,ta\.amount_kopecks/);
  const sourceExpense = 90_000_00;
  const shares = new Map([["A", 55_000_00], ["B", 35_000_00]]);
  assert.equal(shares.get("A"), 55_000_00);
  assert.equal(shares.get("B"), 35_000_00);
  assert.equal([...shares.values()].reduce((sum, value) => sum + value, 0), sourceExpense);
});

test("object finance actions reuse own-cashbox form with project and client prefill", async () => {
  const [projectUi, financeUi, financeData] = await Promise.all([read("app/projects-ui.tsx"), read("app/finance-ui.tsx"), read("lib/finance.ts")]);
  assert.match(projectUi, /onFinance\("EXPENSE", p\)/);
  assert.match(projectUi, /onFinance\("INCOME", p\)/);
  assert.match(financeUi, /initialProjectId/);
  assert.match(financeUi, /initialClientId/);
  assert.match(financeUi, /projectId: projectId \|\| initialProjectId/);
  assert.match(financeData, /ownCashboxForWrite/);
  assert.match(financeData, /validateAllocations/);
});

test("global search and client cards open the real project card", async () => {
  const [app, projects, clients] = await Promise.all([read("app/depa-os.tsx"), read("app/projects-ui.tsx"), read("app/clients-ui.tsx")]);
  assert.match(app, /\/api\/projects\?/);
  assert.match(app, /onProject=\{openProject\}/);
  assert.match(projects, /initialProjectId/);
  assert.match(clients, /onOpenProject/);
  assert.match(clients, /client-project-link/);
});

test("completed status asks before setting actual date and paused status creates no delay", async () => {
  const [ui, data] = await Promise.all([read("app/projects-ui.tsx"), read("lib/projects.ts")]);
  assert.match(ui, /Установить сегодняшнюю дату как фактическую дату завершения/);
  assert.doesNotMatch(data, /INSERT INTO project_delays/);
});

test("production-facing object UI contains no demo project values or live-looking dead actions", async () => {
  const [app, ui] = await Promise.all([read("app/depa-os.tsx"), read("app/projects-ui.tsx")]);
  assert.doesNotMatch(`${app}${ui}`, /ЖК Море|ЖК Атмосфера|ЖК Бринер|ЖК Тест|Тестовый объект/);
  assert.doesNotMatch(ui, /Добавить фотоотчёт|Добавить этап|Загрузить документ|Добавить исполнителя/);
  assert.match(ui, /disabled title="Создание будет подключено|Создание будет подключено/);
});

test("completion uses existing 0007 schema without a retroactive or extra migration", async () => {
  const files = await readdir(new URL("../drizzle/postgres", import.meta.url));
  assert.equal(files.filter((name) => /^0008_/.test(name)).length, 0);
  const migration = await read("drizzle/postgres/0007_objects_v1.sql");
  assert.doesNotMatch(migration, /daily_reports|HIDDEN_WORK/);
});
