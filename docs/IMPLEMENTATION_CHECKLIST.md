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
| P0-09 | Generate initial OpenWiki codebase documentation | TODO |
| P0-10 | Create local model capability inventory | TODO — per development environment |
| P0-11 | Create local environment status inventory | TODO — per development environment |
| P0-12 | UI stack decision — Ant Design + Ant Design Mobile | VERIFIED |
| P0-13 | LLM evaluation strategy / domain eval definition | TODO |

Phase gate:

- specifications are readable by a new Main Agent
- local model/env files are created before first delegated implementation
- OpenWiki generation is helpful but must not block initial scaffolding if the tool is not yet available

---

## Phase 1 — Foundation

| ID | Item | Status |
|---|---|---|
| FND-01 | Initialise Next.js + TypeScript | TODO |
| FND-02 | Install/configure Ant Design + Ant Design Mobile | TODO |
| FND-03 | Establish shared SejukOps design tokens/components | TODO |
| FND-04 | Configure Supabase project client/server boundaries | TODO |
| FND-05 | Create initial DB migrations/schema | TODO |
| FND-06 | Seed Admin, Manager, Ali, John, Bala, Yusoff | TODO |
| FND-07 | Implement mock login / role switcher | TODO |
| FND-08 | Add `/admin`, `/technician`, `/manager` route boundaries | TODO |
| FND-09 | Enforce route-level role guards | TODO |
| FND-10 | Add base loading/error/not-found handling | TODO |
| FND-11 | Establish shared motion/accessibility conventions | TODO |

**Verification group: `VG-FOUNDATION`**

Run when FND-01 through FND-10 form a runnable baseline.

Required evidence:

- targeted type/lint checks during implementation
- app boot smoke
- Ant Design desktop shell smoke
- Ant Design Mobile technician shell smoke
- role-switch route test
- Supabase connection/schema check when ENV available
- QA Agent review

---

## Phase 2 — Admin Order Workflow

| ID | Item | Status |
|---|---|---|
| ADM-01 | Admin order list | TODO |
| ADM-02 | Order filters/status presentation | TODO |
| ADM-03 | New order form | TODO |
| ADM-04 | Human-readable order number generation | TODO |
| ADM-05 | Customer creation/reuse logic | TODO |
| ADM-06 | Technician assignment | TODO |
| ADM-07 | Order detail page | TODO |
| ADM-08 | Submission summary/success state | TODO |
| ADM-09 | Order creation + assignment audit events | TODO |
| ADM-10 | Admin UI loading/empty/error/validation states | TODO |
| ADM-11 | Admin UI transitions/micro-interactions | TODO |

**Verification group: `VG-ADMIN-ORDER`**

Run once the full create → assign → detail slice is implemented.

Required evidence:

- order validation tests
- order number uniqueness/constraint test
- creation/assignment integration test
- Admin browser scenario
- UI/UX visual QA

---

## Phase 3 — Technician Mobile-first Workflow

| ID | Item | Status |
|---|---|---|
| TECH-01 | Mobile-first My Jobs list | TODO |
| TECH-02 | Job prioritisation for ASSIGNED / IN_PROGRESS | TODO |
| TECH-03 | Job detail with customer/problem context | TODO |
| TECH-04 | `ASSIGNED → IN_PROGRESS` Start Job action | TODO |
| TECH-05 | Completion form — Work Done / Remarks | TODO |
| TECH-06 | Extra Charges + authoritative Final Amount calculation | TODO |
| TECH-07 | Up-to-6 evidence upload | TODO |
| TECH-08 | Optional payment capture | TODO |
| TECH-09 | `IN_PROGRESS → JOB_DONE` completion transaction | TODO |
| TECH-10 | Assigned-technician-only server enforcement | TODO |
| TECH-11 | Ant Design Mobile bottom navigation / phone UX | TODO |
| TECH-12 | Loading/error/success/empty states | TODO |
| TECH-13 | Purposeful transitions + reduced-motion considerations | TODO |
| TECH-14 | Visual QA at ~360 / 390 / 430px | TODO |

**Verification group: `VG-TECH-CORE`**

Batch TECH-01 through TECH-06 before broad Technician feature testing.

**Verification group: `VG-TECH-COMPLETION`**

Run after TECH-07 through TECH-10 are integrated with the core flow.

Required evidence:

- assigned technician authorization tests
- final amount calculation tests
- upload constraints tests
- Technician Agent E2E
- phone visual QA

---

## Phase 4 — Completion, Notification & Manager Review

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
| CMP-09 | Approve: JOB_DONE → REVIEWED → CLOSED | TODO |
| CMP-10 | Clarification/rework: JOB_DONE → IN_PROGRESS | TODO |
| CMP-11 | Review audit events | TODO |
| CMP-12 | Notification failure does not roll back valid completion | TODO |

**Verification group: `VG-COMPLETION-INTEGRATION`**

Run only after Technician completion, notification preparation, Manager queue, and review actions are wired together.

Required Agent E2E:

```text
Technician completes job
→ notification READY
→ open WhatsApp action
→ notification OPENED
→ Manager sees review item
→ Manager approves or requests clarification
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
| KPI-16 | Reschedule history tracking | TODO |
| KPI-17 | Query/index review for actual access patterns | TODO |
| KPI-18 | Loading/empty/error + smooth period transitions | TODO |

**Verification group: `VG-KPI-DASHBOARD`**

Do not repeatedly test each chart alone. Test the dashboard as a period-aware feature slice after the aggregation contract is stable.

Required evidence:

- aggregate/query tests for all three periods
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
| AIOPS-11 | Operational Insight using deterministic metrics | TODO |
| AIOPS-12 | Insight cache keyed by period + metrics version | TODO |
| AIOPS-13 | SejukOps domain eval dataset with deterministic DB fixtures | TODO |
| AIOPS-14 | Golden tool-selection + argument evaluation | TODO |
| AIOPS-15 | Irrelevant/unsupported/no-tool cases | TODO |
| AIOPS-16 | Multi-turn follow-up/context cases | TODO |
| AIOPS-17 | Repeated-run consistency + latency/cost reporting | TODO |
| AIOPS-18 | Optional public tool-use benchmark qualification for candidate models | TODO |

**Verification group: `VG-AI-OPERATIONS`**

Use deterministic fixtures/tool mocks first. Real provider tests run only when a compatible provider is configured.

Product acceptance must rely on the SejukOps domain eval, not on a public benchmark score alone. Public tool-use benchmarks may be used to qualify or compare candidate models before routing them into the product.

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
| AADV-07 | Human preview/edit before database write | TODO |
| AADV-08 | Capability mismatch handling | TODO |
| AADV-09 | Real reference-model integration where ENV available | TODO |

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
| REL-14 | Human UAT — AI provider setup | TODO |
| REL-15 | Human UAT — AI Operations | TODO |
| REL-16 | Human UAT — Document Understanding | TODO |
| REL-17 | Record known limitations | TODO |
| REL-18 | Final submission gate | TODO |

**Verification group: `VG-RELEASE`**

This is the appropriate point for the broadest regression. Do not run `VG-RELEASE` after every small implementation task.

---

## Cross-module Verification Groups

| Group | Trigger |
|---|---|
| `VG-ADMIN-TO-TECH` | Admin create/assign + Technician job visibility both implemented |
| `VG-COMPLETION-INTEGRATION` | Technician JOB_DONE + notification + Manager review wired |
| `VG-DASHBOARD-INVALIDATION` | completion/reschedule + KPI cache implemented |
| `VG-AI-CONFIG-TO-OPS` | AI Settings routing + Operations AI both implemented |
| `VG-DASHBOARD-TO-INSIGHT` | KPI aggregation + Operational Insight/cache implemented |
| `VG-DOCUMENT-IMPORT` | document extraction + human review + create/update path wired |
| `VG-RELEASE` | deployment/final submission candidate |

The Main Agent selects only affected groups after a fix unless the change's blast radius justifies broader regression.