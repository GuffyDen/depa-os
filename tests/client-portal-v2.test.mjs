import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [domain, ui, css, baseCss, access, route, photosRoute, clientFiles] = await Promise.all([
  read("lib/client-portal.ts"),
  read("app/client/client-portal-ui.tsx"),
  read("app/client/client-portal-v2.css"),
  read("app/client/client-portal.css"),
  read("app/clients-ui.tsx"),
  read("app/api/client/portal/route.ts"),
  read("app/api/client/photos/route.ts"),
  read("lib/client-files.ts"),
]);

const cases = [
  ["01 no database migration is introduced", () => assert.doesNotMatch(domain, /ALTER TABLE|CREATE TABLE/)],
  ["02 project address uses exact residential complex address", () => assert.match(domain, /rca\.id=p\.residential_complex_address_id/)],
  ["03 design address uses exact residential complex address", () => assert.match(domain, /rca\.id=dp\.residential_complex_address_id/)],
  ["04 inspection address uses exact residential complex address", () => assert.match(domain, /rca\.id=i\.residential_complex_address_id/)],
  ["05 service discovery is parallel", () => assert.match(domain, /\[projects, designs, inspections\] = await Promise\.all/)],
  ["06 inspection-only service is supported", () => assert.match(domain, /mode: "INSPECTION_ONLY"/)],
  ["07 design-only service is supported", () => assert.match(domain, /mode: "DESIGN_ONLY"/)],
  ["08 active renovation service is supported", () => assert.match(domain, /mode: completed \? "COMPLETED" : "PROJECT"/)],
  ["09 completed presentation is supported", () => assert.match(domain, /progress: completed \? 100 : overall/)],
  ["10 client action DTO is explicit", () => assert.match(domain, /export type ClientPortalAction/)],
  ["11 final handover has priority one", () => assert.match(domain, /type: "FINAL_HANDOVER", priority: 1/)],
  ["12 additional work has priority two", () => assert.match(domain, /type: "ADDITIONAL_WORK_APPROVAL", priority: 2/)],
  ["13 stage acceptance has priority three", () => assert.match(domain, /type: "STAGE_ACCEPTANCE", priority: 3/)],
  ["14 defect reinspection has priority four", () => assert.match(domain, /type: "DEFECT_REINSPECTION", priority: 4/)],
  ["15 payment due has priority five", () => assert.match(domain, /type: "PAYMENT_DUE", priority: 5/)],
  ["16 payment status has priority six", () => assert.match(domain, /type: "PAYMENT_CLAIM_STATUS", priority: 6/)],
  ["17 portal payload bounds daily reports", () => { assert.match(domain, /ORDER BY dr\.report_date DESC LIMIT 6/); assert.match(domain, /LIMIT 8\) a ON TRUE/); }],
  ["18 home payload bounds latest photos", () => assert.match(domain, /\.slice\(0, 5\)/)],
  ["19 published forecast is the only forecast", () => { assert.match(domain, /published_forecast_end_date/); assert.doesNotMatch(domain, /internal_forecast/i); }],
  ["20 mobile navigation has exactly five primary sections", () => assert.match(ui, /const nav=\["Главная","Работы","Фото","Оплаты","Ещё"\]/)],
  ["21 deep contextual section survives refresh", () => assert.match(ui, /URLSearchParams\(window\.location\.search\)\.get\("section"\)/)],
  ["22 more contains documents and contextual services", () => assert.match(ui, /Документы и сервисы/)],
  ["23 payment claim copy says balance is not automatic", () => assert.match(ui, /не меняет баланс автоматически/)],
  ["24 mobile layout retains five equal destinations", () => assert.match(baseCss, /repeat\(5,1fr\)/)],
  ["25 portal API requires client authentication", () => assert.match(route, /Требуется авторизация клиента/)],
  ["26 protected files enforce client ownership", () => assert.match(clientFiles, /client_id|clientId/)],
];

for (const [name, check] of cases) test(name, check);

test("v2 additions keep touch targets and responsive layout", () => {
  assert.match(css, /min-height: 92px/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(access, /clientPortal\.manageAccess/);
  assert.match(photosRoute, /Требуется авторизация клиента/);
  assert.match(ui, /Показать ещё/);
});
