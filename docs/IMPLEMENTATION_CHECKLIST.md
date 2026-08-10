# SejukOps Implementation Checklist

This file is the primary development-progress source of truth.

## Status Legend

```text
TODO                 Not started
IN_PROGRESS          Actively being implemented
IMPLEMENTED          Code exists; required verification not complete
PENDING_ENV          Waiting only on required external/local configuration for a specific path
QA_PENDING           Independent QA required
E2E_PENDING          Agent real-usage/E2E verification required
HUMAN_UAT_PENDING    Development acceptance may be complete; designated human test remains
VERIFIED             Required development verification gates passed
BLOCKED              Cannot proceed because of a non-environment blocker
```

`IMPLEMENTED` must never be treated as equivalent to `VERIFIED`.

---

## Phase 0 — Specification & Agent Development Foundation

| ID | Item | Status |
|---|---|---|
| P0-01 | Product/system specification | VERIFIED |
| P0-02 | AI provider/routing specification | VERIFIED |
| P0-03 | Dashboard + notification specification | VERIFIED |
| P0-04 | Main Agent / multi-agent development protocol | VERIFIED |
| P0-05 | Environment dependency definitions | VERIFIED |
| P0-06 | Initial testing matrix | VERIFIED |
| P0-07 | Verification log structure | VERIFIED |
| P0-08 | OpenWiki repository instructions | VERIFIED |
| P0-09 | Generate initial OpenWiki codebase documentation | TODO — tooling unavailable in current environment; non-blocking for initial scaffolding |
| P0-10 | Create local model capability inventory | VERIFIED — local gitignored inventory created 2026-08-10 |
| P0-11 | Create local environment status inventory | VERIFIED — local gitignored inventory created 2026-08-10 |
| P0-12 | Operational branch/reschedule/upload/idempotency rules | VERIFIED |
| P0-13 | Deterministic seed-data contract | VERIFIED |
| P0-14 | AI runtime failure/session/confidence behavior | VERIFIED |
| P0-15 | UI technology + practical visual direction | VERIFIED |

Phase gate:

- specifications are readable by a new Main Agent
- local model/env files are created before first delegated implementation
- OpenWiki generation is helpful but must not block initial scaffolding if the tool is not yet available

---

## Phase 1 — Foundation

| ID | Item | Status |
|---|---|---|
| FND-01 | Initialise Next.js + TypeScript | VERIFIED |
| FND-02 | Configure Ant Design + Ant Design Mobile | VERIFIED |
| FND-03 | Establish shared design tokens / CSS variables / UI primitives | VERIFIED |
| FND-04 | Configure Supabase project client/server boundaries | VERIFIED — public and privileged credentials reached the configured project without exposing secrets; applied data checks remain owned by FND-05 through FND-08 |
| FND-05 | Create initial DB migrations/schema | VERIFIED — migration applied to the configured project; live constraints, storage, and RLS verification passed |
| FND-06 | Add `branches` model and branch foreign keys | VERIFIED — five applied branch rows and branch-aware foundation relations verified |
| FND-07 | Seed Admin, Manager, Ali, John, Bala, Yusoff and five branches | VERIFIED — deterministic live fixture counts and identity contracts verified |
| FND-08 | Implement deterministic/re-runnable assessment seed script | VERIFIED — seed executed twice successfully with stable expected counts |
| FND-09 | Implement mock login / role switcher | VERIFIED |
| FND-10 | Add `/admin`, `/technician`, `/manager` route boundaries | VERIFIED |
| FND-11 | Enforce route-level role guards | VERIFIED |
| FND-12 | Add base loading/error/not-found handling | VERIFIED |
| FND-13 | Set application timezone handling for operational dates | VERIFIED |

**Verification group: `VG-FOUNDATION`**

Run when the foundation forms a runnable baseline.

Required evidence:

- targeted type/lint checks during implementation
- app boot smoke
- role-switch route test
- schema/branch relation checks
- deterministic seed repeatability check
- Supabase connection/schema check when ENV available
- QA Agent review

---

## Phase 2 — Admin Order & Scheduling Workflow

| ID | Item | Status |
|---|---|---|
| ADM-01 | Admin order list | VERIFIED — live seeded list and browser flow pass |
| ADM-02 | Order filters/status presentation | VERIFIED — live search/status/reference filters pass |
| ADM-03 | New order form | VERIFIED — validation and live create flow pass |
| ADM-04 | Human-readable order number generation | VERIFIED — transactional generation and live create pass |
| ADM-05 | Customer creation/reuse logic | VERIFIED — rollback integration evidence covers create/reuse |
| ADM-06 | Technician assignment | VERIFIED — branch-filtered UI and server validation pass |
| ADM-07 | Branch assignment/presentation in order model | VERIFIED — live create/detail presentation pass |
| ADM-08 | Order detail page | VERIFIED — live detail, history, requests, and audits pass |
| ADM-09 | `scheduled_at` support | VERIFIED — MYT-safe input/presentation and live mutation pass |
| ADM-10 | Admin direct reschedule action | VERIFIED — live direct reschedule pass with lifecycle preserved |
| ADM-11 | Reschedule event history with same-day tracking | VERIFIED — DB flag and browser history pass |
| ADM-12 | Technician reschedule-request review/approve/reject surface | VERIFIED — Admin review/reject browser flow and transactional tests pass |
| ADM-13 | Submission summary/success state | VERIFIED — live success state and detail handoff pass |
| ADM-14 | Order creation + assignment + reschedule audit events | VERIFIED — live audit trail and rollback integration evidence pass |
| ADM-15 | Admin UI loading/empty/error/validation states | VERIFIED — automated checks and browser visual QA pass |
| ADM-16 | Admin UI transitions/micro-interactions | VERIFIED — visual QA and reduced-motion implementation pass |

**Verification group: `VG-ADMIN-ORDER`**

Run once the full create -> assign -> detail slice is implemented.

**Verification group: `VG-RESCHEDULE`**

Run once direct Admin/Manager rescheduling, Technician requests, history, and internal notifications are wired together.

Required evidence:

- order validation tests
- order number uniqueness/constraint test
- branch relation test
- creation/assignment integration test
- Admin browser scenario
- reschedule permission/state tests
- same-day reschedule counted as event
- rejected request does not create executed reschedule event
- UI/UX visual QA

---

## Phase 3 — Technician Mobile-first Workflow

| ID | Item | Status |
|---|---|---|
| TECH-01 | Mobile-first My Jobs list | VERIFIED — live assigned-job list and phone QA pass |
| TECH-02 | Job prioritisation for ASSIGNED / IN_PROGRESS | VERIFIED — live IN_PROGRESS-first ordering pass |
| TECH-03 | Job detail with customer/problem/schedule context | VERIFIED — live assignment-scoped detail and phone QA pass |
| TECH-04 | `ASSIGNED -> IN_PROGRESS` Start Job action | VERIFIED — live atomic transition, audit, authorization, and retry matrix pass |
| TECH-05 | Technician reschedule-request flow with required reason | VERIFIED — live request, notification, validation, and no-direct-mutation gates pass |
| TECH-06 | Completion form — Work Done / Remarks | VERIFIED — rendered completion and success flow pass |
| TECH-07 | Extra Charges + authoritative Final Amount calculation | VERIFIED — client, server, rollback boundary, and live RM 200.00 persistence pass |
| TECH-08 | Supabase private service-evidence bucket/path integration | VERIFIED — signed private upload, authoritative hydration, object persistence, and cleanup pass |
| TECH-09 | Evidence count/MIME/per-file/total-size validation | VERIFIED — contract and live rollback boundary matrix pass |
| TECH-10 | Partial upload failure + per-file retry behavior | VERIFIED — failed signed upload exact-key retry and UI reservation-ID recovery tests pass |
| TECH-11 | Attachment metadata persistence + access boundary | VERIFIED — live ATTACHED metadata, signed view creation, and wrong-Technician 404 pass |
| TECH-12 | Best-effort failed-metadata/orphan upload cleanup path | VERIFIED — FAILED/ORPHANED/DELETING recovery and exact object cleanup gates pass |
| TECH-13 | Optional payment capture | VERIFIED — amount/method plus private receipt upload, hydration, atomic binding, replay, and cleanup pass |
| TECH-14 | `IN_PROGRESS -> JOB_DONE` completion transaction | VERIFIED — rollback atomicity matrix and live browser completion pass |
| TECH-15 | Assigned-technician-only server enforcement | VERIFIED — live wrong-Technician denial plus replay/reassignment boundaries pass |
| TECH-16 | Client double-submit prevention/pending state | VERIFIED — stable request keys, disabled pending UI, and retry recovery pass |
| TECH-17 | Server-side idempotent completion / duplicate side-effect protection | VERIFIED — exact replay/change-conflict matrix and single live side-effect counts pass |
| TECH-18 | Technician bottom navigation / phone UX | VERIFIED — live Jobs/History/Profile navigation and touch hierarchy pass |
| TECH-19 | Loading/error/success/empty states | VERIFIED — automated review and live inline-feedback flow pass |
| TECH-20 | Purposeful transitions + reduced-motion considerations | VERIFIED — pending/state feedback and reduced-motion review pass |
| TECH-21 | Visual QA at ~360 / 390 / 430px | VERIFIED — live list/detail/navigation checks pass without overflow |

**Verification group: `VG-TECH-CORE`**

Batch the job-view/start/form tasks before broad Technician feature testing.

**Verification group: `VG-TECH-UPLOAD`**

Run after Supabase evidence storage, validation, partial failure, retry, and metadata handling are integrated.

**Verification group: `VG-TECH-COMPLETION`**

Run after completion, authorization, idempotency, and side effects are integrated.

Required evidence:

- assigned technician authorization tests
- final amount calculation tests
- upload count/type/size tests
- partial-failure retry test
- duplicate completion test
- duplicate notification/flag prevention test
- Technician Agent E2E
- phone visual QA

---

## Phase 4 — Completion, Notification, Rescheduling & Manager Review

| ID | Item | Status |
|---|---|---|
| CMP-01 | Job completion creates Manager review item | TODO |
| CMP-02 | Generate customer WhatsApp pre-filled deep link | TODO |
| CMP-03 | Notification state `READY` | TODO |
| CMP-04 | Mark notification `OPENED` when WhatsApp action is opened | TODO |
| CMP-05 | Never claim SENT / DELIVERED / READ in deep-link implementation | TODO |
| CMP-06 | Allow Admin/Manager to reopen WhatsApp action | TODO |
| CMP-07 | Manager completed-job review queue | TODO |
| CMP-08 | Review detail with evidence/amount/audit/flags | TODO |
| CMP-09 | Manager direct reschedule action | TODO |
| CMP-10 | Manager handles Technician reschedule requests | TODO |
| CMP-11 | Reschedule internal notifications | TODO |
| CMP-12 | Approve: JOB_DONE -> REVIEWED -> CLOSED | TODO |
| CMP-13 | Clarification/rework: JOB_DONE -> IN_PROGRESS | TODO |
| CMP-14 | Review/reschedule audit events | TODO |
| CMP-15 | Notification failure does not roll back valid completion | TODO |
| CMP-16 | Accounts role intentionally omitted; Manager queue satisfies assessment notification path | TODO |

**Verification group: `VG-COMPLETION-INTEGRATION`**

Run only after Technician completion, notification preparation, Manager queue, and review actions are wired together.

**Verification group: `VG-RESCHEDULE`**

Includes Admin/Manager execute, Technician request, same-day event, history, and role notifications.

Required Agent E2E:

```text
Technician completes job
-> notification READY
-> open WhatsApp action
-> notification OPENED
-> Manager sees review item
-> Manager approves or requests clarification
```

---

## Phase 5 — KPI Dashboard

| ID | Item | Status |
|---|---|---|
| KPI-01 | Manager Dashboard route/layout | TODO |
| KPI-02 | Period selector: Today / This Week / This Month | TODO |
| KPI-03 | This Week default | TODO |
| KPI-04 | KPI cards: Completed / Amount / Rescheduled / Avg Value | TODO |
| KPI-05 | Previous-period comparison | TODO |
| KPI-06 | Today hourly trend aggregation | TODO |
| KPI-07 | This Week daily trend aggregation | TODO |
| KPI-08 | This Month weekly trend aggregation | TODO |
| KPI-09 | Period-specific Technician leaderboard | TODO |
| KPI-10 | Period-specific service-type distribution | TODO |
| KPI-11 | Server-side/database aggregation | TODO |
| KPI-12 | Compact dashboard response contract | TODO |
| KPI-13 | TanStack Query period cache | TODO |
| KPI-14 | Targeted invalidation after relevant business events | TODO |
| KPI-15 | Optional low-priority prefetch for non-active periods | TODO |
| KPI-16 | Reschedule metric from executed reschedule events including same-day changes | TODO |
| KPI-17 | Query/index review for actual access patterns | TODO |
| KPI-18 | Loading/empty/error + smooth period transitions | TODO |
| KPI-19 | Golden KPI assertions against deterministic seed manifest | TODO |

**Verification group: `VG-KPI-DASHBOARD`**

Do not repeatedly test each chart alone. Test the dashboard as a period-aware feature slice after the aggregation contract is stable.

Required evidence:

- aggregate/query tests for all three periods
- golden fixture comparison
- cache behavior check
- invalidation check after job completion/reschedule
- Manager browser test switching periods repeatedly
- visual QA with no jarring blank-page reload

---

## Phase 6 — AI Provider Configuration

| ID | Item | Status |
|---|---|---|
| AICFG-01 | Provider-agnostic adapter contracts | TODO |
| AICFG-02 | Admin AI Settings UI | TODO |
| AICFG-03 | Add provider/model profile | TODO |
| AICFG-04 | Model capability metadata | TODO |
| AICFG-05 | Test Connection flow | TODO |
| AICFG-06 | Encrypted BYOK persistence | TODO |
| AICFG-07 | Plaintext key never returned after save | TODO |
| AICFG-08 | Single Model routing | TODO |
| AICFG-09 | Task-based Routing | TODO |
| AICFG-10 | Capability validation | TODO |
| AICFG-11 | Environment fallback provider support | TODO |
| AICFG-12 | Admin-only configuration enforcement | TODO |
| AICFG-13 | Normalised user-facing provider error model | TODO |
| AICFG-14 | Manual Retry UX; no silent cross-provider failover | TODO |

**Verification group: `VG-AI-CONFIG`**

Can be developed with mock providers before real keys exist.

Potential `PENDING_ENV` paths:

- real encryption persistence if `AI_CONFIG_ENCRYPTION_KEY` missing
- real provider connection tests if provider API keys missing

---

## Phase 7 — Core AI Operations

| ID | Item | Status |
|---|---|---|
| AIOPS-01 | Define supported operational intents | TODO |
| AIOPS-02 | `getJobs` controlled tool | TODO |
| AIOPS-03 | `getTechnicianStats` controlled tool | TODO |
| AIOPS-04 | `getOperationalSummary` controlled tool | TODO |
| AIOPS-05 | `getWorkload` controlled tool | TODO |
| AIOPS-06 | Schema-validated tool parameters | TODO |
| AIOPS-07 | No arbitrary SQL path | TODO |
| AIOPS-08 | Manager AI Operations UI | TODO |
| AIOPS-09 | Unsupported/no-data/tool-failure behavior | TODO |
| AIOPS-10 | Response grounding against deterministic results | TODO |
| AIOPS-11 | Conversation/session-scoped multi-turn context only | TODO |
| AIOPS-12 | Clear/reset conversation with no long-term memory | TODO |
| AIOPS-13 | Provider timeout/rate-limit/auth/tool-failure messages with recovery action | TODO |
| AIOPS-14 | Operational Insight using deterministic metrics | TODO |
| AIOPS-15 | Insight cache keyed by period + metrics version | TODO |
| AIOPS-16 | SejukOps domain eval dataset (~40-60 cases) | TODO |
| AIOPS-17 | Golden tool selection + argument assertions | TODO |
| AIOPS-18 | Unsupported/no-tool boundary cases | TODO |
| AIOPS-19 | Multi-turn context cases | TODO |
| AIOPS-20 | Consistency + latency/cost capture | TODO |
| AIOPS-21 | Optional public tool benchmark qualification where useful | TODO |

**Verification group: `VG-AI-OPERATIONS`**

Use deterministic fixtures/tool mocks first. Real provider tests run only when a compatible provider is configured.

---

## Phase 8 — Advanced AI

| ID | Item | Status |
|---|---|---|
| AADV-01 | Deterministic Workflow Supervisor rules | TODO |
| AADV-02 | Optional AI flag explanation/recommendation | TODO |
| AADV-03 | Document upload/import UI | TODO |
| AADV-04 | Text-native document extraction path | TODO |
| AADV-05 | Image/scanned document vision route | TODO |
| AADV-06 | Structured extraction schema validation | TODO |
| AADV-07 | Per-field confidence: high / medium / low / missing | TODO |
| AADV-08 | Confidence-aware review UI highlighting ambiguous/missing fields | TODO |
| AADV-09 | Human preview/edit before database write | TODO |
| AADV-10 | Capability mismatch handling | TODO |
| AADV-11 | Provider/extraction failure leaves operational records untouched and supports retry | TODO |
| AADV-12 | Real reference-model integration where ENV available | TODO |

**Verification group: `VG-WORKFLOW-SUPERVISOR`**

**Verification group: `VG-DOCUMENT-UNDERSTANDING`**

Real multimodal E2E may remain `PENDING_ENV` until a compatible API key is configured. This must not block unrelated submission work if the implemented behavior can otherwise be demonstrated with an available compatible provider.

---

## Phase 9 — Quality, UAT & Submission

| ID | Item | Status |
|---|---|---|
| REL-01 | Cross-role end-to-end Agent E2E | TODO |
| REL-02 | Full relevant automated regression | TODO |
| REL-03 | UI/UX visual QA — Admin desktop | TODO |
| REL-04 | UI/UX visual QA — Manager desktop | TODO |
| REL-05 | UI/UX visual QA — Technician mobile | TODO |
| REL-06 | Accessibility smoke | TODO |
| REL-07 | Performance/fetching smoke | TODO |
| REL-08 | Production build/deployment validation | TODO |
| REL-09 | README screenshots/demo instructions | TODO |
| REL-10 | Assessment self-evaluation | TODO |
| REL-11 | Human UAT — Admin workflow | TODO |
| REL-12 | Human UAT — Technician workflow | TODO |
| REL-13 | Human UAT — Manager workflow | TODO |
| REL-14 | Human UAT — Reschedule/request workflow | TODO |
| REL-15 | Human UAT — Evidence upload | TODO |
| REL-16 | Human UAT — AI provider setup | TODO |
| REL-17 | Human UAT — AI Operations | TODO |
| REL-18 | Human UAT — Document Understanding | TODO |
| REL-19 | Record known limitations | TODO |
| REL-20 | Final submission gate | TODO |

**Verification group: `VG-RELEASE`**

This is the appropriate point for the broadest regression. Do not run `VG-RELEASE` after every small implementation task.

---

## Cross-module Verification Groups

| Group | Trigger |
|---|---|
| `VG-ADMIN-TO-TECH` | Admin create/assign + Technician job visibility both implemented |
| `VG-RESCHEDULE` | Admin/Manager execute + Technician request + history/notification implemented |
| `VG-TECH-UPLOAD` | Supabase evidence storage + validation/retry/metadata implemented |
| `VG-COMPLETION-INTEGRATION` | Technician JOB_DONE + idempotency + notification + Manager review wired |
| `VG-DASHBOARD-INVALIDATION` | completion/reschedule + KPI cache implemented |
| `VG-AI-CONFIG-TO-OPS` | AI Settings routing + Operations AI both implemented |
| `VG-DASHBOARD-TO-INSIGHT` | KPI aggregation + Operational Insight/cache implemented |
| `VG-DOCUMENT-IMPORT` | document extraction + confidence review + human confirm + create/update path wired |
| `VG-RELEASE` | deployment/final submission candidate |

The Main Agent selects only affected groups after a fix unless the change's blast radius justifies broader regression.
