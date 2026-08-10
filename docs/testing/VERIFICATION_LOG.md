# SejukOps Verification Log

This file records verification evidence as development proceeds.

Do not mark Human UAT as passed unless a human actually executed the case and reported the result.

## Evidence Types

```text
AUTOMATED
QA_AGENT
AGENT_E2E
MAIN_AGENT_ACCEPTANCE
HUMAN_UAT
```

## Result Values

```text
NOT_RUN
PASS
FAIL
BLOCKED
PENDING_ENV
PASS_WITH_ISSUES
```

---

## Baseline — Documentation / Development Protocol

Date: 2026-08-10

Scope:

- system/product specification
- AI provider configuration specification
- dashboard/notification specification
- multi-agent development protocol
- environment requirements
- implementation checklist
- test matrix
- OpenWiki instructions

Evidence:

```text
Runtime automated tests: NOT_RUN — application implementation not started
Agent E2E: NOT_RUN — application implementation not started
Human UAT: NOT_RUN — application implementation not started
```

Notes:

- Repository is currently specification-first.
- Runtime feature checklist remains TODO until implementation begins.
- Initial OpenWiki generation remains TODO; repository instructions are defined first.
- Each development environment must create its own gitignored model/environment status files before delegated implementation.

---

## VG-FOUNDATION — Initial Draft Slice

Date: 2026-08-10

Commit / revision: `agent/phase-1-foundation` pre-commit working tree

Related task IDs:

```text
P0-09, P0-10, P0-11
FND-01 through FND-13
TC-FND-001 through TC-FND-008
```

Environment status:

```text
NEXT_PUBLIC_SUPABASE_URL:      MISSING
NEXT_PUBLIC_SUPABASE_ANON_KEY: MISSING
SUPABASE_SERVICE_ROLE_KEY:     MISSING — required only for real server-side mock-auth data operations
OpenWiki tooling:              UNAVAILABLE — non-blocking for initial scaffolding
```

### Automated

Result: PASS_WITH_ISSUES

Checks executed:

```text
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
node scripts/verify-foundation-data.mjs
npm.cmd run build
git diff --check
```

Observed result:

```text
ESLint: PASS
TypeScript: PASS
Vitest: PASS — 5 files / 14 tests
Foundation schema/seed static verifier: PASS
Next.js production build: PASS — /, /admin, /technician, /manager, /access-denied, /api/demo-session
Diff whitespace check: PASS (line-ending conversion warnings only)
Real migration/seed/RLS execution: PENDING_ENV
```

### Independent QA Agent

Result: PASS_WITH_ISSUES

Model/agent role used: `gpt-5.6-terra`, high reasoning, clean Independent QA role

Review scope:

```text
Phase 1 spec compliance
mock session / role permissions / route guards
Supabase client and server-only privileged boundaries
migration constraints and RLS policy intent
deterministic seed and static verifier
dependency compatibility and maintainability
```

Findings:

```text
Initial QA: FAIL
- malformed seed VALUES rows would not execute
- mock identity was disconnected from the planned data-access boundary
- Manager had generic order-update RLS capability

Fix verification: PASS_WITH_ISSUES
- all seed rows now match the 12-column alias and the verifier enforces row arity
- mock identities map to stable seeded profile IDs
- server-only privileged access requires validated mock identity + explicit permission
- generic order update/assignment is Admin-only
- feature services must add record-level scope checks before Phase 2/3 mutations
- real database execution remains PENDING_ENV
```

### Agent E2E / Real Usage

Result: PASS_WITH_ISSUES

Cases executed:

```text
TC-FND-001 — Admin role switch and portal render: PASS
TC-FND-002 — Technician Ali role switch and mobile portal render: PASS
TC-FND-003 — Manager role switch and portal render: PASS
TC-FND-004 — wrong-role direct route access redirects to access denied: PASS
TC-FND-005 — missing Supabase config leaves unrelated UI usable: PASS
TC-FND-006 — five branch fixture/static relation contract: PASS; applied DB check PENDING_ENV
TC-FND-007 — deterministic seed static/idempotency contract: PASS; execute twice PENDING_ENV
TC-FND-008 — assignment-over-branch permission/fixture contract: PASS; real DB action check PENDING_ENV
```

Observed behavior:

```text
Rendered browser checks passed without console warnings/errors after fixes.
Admin/Manager visual checks: 1440px and 768px.
Technician visual checks: 360px, 390px, and 430px.
No horizontal overflow at checked viewports; mobile role action remained visible.
```

### Main Agent Acceptance

Result: PASS_WITH_ISSUES

Decision rationale:

```text
The implementation is a meaningful initial Phase 1 slice suitable for a Draft PR.
The runnable UI/toolchain/auth/timezone foundation is development-verified.
The data foundation is implemented and statically verified but is not development-accepted as real integration until the Supabase checks below run.
The PR must remain Draft and must not be merged while VG-FOUNDATION real data checks are PENDING_ENV.
```

### Human UAT

Result: NOT_RUN

Cases executed by human:

```text
None
```

Human-reported notes:

```text
No Human UAT result has been reported.
```

### Known Issues / Deferred Verification

```text
- OpenWiki generation is unavailable in the current environment; P0-09 remains TODO.
- Real Supabase-backed data operations require the public URL/anon key plus the server-only service-role key for the assessment mock-auth path.
- Record-level scope checks must be implemented in each Phase 2/3 service before using the privileged data context for mutations.
```

### Re-verification Required

```text
- Apply the migration to a real/local Supabase database.
- Execute the deterministic seed twice and verify no duplicate golden records/events/reports.
- Verify branch foreign keys and all named profiles/technicians/branches in the applied database.
- Exercise server-only mock-auth reads/mutations as Admin, Manager, Ali, and an unrelated Technician.
- Verify Manager cannot assign/reassign while Admin can.
- Verify assigned-technician ownership remains authoritative over branch membership.
```

### Environment Re-check — Credentials Supplied

Date: 2026-08-10

Result: PASS_WITH_ISSUES

```text
Supabase public configuration: CONFIGURED
Supabase privileged server configuration: CONFIGURED
AI configuration encryption key: CONFIGURED — valid 32-byte Base64 format
Local canonical application URL: CONFIGURED
OpenRouter development route: CONFIGURED
```

Observed result:

```text
Public Supabase request: project reached; `branches` returned PGRST205
Privileged Supabase request: project reached; `branches` and `orders` returned PGRST205
Interpretation: credentials/endpoints are usable, but the Phase 1 migration is not applied to the configured project.
No credential values or application rows were printed during verification.

Requested Qwen2.5-VL 7B free OpenRouter slug: live request returned HTTP 404 and the model was absent from the live model catalog.
Current free development fallback: minimal image-input smoke PASS.
This provider preflight is not Phase 6/8 feature acceptance; structured extraction and runtime routing remain future verification.
```

Remaining re-verification:

```text
- Obtain database-admin migration access/tooling for the configured Supabase project.
- Apply the committed migration, execute the seed twice, and rerun TC-FND-006 through TC-FND-008.
- Keep the Phase 1 PR Draft until those real data gates pass.
```

### Live Data Gate Re-check — Migration, Seed, and RLS

Date: 2026-08-10

Result: PASS

Execution evidence:

```text
Committed migration applied in the configured Supabase project: PASS
Deterministic seed first execution: PASS
Deterministic seed second execution: PASS
Live expected counts: PASS
Private service-evidence bucket: PASS
Anonymous branch read (anon role): PASS — zero rows
Authenticated Manager branch/order reads: PASS
Authenticated Manager generic order update denial: PASS
Authenticated Technician assigned-order scope: PASS
Rollback-only RLS verification persistent changes: false
```

Observed deterministic counts after both seed executions:

```text
branches:                    5
orders:                     40
service_reports:            37
service_attachments:        36
order_reschedules:           4
order_reschedule_requests:   2
```

The authenticated RLS verification created its test Auth row and profile links only inside an explicit transaction, then rolled the transaction back. The final database result reported `persistent_changes: false`. No credential values or application-row contents were logged.

Cases promoted:

```text
TC-FND-006 — applied five-branch/data relation contract: PASS
TC-FND-007 — deterministic seed executed twice with stable counts: PASS
TC-FND-008 — anonymous denial, Manager policy, and Technician assignment scope: PASS
```

Deployment note:

```text
The initial migration was applied through the authenticated Supabase SQL Editor because CLI/database-password access was unavailable. Before later CLI-managed migrations, mark version 202608100001 as applied in the migration ledger using the repository's documented Supabase migration-repair procedure.
```

### Final Independent QA

Result: PASS

Model/agent role used: `gpt-5.6-terra`, high reasoning, clean Independent QA role

```text
No P0/P1 implementation or data-gate blocker remains.
Applied counts are coherent with the deterministic fixture contract.
Rollback-only RLS evidence closes TC-FND-006 through TC-FND-008.
Lint, typecheck, 14 tests, static verifier, production build, and diff checks pass.
The unpopulated migration ledger is deferred deployment hygiene, with the exact repair condition recorded before future CLI migrations.
Human UAT remains NOT_RUN.
```

### Final Main Agent Acceptance

Result: PASS

```text
FND-01 through FND-13 satisfy the Phase 1 development gates.
The feature branch is accepted for a non-draft PR and Squash and Merge into main.
The Phase 1 PR remains bounded to foundation work; later feature phases must start from refreshed main on new phase branches.
Human UAT: NOT_RUN.
```

---

## VG-ADMIN-ORDER — Initial Draft Slice

Date: 2026-08-10

Commit / revision: `agent/phase-2-admin-order-workflow` pre-commit working tree

Related task IDs:

```text
ADM-01 through ADM-16
TC-ADM-001 through TC-ADM-006
Admin-owned portions of TC-RSCH-001, TC-RSCH-006 through TC-RSCH-010
```

### Automated

Result: PASS

```text
pnpm.cmd lint: PASS
pnpm.cmd typecheck: PASS
Targeted Vitest: PASS — 5 files / 16 tests
git diff --check: PASS (line-ending conversion warnings only)
```

Implemented contracts:

```text
Transactional service-role-only RPCs for order create, direct reschedule, and request resolution
Required UUID request keys with exact-replay behavior and changed-payload conflict detection
Customer reuse/create, collision-safe order numbering, branch/technician validation, audits, and notifications
Typed Admin list/detail/create/reschedule/request-resolution API routes
Ant Design Admin order list, filters, create form, detail, history, request review, and state feedback
Malaysia-time datetime-local conversion independent of the operator device timezone
Retry-stable UI request keys
```

### Independent QA Agent

Result: NOT_RUN — in progress

### Agent E2E / Real Usage

Result: NOT_RUN — live Phase 2 migration and browser verification pending

### Main Agent Acceptance

Result: NOT_RUN — Draft PR slice only

### Human UAT

Result: NOT_RUN

Human-reported notes:

```text
No Human UAT result has been reported.
```

---

## VG-ADMIN-ORDER — Phase 2 Acceptance

Date: 2026-08-10

Commit / revision: `agent/phase-2-admin-order-workflow` final pre-acceptance working tree

Related task IDs:

```text
ADM-01 through ADM-16
TC-ADM-001 through TC-ADM-006
Admin-owned portions of TC-RSCH-001, TC-RSCH-006 through TC-RSCH-010
```

### Automated

Result: PASS

```text
pnpm.cmd lint: PASS
pnpm.cmd typecheck: PASS
pnpm.cmd test: PASS — 8 files / 26 tests
pnpm.cmd build: PASS — 10 application/API routes built
git diff --check: PASS
```

Live Supabase evidence:

```text
Migration 202608100002_admin_order_workflow.sql: APPLIED
Normalized customer-phone duplicate preflight: 0 groups
Rollback-only integration verification: PASS
  - migration compiled
  - exact mutation replay returned the original outcome
  - changed replay was rejected
  - customer reuse and branch/Technician validation passed
  - direct same-day reschedule was counted while lifecycle status remained unchanged
  - approval executed exactly once
  - rejection created no executed reschedule event
  - Technician notifications and audit behavior passed
  - RPC execution remained service-role-only
  - persistent_changes=false
```

The migration was applied through the Supabase SQL Editor because CLI database-admin access was unavailable. Before a future CLI push, repair the remote migration ledger for versions `202608100001` and `202608100002` as already recorded by the project protocol.

### Independent QA Agent

Result: PASS

```text
No P0 or P1 findings.
Ant Design deprecated Card/Drawer/Modal properties were removed.
Static authorization, idempotency, record-scope, UI/data-boundary, and diff review passed.
```

### Agent E2E / Real Usage

Result: PASS — Admin desktop scope

```text
Live 40-order list, search/filter controls, empty-submit validation, and branch-filtered Technician selection passed.
Create + assign produced a success summary and detail/audit presentation.
Direct reschedule and same-day reschedule history passed without changing ASSIGNED lifecycle status.
A pending Technician request was rejected; the schedule remained unchanged and the rejection audit was shown.
Manager navigation to /admin was redirected to /access-denied; the Admin API also returned 403 in the server log.
Desktop browser visual QA passed with no remaining Ant Design deprecation warning.
The temporary E2E order, customer, and request were deleted; verification counts were 0 / 0 / 0.
```

Deferred to their owning phases, not failed in this gate:

```text
Technician request creation and notification entry flow — Phase 3
Manager direct-reschedule/review UI — Phase 4
Remaining cross-role VG-RESCHEDULE scenarios — after Phases 3 and 4
```

### Main Agent Acceptance

Result: PASS

```text
ADM-01 through ADM-16 satisfy the Phase 2 Admin acceptance gate.
The Phase 2 PR remains bounded to the Admin order and scheduling workflow.
```

### Human UAT

Result: NOT_RUN

Human-reported notes:

```text
No Human UAT result has been reported.
```

---

## VG-TECH-CORE — Initial Draft Slice

Date: 2026-08-10

Commit / revision: `agent/phase-3-technician-core` pre-commit working tree

Related task IDs:

```text
TECH-01 through TECH-05
TECH-18 through TECH-21
TC-TECH-001 through TC-TECH-003
TC-RSCH-003 through TC-RSCH-005
```

### Automated

Result: PASS

```text
pnpm.cmd lint: PASS
pnpm.cmd typecheck: PASS
pnpm.cmd test: PASS — 11 files / 41 tests
pnpm.cmd build: PASS — 15 application/API routes built
git diff --check: PASS (line-ending conversion warnings only)
```

Implemented contracts:

```text
Assignment-scoped ASSIGNED/IN_PROGRESS list and detail reads
Service-role-only atomic Start Job RPC with audit and retry idempotency
Required-reason Technician reschedule request with no direct schedule mutation
One-pending-request guard and duplicate-safe active Admin/Manager notifications
Active Technician row plus active linked TECHNICIAN profile read boundary
Ant Design Mobile jobs/detail/actions, bottom navigation, states, and retry-stable request keys
```

### Independent QA Agent

Result: PASS — static Draft slice

```text
No P0/P2 findings.
One P1 inactive-profile read-boundary finding was corrected and regression-tested.
Authorization, state transition, idempotency, notification, UI, responsive CSS, and reduced-motion review passed.
```

### Agent E2E / Real Usage

Result: PARTIAL

```text
360px History, 390px My Jobs loading shell/navigation, and 430px Profile checks had no horizontal overflow.
Live migration/RPC execution and live job card/detail/start/request scenarios remain pending the central gate.
```

### Main Agent Acceptance

Result: NOT_RUN — Draft PR slice only

### Human UAT

Result: NOT_RUN

Human-reported notes:

```text
No Human UAT result has been reported.
```

---

## VG-TECH-CORE — Phase 3 Core Acceptance

Date: 2026-08-10

Commit / revision: `agent/phase-3-technician-core` final pre-acceptance working tree

Related task IDs:

```text
TECH-01 through TECH-05
TECH-18 through TECH-21
TC-TECH-001 through TC-TECH-003
TC-RSCH-003 through TC-RSCH-005
```

### Automated

Result: PASS

```text
pnpm.cmd lint: PASS
pnpm.cmd typecheck: PASS
pnpm.cmd test: PASS — 11 files / 41 tests
pnpm.cmd build: PASS — 15 application/API routes built
git diff --check: PASS
```

Live Supabase evidence:

```text
Migration 202608100003_technician_core.sql: APPLIED
Duplicate pending-request preflight: 0 groups
Rollback-only assertion matrix: PASS
  - atomic Start Job and exactly one JOB_STARTED audit
  - exact start replay returned the original result
  - changed start replay conflicted
  - wrong Technician was rejected
  - blank reschedule reason was rejected
  - exact request replay returned one request/audit
  - changed request replay conflicted
  - one-pending-request guard passed
  - exactly two active Admin/Manager notifications were created
  - request did not mutate scheduled_at or create an executed reschedule event
  - RPC execution remained service-role-only
  - rollback restored the order and left no test audit/request rows
```

The migration was applied through the Supabase SQL Editor. Repair remote migration ledger version `202608100003` together with previously recorded versions before adopting CLI `db push`.

### Independent QA Agent

Result: PASS

```text
No unresolved P0/P1/P2 findings.
The inactive-profile service-role read boundary was found, fixed, and regression-tested.
The imperative Ant Design Mobile Toast runtime incompatibility was found in live E2E, replaced with inline NoticeBar feedback, and reverified without application errors.
```

### Agent E2E / Real Usage

Result: PASS

```text
Admin created a temporary order assigned to Ali; it appeared in Ali's My Jobs list.
Ali opened customer/problem/schedule context and started the job; it became IN_PROGRESS and moved ahead of ASSIGNED work.
John received 404 for the detail and 403 for Start Job on Ali's order.
The reschedule action required a nonblank reason and exposed no direct schedule mutation.
Ali submitted one request; the Admin order detail showed PENDING plus JOB_STARTED and RESCHEDULE_REQUESTED audits.
Live evidence showed status=IN_PROGRESS, one start audit, one request audit, one pending request, and two office notifications.
Independent live visual QA passed at 360px, 390px, and 430px with no horizontal overflow; list, detail, phone link, pending feedback, and bottom navigation remained usable.
```

Temporary E2E cleanup:

```text
Removed only ORD-2026-0044 / Phase 3 Technician E2E and its cascading request, audits, and internal notifications.
Post-cleanup order/customer/request/audit/notification counts: 0 / 0 / 0 / 0 / 0.
The deterministic 40-order seed set was not modified.
```

### Main Agent Acceptance

Result: PASS

```text
TECH-01 through TECH-05 and TECH-18 through TECH-21 satisfy the Technician Core development gate.
TECH-06 through TECH-17 remain intentionally deferred to the dependent Evidence + Completion PR.
```

### Human UAT

Result: NOT_RUN

Human-reported notes:

```text
No Human UAT result has been reported.
```

---

## VG-TECH-UPLOAD / VG-TECH-COMPLETION — Phase Gate

Date: 2026-08-10

Commit / revision: `74b7325` plus this verification evidence update

Related task IDs:

```text
TECH-06 through TECH-17
TC-TECH-005 through TC-TECH-015
```

### Automated

Result: PASS

```text
pnpm.cmd lint: PASS
pnpm.cmd typecheck: PASS (rerun sequentially after the build; the first parallel run raced on generated .next types)
pnpm.cmd test: PASS — 19 files / 91 tests after receipt remediation
pnpm.cmd test -- tests/technician: PASS — 11 files / 65 tests
pnpm.cmd build: PASS — receipt-aware application/API routes built
git diff --check: PASS (line-ending conversion warnings only)
```

Implemented contracts:

```text
Private signed upload/view flow with PostgreSQL-authoritative staging metadata
Six-file, MIME-specific, per-file, and 120 MB combined limits
Retry-stable reservation/confirmation plus retryable FAILED/ORPHANED/DELETING cleanup
Current-assignment replay validation and prior-Technician evidence isolation
Atomic report/attachment/payment/JOB_DONE/audit completion with exact replay safety
Mobile completion, hydration, per-file status/removal, authoritative amount, payment, and success states
```

### Independent QA Agent

Result: PASS

```text
No unresolved P0/P1 findings.
QA found and verified fixes for signed-token replay after reassignment, stale prior-Technician staging, invisible RESERVED rows after failed browser upload, reservation-ID loss on retry, unrecoverable DELETING rows, and missing optional receipt-photo capture.
P2 hardening includes dedicated payment permission, clean final-amount overflow validation, upload aria-live status, payment selector accessible name, and bounded post-completion cleanup for identifiable reassignment-orphan evidence/receipt objects.
Receipt remediation re-review and final live-evidence acceptance pass. Phone visual QA at 360 / 390 / 430px passes without horizontal overflow or fixed-navigation overlap.
```

### Agent E2E / Real Usage

Result: PASS

```text
Applied migration 202608100004 through the Supabase SQL Editor; the migration ledger remains absent and must be repaired before later CLI db push.
Rollback-only SQL matrix passed actor/assignment/state enforcement; reservation and completion exact replay/change conflict; wrong-Technician denial; count/size boundaries; reassignment isolation; DELETING serialization; final-amount overflow; and atomic report/payment/attachment/JOB_DONE/audit side effects. ROLLBACK left no persistent changes.
Live disposable ORD-2026-0045 was created and assigned through Admin, started by John, given one signed private PDF upload, rehydrated from DB-authoritative evidence in the rendered Technician UI, and completed through the browser with RM 180.00 quoted + RM 20.00 extra = authoritative RM 200.00 and one E-wallet payment.
A different Technician's evidence GET returned 404. Persisted verification returned JOB_DONE / 200.00 / one attachment / one payment / one JOB_COMPLETED audit / ATTACHED / one Storage object.
The exact disposable Storage object, order, and customer were removed; cleanup returned 0 / 0 / 0 and all 40 deterministic seed orders remained.
Applied migration 202608100005 and repeated the disposable flow at a 390x844 viewport. The actual browser file chooser uploaded and confirmed a 36,719-byte PNG receipt through signed private Storage; browser re-entry hydrated the receipt and signed View action.
Wrong-Technician receipt access returned 404. Receipt-aware completion persisted JOB_DONE / RM 200.00, one payment, one ATTACHED receipt bound to payments.receipt_storage_path, one private object, one completion audit, and zero service attachments, proving the receipt remains separate from service evidence.
Exact receipt-aware completion replay returned 200 with single report/payment/receipt/audit counts; a changed same-key replay returned 409. Exact receipt object/order/customer cleanup returned 0 / 0 / 0 and preserved all 40 seed orders.
```

### Main Agent Acceptance

Result: PASS — Development Accepted

```text
Implementation, automated checks, migrations, live rollback matrices, rendered phone-browser flows, authorization boundaries, persisted side-effect checks, idempotency replay, and exact cleanup pass.
Independent Phase gate QA is PASS. TECH-06 through TECH-17 are VERIFIED and PR #4 may leave Draft after this evidence is committed and pushed.
Human UAT remains separate and NOT_RUN.
```

### Human UAT

Result: NOT_RUN

Human-reported notes:

```text
No Human UAT result has been reported.
```

---

## VG-COMPLETION-INTEGRATION / VG-RESCHEDULE — Phase 4

Date: 2026-08-10

Commit / revision: `095c8b4` plus the acceptance-evidence commit that contains this entry

Related task IDs:

```text
CMP-01 through CMP-16
VG-COMPLETION-INTEGRATION
VG-RESCHEDULE
```

### Automated

Result: PASS

```text
pnpm.cmd lint: PASS
pnpm.cmd typecheck: PASS
pnpm.cmd test: PASS — 25 files / 121 tests
pnpm.cmd build: PASS — all Phase 4 application and API routes built
node scripts/verify-foundation-data.mjs: PASS
git diff --check: PASS (line-ending conversion warnings only)
```

Verified implementation boundaries:

```text
Truthful WhatsApp READY / OPENED states only; no SENT / DELIVERED / READ claim
User-initiated form POST -> 303 encoded WhatsApp deep link; no automatic sending
Completion commits before isolated notification preparation and supports manual retry
Active-role and record-scope checks before privileged Technician/Admin/Manager access
Manager queue/detail, signed private evidence/receipt views, reschedule/request handling, and audit trail
Atomic approve -> REVIEWED -> CLOSED and clarification -> IN_PROGRESS transitions
Clarification-aware canonical report revisions with revision-specific notification identity
Immutable historical receipt/payment bindings plus fresh receipt staging for a rework revision
Actionable invalid-recipient response and globally chronological review/audit timeline
```

### Independent QA Agent

Result: PASS

```text
Independent gpt-5.6-sol / xhigh QA found and verified fixes for:
- ambiguous PostgreSQL notification conflict targeting
- ambiguous receipt update qualification
- transaction-start timestamp ordering during clarification/re-completion
- mutable historical receipt staging after clarification
- generic invalid-recipient recovery feedback
- review and audit events grouped instead of globally sorted

Final re-review found no remaining P0, P1, or P2 issues.
Human UAT was kept separate and was not used as acceptance evidence.
```

### Agent E2E / Real Usage

Result: PASS

```text
Applied migration 202608100006 and the receipt-history remediation through the signed-in Supabase SQL Editor.

The rollback-only integration matrix passed Manager direct reschedule, Technician request approval, completion revision 1, READY/OPENED exact replay, clarification with a visible Technician note, revision 2 on the same report, changed-key conflict, current-notification enforcement, final approval/closure, and invalid-recipient failure isolation. Rollback preserved all 40 seed orders.

At a 390px Technician viewport, Admin created and assigned disposable ORD-2026-0047 to John; John started and completed it with RM 150.00 quoted + RM 25.00 extra = authoritative RM 175.00, no evidence, and no payment. The user-click action opened an encoded WhatsApp URL without sending and persisted OPENED. Manager queue/detail displayed the report, amount, empty evidence/payment states, and audit trail; approval closed the order. Persisted verification returned CLOSED / revision 1 / final 175.00 / one approval / zero attachments / zero payments / WhatsApp OPENED. Exact order/customer cleanup returned zero disposable rows and 40 seed orders.

The dedicated historical-receipt rollback matrix proved the prior receipt stayed ATTACHED, payment-bound, path-stable, and immutable; old upload-key replay returned ATTACHED; deletion raised ATTACHED_RECEIPT_IMMUTABLE; a distinct fresh receipt completed revision 2; both payment/receipt histories remained queryable; and the Storage metadata sentinel survived the workflow. The result field persistent_changes=true means its cleanup predicate passed: disposable database and Storage sentinel rows were absent after rollback. Seed order count remained 40.

Manager responsive layouts passed at 1440px and 900px. Technician navigation and states passed at 390px with no horizontal overflow or bottom-navigation collision.
```

### Main Agent Acceptance

Result: PASS — Development Accepted

```text
CMP-01 through CMP-16 satisfy the Phase 4 acceptance gate.
Implementation, automated checks, applied SQL, rollback matrices, real browser workflow, persisted side-effect checks, exact cleanup, and independent QA all pass.
PR #5 may leave Draft after this evidence is committed and pushed.
```

### Human UAT

Result: NOT_RUN

Human-reported notes:

```text
No Human UAT result has been reported.
```

### Known Issues / Deferred Verification

```text
The SQL Editor deployment did not populate the Supabase migration ledger.
Repair versions 202608100001 through 202608100006 as applied before any future CLI db push.
OpenWiki tooling remains unavailable and is not a Phase 4 acceptance blocker.
```

---

## VG-KPI-DASHBOARD / VG-DASHBOARD-INVALIDATION — Phase 5

Date: 2026-08-10

Commit / revision: `a8f8882` plus the acceptance-evidence commit that contains this entry

Related task IDs:

```text
KPI-01 through KPI-14
KPI-16 through KPI-19
TC-KPI-001 through TC-KPI-010
```

### Automated

Result: PASS

```text
pnpm.cmd test: PASS — 30 files / 141 tests
pnpm.cmd lint: PASS
pnpm.cmd typecheck: PASS
pnpm.cmd build: PASS — Manager dashboard and compact API route included
node scripts/verify-foundation-data.mjs: PASS
git diff --check: PASS (line-ending conversion warnings only)
```

Verified implementation boundaries:

```text
Manager-only compact dashboard API backed by a service-role-only aggregation RPC
MYT half-open Today / This Week / This Month periods with natural previous-period comparisons
Hourly, daily, and weekly zero-filled trend buckets including the final partial month week
Canonical completed-order totals, deterministic rankings, and service-type distribution
Executed reschedule-event counting including same-day changes and excluding rejected requests
Period-specific TanStack Query cache with retained-data transitions and 60-second freshness
Dashboard-only invalidation after Technician completion and executed Admin/Manager reschedules
One-shot same-tab invalidation marker across demo-role document reloads
```

### Independent QA Agent

Result: PASS

```text
Independent gpt-5.6-terra / xhigh QA found one P1: Technician completion and Admin reschedule paths did not invalidate the Manager dashboard cache.
The remediation moved the QueryClient to the application root, added exact successful-write call sites, and retained dashboard-only invalidation.
Final re-review found no P0, P1, or P2 issues; focused dashboard tests passed 5 files / 20 tests.
Human UAT was kept separate and was not used as acceptance evidence.
```

### Agent E2E / Real Usage

Result: PASS

```text
Applied migration 202608100007 through the signed-in Supabase SQL Editor.
Live fixed-time golden verification passed for Today (5 / RM 1,375.00 / 0 / RM 275.00), This Week (14 / RM 3,455.00 / 4 / RM 246.79), and This Month (25 / RM 6,515.00 / 4 / RM 260.60), including rankings, service distribution, trend buckets, stable metricsVersion, production-shaped RPC, anonymous denial, non-Manager denial, same-day events, and rejected-request exclusion.
Manager browser verification passed Today / Week / Month values, Week -> Month -> Week cache reuse, Manager navigation, retained-data period transitions, and responsive layouts at 1440px, 900px, and 700px without horizontal overflow or header/control collision.
The cache invalidation remediation is independently covered by a dynamic helper test plus exact mutation-call-site and provider-topology assertions; the same-tab document-reload marker behavior was independently reviewed.
```

### Main Agent Acceptance

Result: PASS — Development Accepted

```text
KPI-01 through KPI-14 and KPI-16 through KPI-19 satisfy the Phase 5 acceptance gate.
KPI-15 is explicitly optional and remains a deferred low-priority optimisation.
Implementation, automated checks, applied SQL, golden live verification, browser visual/cache evidence, and independent remediation QA all pass.
PR #6 may leave Draft after this evidence and the requested OpenWiki disposition are committed and pushed.
```

### Human UAT

Result: NOT_RUN

Human-reported notes:

```text
No Human UAT result has been reported.
```

### Known Issues / Deferred Verification

```text
The SQL Editor deployment did not populate the Supabase migration ledger.
Repair versions 202608100001 through 202608100007 as applied before any future CLI db push.
KPI-15 optional non-active-period prefetch is deferred; ordinary active-period caching is verified.
OpenWiki CLI 0.3.1 is now available, but generation is pending explicit approval to transmit non-ignored repository source/specification content to OpenRouter. No upload has occurred.
```

---

# Verification Entry Template

Copy this section for every meaningful feature/verification-group run.

## <Verification Group / Feature>

Date:

Commit / revision:

Related task IDs:

Environment status:

```text
<required variable>: CONFIGURED | MISSING | NOT_REQUIRED
```

### Automated

Result: NOT_RUN

Checks executed:

```text
<command/test>
```

Observed result:

```text
...
```

### Independent QA Agent

Result: NOT_RUN

Model/agent role used:

Review scope:

Findings:

```text
...
```

### Agent E2E / Real Usage

Result: NOT_RUN

Cases executed:

```text
TC-...
```

Observed behavior:

```text
...
```

### Main Agent Acceptance

Result: NOT_RUN

Decision rationale:

```text
...
```

### Human UAT

Result: NOT_RUN

Cases executed by human:

```text
UAT-...
```

Human-reported notes:

```text
...
```

### Known Issues / Deferred Verification

```text
- ...
```

### Re-verification Required

```text
- <test/group> after <dependency/change>
```
