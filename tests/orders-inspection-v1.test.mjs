import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DEFECT_CATEGORIES, DEFECT_SEVERITIES, ORDER_STATUSES, ORDER_TYPES } from "../lib/orders-config.ts";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("order, inspection and defect dictionaries are centralized", () => {
  assert.deepEqual(ORDER_TYPES.map((item) => item.value), ["INSPECTION", "RENOVATION"]);
  assert.deepEqual(ORDER_STATUSES.map((item) => item.value), ["NEW", "SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]);
  assert.equal(DEFECT_CATEGORIES.length, 10);
  assert.deepEqual(DEFECT_SEVERITIES.map(([value]) => value), ["LOW", "MEDIUM", "HIGH"]);
});

test("orders v1 extends existing orders and creates relational inspection tables", async () => {
  const migration = await read("drizzle/postgres/0009_orders_inspection_v1.sql");
  assert.match(migration, /ALTER TABLE orders ADD COLUMN responsible_user_id/);
  assert.match(migration, /CREATE TABLE inspections/);
  assert.match(migration, /CREATE TABLE inspection_defects/);
  assert.match(migration, /REFERENCES orders\(id\) ON DELETE RESTRICT/);
  assert.match(migration, /REFERENCES inspections\(id\) ON DELETE RESTRICT/);
  assert.doesNotMatch(migration, /CREATE TABLE orders/);
  assert.doesNotMatch(migration, /INSERT INTO orders/);
});

test("orders APIs use authenticated services and expose no destructive delete", async () => {
  const [collection, detail] = await Promise.all([read("app/api/orders/route.ts"), read("app/api/orders/[id]/route.ts")]);
  assert.match(collection, /getRequestUser/);
  assert.match(collection, /listOrders/);
  assert.match(collection, /createOrder/);
  assert.match(detail, /getOrder/);
  assert.match(detail, /updateOrder/);
  assert.doesNotMatch(`${collection}${detail}`, /export async function DELETE/);
});

test("order list derives payment from finance and filters entirely in SQL", async () => {
  const data = await read("lib/orders.ts");
  assert.match(data, /financial_transactions ft WHERE ft\.order_id=o\.id AND ft\.type='INCOME'/);
  for (const term of ["o.number ILIKE", "c.name ILIKE", "c.phone_normalized LIKE", "i.address ILIKE", "i.residential_complex ILIKE", "i.apartment_number ILIKE"]) assert.match(data, new RegExp(term.replaceAll(".", "\\.")));
  assert.match(data, /access\.scopes\.clients/);
  assert.match(data, /nextOffset/);
  assert.match(data, /REQUEST_PAYMENT/);
});

test("working order UI is connected to clients, finance, files, search and dashboard", async () => {
  const [shell, ui, clients, finance, files] = await Promise.all([read("app/depa-os.tsx"), read("app/orders-ui.tsx"), read("app/clients-ui.tsx"), read("lib/finance.ts"), read("lib/files.ts")]);
  assert.match(shell, /<OrdersScreen/);
  assert.match(shell, /attention=1/);
  assert.match(shell, /ЗАКАЗЫ/);
  assert.match(clients, /onCreateOrder/);
  assert.match(clients, /onOpenOrder/);
  assert.match(finance, /order_id/);
  assert.match(files, /assertInspectionFileAccess/);
  assert.match(ui, /capture="environment"/);
  assert.match(ui, /2400/);
  assert.match(ui, /Завершить приёмку/);
  assert.doesNotMatch(shell, /DEP-0268|Александр Иванов/);
});

test("inspection lifecycle and mutations preserve audit history without hard deletes", async () => {
  const data = await read("lib/orders.ts");
  for (const event of ["ORDER_CREATED", "ORDER_UPDATED", "ORDER_CANCELLED", "INSPECTION_CREATED", "INSPECTION_STARTED", "INSPECTION_COMPLETED", "INSPECTION_DEFECT_CREATED", "INSPECTION_DEFECT_STATUS_CHANGED", "ATTACHMENT_LINKED"]) assert.match(data, new RegExp(event));
  assert.doesNotMatch(data, /DELETE FROM (orders|inspections|inspection_defects)/);
});
