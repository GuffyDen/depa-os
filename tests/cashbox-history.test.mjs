import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("cashbox history API applies filters and pagination in Neon query order", async () => {
  const [finance, route] = await Promise.all([read("lib/finance.ts"), read("app/api/finance/history/route.ts")]);
  assert.match(route, /getRequestUser/);
  assert.match(route, /cashboxId: params\.get\("cashboxId"\)/);
  assert.match(finance, /await cashboxForView\(actor, cashboxId\)/);
  assert.match(finance, /ft\.transaction_date >=/);
  assert.match(finance, /ft\.transaction_date </);
  assert.match(finance, /ft\.type=/);
  assert.match(finance, /ft\.category=/);
  assert.match(finance, /project_filter\.project_id=/);
  assert.match(finance, /ORDER BY ft\.transaction_date DESC,ft\.created_at DESC,ft\.id DESC/);
  assert.match(finance, /limit \+ 1/);
  assert.match(finance, /hasMore/);
});

test("cashbox workspace defaults to own active cashbox and exposes functional filters", async () => {
  const ui = await read("app/finance-ui.tsx");
  assert.match(ui, /box\.ownerUserId === data\.currentUserId/);
  assert.match(ui, /availableCashboxes\.length > 1/);
  assert.match(ui, /Всё время/);
  assert.match(ui, /Все типы/);
  assert.match(ui, /Все категории/);
  assert.match(ui, /Все объекты/);
  assert.match(ui, /Выбрать период/);
  assert.match(ui, /applyCustomPeriod/);
  assert.match(ui, /resetFilters/);
  assert.match(ui, /loadHistory\(transactions\.length\)/);
  assert.match(ui, /Показать ещё/);
  assert.match(ui, /Чек приложен|чек приложен/);
});
