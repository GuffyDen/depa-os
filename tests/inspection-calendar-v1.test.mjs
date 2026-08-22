import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("inspection calendar migration backfills explicit start and end times", async () => {
  const migration = await read("drizzle/postgres/0010_inspection_calendar.sql");
  assert.match(migration, /ADD COLUMN scheduled_start_at integer/);
  assert.match(migration, /ADD COLUMN scheduled_end_at integer/);
  assert.match(migration, /scheduled_end_at=scheduled_at\+5400/);
  assert.match(migration, /scheduled_end_at>scheduled_start_at/);
  assert.match(migration, /idx_inspections_inspector_schedule/);
});

test("calendar reads and conflict checks are scoped on the backend", async () => {
  const [orders, route] = await Promise.all([
    read("lib/orders.ts"),
    read("app/api/orders/route.ts"),
  ]);
  assert.match(route, /view\s*===\s*"calendar"[\s\S]*listInspectionCalendar/);
  assert.match(orders, /export async function listInspectionCalendar/);
  assert.match(
    orders,
    /addScope\(\s*actor,\s*access\.scopes\.orders\s*===\s*"ALL"/,
  );
  assert.match(orders, /i\.scheduled_start_at<\$2 AND i\.scheduled_end_at>\$3/);
  assert.match(orders, /code:\s*"SCHEDULE_CONFLICT"/);
  assert.match(orders, /input\.allowConflict\s*!==\s*true/);
  assert.doesNotMatch(orders, /EXCLUDE USING gist/);
});

test("orders UI provides month and day planning with quick creation and specialist filter", async () => {
  const [ordersUi, calendarUi, css] = await Promise.all([
    read("app/orders-ui.tsx"),
    read("app/inspection-calendar.tsx"),
    read("app/orders.css"),
  ]);
  assert.match(ordersUi, /Список/);
  assert.match(ordersUi, /Календарь/);
  assert.match(ordersUi, /scheduledStartAt/);
  assert.match(ordersUi, /scheduledEndAt/);
  assert.match(ordersUi, /Сохранить всё равно/);
  assert.match(calendarUi, /Месяц/);
  assert.match(calendarUi, /День/);
  assert.match(calendarUi, /Все специалисты/);
  assert.match(calendarUi, /Назначить приёмку/);
  assert.match(calendarUi, /Сегодня/);
  assert.match(css, /calendar-event/);
  assert.match(css, /mobile-day-list/);
  assert.doesNotMatch(calendarUi, /drag|drop/i);
});
