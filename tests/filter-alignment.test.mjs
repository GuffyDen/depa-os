import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile("app/filter-controls.css", "utf8");
const layout = await readFile("app/layout.tsx", "utf8");

test("system-wide filter bars share one 44px control contract", () => {
  assert.match(layout, /filter-controls\.css/);
  assert.match(css, /--control-height:\s*44px/);
  assert.match(css, /--control-radius:\s*4px/);
  assert.match(css, /--control-padding-x:\s*12px/);
  assert.match(css, /align-items:\s*end/);
});

test("all production list filter patterns are covered centrally", () => {
  for (const selector of [
    ".crm-filters",
    ".client-filters",
    ".order-filters",
    ".project-filters",
    ".rc-filters",
    ".estimate-filters",
    ".contract-filters",
    ".finance-filter-bar",
    ".cashbox-history-filters",
    ".calendar-toolbar",
    ".handover-filter",
  ]) assert.match(css, new RegExp(selector.replace(".", "\\.")));
});

test("shared filter contract preserves focus, touch targets and responsive stacking", () => {
  assert.match(css, /:focus-visible/);
  assert.match(css, /box-shadow:\s*var\(--focus-ring\)/);
  assert.match(css, /@media \(max-width:\s*620px\)/);
  assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /font-size:\s*16px/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});
