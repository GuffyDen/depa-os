import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("CRM stages, actions and refusal reasons are centralized", async () => {
  const config=await read("lib/crm-config.ts");
  for(const value of ["NEW","CONTACTED","INSPECTION","CALCULATION","PROPOSAL","CONTRACT","WON","LOST","CALL","PRICE"]) assert.match(config,new RegExp(value));
});

test("CRM v1 extends the existing leads table without demo records", async () => {
  const migration = await read("drizzle/postgres/0008_crm_v1.sql");
  assert.match(migration, /ALTER TABLE leads RENAME COLUMN client_id TO linked_client_id/);
  assert.match(migration, /CREATE TABLE lead_activities/);
  assert.match(migration, /responsible_user_id/);
  assert.doesNotMatch(migration, /CREATE TABLE leads/);
  assert.doesNotMatch(migration, /INSERT INTO leads/);
});

test("CRM APIs use authenticated real-data services and expose no delete route", async () => {
  const [collection, detail] = await Promise.all([read("app/api/crm/route.ts"), read("app/api/crm/[id]/route.ts")]);
  assert.match(collection, /getRequestUser/);
  assert.match(collection, /listLeads/);
  assert.match(detail, /createActivity/);
  assert.match(detail, /completeActivity/);
  assert.doesNotMatch(`${collection}${detail}`, /export async function DELETE/);
});

test("CRM backend enforces assigned scope, backend filters and bounded pagination", async () => {
  const data = await read("lib/crm.ts");
  assert.match(data, /access\.scopes\.crm!=="ALL"/);
  assert.match(data, /l\.responsible_user_id=/);
  assert.match(data, /l\.normalized_phone LIKE/);
  assert.match(data, /ROW_NUMBER\(\) OVER\(PARTITION BY l\.stage/);
  assert.match(data, /filterParams=\[\.\.\.params\]/);
  assert.match(data, /GROUP BY l\.stage`,filterParams/);
  assert.match(data, /nextOffset/);
});

test("duplicate protection covers active leads and clients", async () => {
  const data = await read("lib/crm.ts");
  assert.match(data, /l\.normalized_phone=\$1/);
  assert.match(data, /l\.stage NOT IN \('WON','LOST'\)/);
  assert.match(data, /FROM clients WHERE phone_normalized=\$1/);
  assert.match(data, /Возможный дубль заявки/);
});

test("closing rules require client for WON and reason for LOST", async () => {
  const data = await read("lib/crm.ts");
  assert.match(data, /data\.stage==="WON"&&!data\.linkedClientId/);
  assert.match(data, /data\.stage==="LOST"&&!clean\(input\.lostReason/);
  assert.match(data, /crm\.close/);
});

test("lead actions preserve history and synchronize the current next action", async () => {
  const data = await read("lib/crm.ts");
  assert.match(data, /INSERT INTO lead_activities/);
  assert.match(data, /UPDATE leads SET next_action_type=/);
  assert.match(data, /activity\.status!=="SCHEDULED"/);
  for (const event of ["LEAD_CREATED","LEAD_UPDATED","LEAD_STAGE_CHANGED","LEAD_WON","LEAD_LOST","LEAD_REOPENED","LEAD_ACTIVITY_CREATED","LEAD_ACTIVITY_COMPLETED"]) assert.match(data, new RegExp(event));
});

test("working CRM UI replaces fake cards and supports mobile list fallback", async () => {
  const [shell, ui, css] = await Promise.all([read("app/depa-os.tsx"), read("app/crm-ui.tsx"), read("app/crm.css")]);
  assert.match(shell, /<CrmScreen/);
  assert.doesNotMatch(shell, /Анна Романова|18,4 млн/);
  assert.match(ui, /matchMedia\("\(max-width: 780px\)"\)/);
  assert.match(ui, /mobile\s*\|\|\s*mode\s*===\s*"list"/);
  assert.match(css, /crm-kanban/);
});

test("dashboard, global search and client history use real CRM data", async () => {
  const [shell, clients] = await Promise.all([read("app/depa-os.tsx"), read("lib/clients.ts")]);
  assert.match(shell, /attention=1/);
  assert.match(shell, /stageCounts/);
  assert.match(shell, /ЗАЯВКИ/);
  assert.match(clients, /l\.linked_client_id=\$1/);
});

test("won lead can create a real order for its linked client", async () => {
  const ui = await read("app/crm-ui.tsx");
  assert.match(ui, /Создать заказ/);
  assert.match(ui, /detail\.capabilities\.createOrder/);
  assert.match(ui, /onCreateOrder/);
  assert.doesNotMatch(ui, /Модуль заказов будет подключён позже/);
});
