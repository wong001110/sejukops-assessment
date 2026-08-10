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
