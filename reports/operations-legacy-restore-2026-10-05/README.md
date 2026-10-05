# Operations legacy portal restoration — 2026-10-05

Main decision: **PROCEED** for this authorized UI correction. Human UAT: **NOT_REPORTED**.

## Accepted scope

The user rejected the newly invented portal in 8d6ae46 and requested the old Operations portal alongside the current AI Workspace. Historical source at `9b33b8c^` provided the reference shell/classes and interactions; no historical screenshot baseline was available.

- Admin/Manager: old dark Ant Design sidebar, branding and header; full-width Orders table/status filters and selected-order drawer.
- Manager alone: Dashboard in the retained widget style. Counts cover up to 20 recent actor-visible orders; no old financial/trend metrics are fabricated.
- Technician: task cards, mobile shell and bottom navigation. Admin/Technician no longer have invented Overview pages.
- Existing create/import/assignment/reschedule forms and contextual AI Assist remain on demand, with current workspace/auth permissions and pending-write guards.
- Operations / AI Workspace handoff preserves validated order focus. AI Workspace component, generated UI renderer, runtime and native stylesheet have no diff in this correction. Its existing geometry was scoped to the AI branch when replacing the shared portal CSS.

This adapts old presentation to the current core. It does not restore retired auth, assessment tables, unavailable customer/financial analytics, historical lifecycle stages, Technician history/profile features, or MCP development.

## Evidence

| Layer | Actual result |
| --- | --- |
| Targeted contract/component suites | 72 tests PASS across 13 files; 3 additional import regression tests PASS. Final persona/import rerun 10 PASS. |
| Mock browser business flows | 13 checks PASS, including creation, assignment, reschedule, Technician start/complete, saved proposal, pending/stale writes and narrow overflow. |
| Independent Mock capture | 17 checks PASS; desktop 1536×864, no horizontal overflow, no off-origin requests, zero page errors. |
| Targeted mutation | 2 exact mutants KILLED: missing import event registration, removed import permission guard. Original source restored; final baseline import tests PASS. |
| Real Test Demo browser | 7 checks PASS: Guest Admin entry, create, assign, Manager reschedule, Technician start/complete, denied Assignment/Schedule and old Overview redirect. Zero page errors. |
| Final production-build browser | 3 checks PASS: same-page import open/reopen, focused Operations→AI→Operations handoff, Manager root→Dashboard. Zero paid-provider requests or page errors. |
| Database | Temporary order read as COMPLETED at 11:30 MYT, same technician; exact one-order cleanup; Demo count 4 before and after, temporary order count 0. Business audit evidence retained. |
| Static/build | Typecheck, scoped ESLint, production build and diff checks PASS. |
| Independent review | GPT 6.1 Sol found the same-page import regression; Main repaired it and reproduced open/reopen on the final build. Source re-review PROCEED. |

Mock personas configure UI props and cannot prove real role isolation. Live role flows used the authorized Guest perspectives, not new formal staff accounts. The business flow preceded the final import-event repair; the affected navigation was then separately verified on the final build. A stale browser-runner selector initially hit a Drawer mask; the runner was corrected to close the active drawer and rerun successfully. Earlier stale tests were adapted to the existing drawers/client component while preserving concrete payload, duplicate-write, abort and late-response assertions.

No permanent Owner credentials used, no staff/provider/Auth/schema/reset changes, no paid AI or unrelated database, no merge or production deployment. Formal employee login, live model quality and full historical analytics were not rerun for this presentation change. Independent review was read-only; Human UAT is not inferred from screenshots.

## Gallery and reusable checks

[Open gallery](index.html). Captures are actual components with fictional MSW responses, not live product screenshots. Full-page images may exceed the 1536×864 viewport height.

- [Admin Orders](admin-orders.png)
- [Order detail drawer](admin-order-detail-drawer.png)
- [Manager Dashboard](manager-dashboard.png)
- [Technician My jobs](technician-my-jobs.png)
- [Current AI Workspace](ai-workspace-mock-focus.png)

Reusable Mock flow: `scripts/tests/ui-browser/operations-portal.mjs`, with the local fixture server `node tests/ui-browser/start.mjs`. Regression test: `tests/ui/operations-import.test.tsx`. Raw live identifiers/failed traces stay local in `.agent`; sanitized evidence is in `live-summary.json`.
