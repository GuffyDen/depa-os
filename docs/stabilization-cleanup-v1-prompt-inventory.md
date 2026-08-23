# DEPA OS Stabilization Cleanup v1 — prompt inventory

Inventory date: 2026-08-23. Scope: production-facing `app/**/*.tsx`. No production data was changed.

## Business-input prompts before cleanup

There were 27 `window.prompt` call sites. All were classified as A (critical business action) or B (important workflow action) and replaced by `StructuredActionDialog`, which submits the same fields to the same API/action.

| File | Calls | Action | Class / severity | Replacement decision |
| --- | ---: | --- | --- | --- |
| `app/crm-ui.tsx` | 1 | Close lead as lost; choose reason | B / important | Required select dialog |
| `app/contracts-ui.tsx` | 1 | Create contract version; change reason | B / important | Optional textarea dialog |
| `app/contracts-ui.tsx` | 1 | Cancel contract; reason | A / critical | Required danger textarea dialog |
| `app/estimates-ui.tsx` | 1 | Create estimate version; change reason | B / important | Optional textarea dialog |
| `app/estimates-ui.tsx` | 1 | Approve proposal; comment | A / critical | Optional textarea dialog |
| `app/estimates-ui.tsx` | 1 | Reject proposal; reason | A / critical | Required danger textarea dialog |
| `app/production-core-ui.tsx` | 2 | Create production template (manager and empty state) | B / important | Required name dialog |
| `app/production-core-ui.tsx` | 2 | Add template stage (name and weight) | A / critical | Text + validated number dialog |
| `app/production-core-ui.tsx` | 3 | Add template task (name, duration, weight) | A / critical | Text + validated number fields |
| `app/production-core-ui.tsx` | 2 | Edit template stage (name and weight) | A / critical | Pre-filled text + number fields |
| `app/production-core-ui.tsx` | 1 | Add template hidden-work requirement | A / critical | Required text dialog |
| `app/production-core-ui.tsx` | 2 | Edit template task (duration and weight) | A / critical | Pre-filled number fields |
| `app/production-core-ui.tsx` | 2 | Add template dependency (predecessor and successor IDs) | A / critical | Two selects with distinct-task validation |
| `app/production-core-ui.tsx` | 2 | Reschedule task (start and end dates) | A / critical | Date dialog with range validation |
| `app/production-core-ui.tsx` | 1 | Resubmit rejected stage; comment | A / critical | Textarea dialog |
| `app/production-core-ui.tsx` | 1 | Manual stage acceptance; basis | A / critical | Required textarea dialog |
| `app/production-core-ui.tsx` | 1 | Update completed quantity | A / critical | Validated non-negative number dialog |
| `app/production-core-ui.tsx` | 1 | Add runtime hidden-work requirement | A / critical | Required text dialog |
| `app/production-core-ui.tsx` | 1 | Assign contractor by agreement ID | A / critical | Agreement select dialog |

After cleanup: `window.prompt` = 0; `window.alert`/bare `alert()` = 0.

## Remaining simple confirmations

There are 16 `window.confirm` call sites. They are class C, single yes/no decisions, and remain temporarily because the existing codebase has no shared confirmation component. None collects business data.

| File | Calls | Confirmation |
| --- | ---: | --- |
| `app/residential-complexes-ui.tsx` | 1 | Archive/restore residential complex |
| `app/residential-complex-selector.tsx` | 1 | Replace manually entered address from selected complex |
| `app/team-access-ui.tsx` | 1 | Deactivate a non-zero cashbox after server warning |
| `app/renovation-order-card.tsx` | 1 | Owner override when signed contract is absent |
| `app/clients-ui.tsx` | 2 | Reset/disable portal access; archive/restore client |
| `app/projects-ui.tsx` | 2 | Fill completion date with today; archive/restore project |
| `app/estimates-ui.tsx` | 5 | Delete section; delete item; archive/restore estimate; move linked lead; create follow-up |
| `app/production-core-ui.tsx` | 3 | Archive template; finish without required photo; cascade dependent schedule |

These confirmations preserve existing backend behavior and are acceptable temporary yes/no guards under the cleanup specification.
