# SejukOps Test Matrix

This matrix separates three evidence classes:

- **Automated** — unit/component/integration/API/browser automation where implemented
- **Agent E2E** — an AI agent actually operates the running application and verifies observable behavior
- **Human UAT** — a human performs the scenario and reports the result

An Agent E2E pass must never be recorded as a Human UAT pass.

Statuses used in execution logs:

```text
NOT_RUN
PASS
FAIL
BLOCKED
PENDING_ENV
```

---

## 1. Foundation / Role / Branch Boundaries

| ID | Scenario | Expected result | Automated | Agent E2E | Human UAT | Group |
|---|---|---|:---:|:---:|:---:|---|
| TC-FND-001 | Switch to Admin | Admin route/layout opens | Yes | Yes | Yes | VG-FOUNDATION |
| TC-FND-002 | Switch to Technician Ali | Technician mobile-first route opens as Ali | Yes | Yes | Yes | VG-FOUNDATION |
| TC-FND-003 | Switch to Manager | Manager route/layout opens | Yes | Yes | Yes | VG-FOUNDATION |
| TC-FND-004 | Technician manually navigates to protected Admin/Manager action | Access/action is blocked server-side, not only hidden in UI | Yes | Yes | No | VG-FOUNDATION |
| TC-FND-005 | Missing Supabase configuration | Dependent integration reports configuration blocker; unrelated UI does not crash | Yes/Mock | Yes when applicable | No | VG-FOUNDATION |
| TC-FND-006 | Seed five branches | Branch records exist with stable codes and required relations can reference them | Yes | Optional | No | VG-FOUNDATION |
| TC-FND-007 | Run deterministic seed twice | Golden orders/reports/reschedules are not duplicated | Yes | No | No | VG-FOUNDATION |
| TC-FND-008 | Technician branch differs from an unrelated order | Branch membership alone does not grant Technician action access; assignment remains authoritative | Yes | Optional | No | VG-FOUNDATION |

---

## 2. Admin Order Workflow

| ID | Scenario | Expected result | Automated | Agent E2E | Human UAT | Group |
|---|---|---|:---:|:---:|:---:|---|
| TC-ADM-001 | Admin creates valid order assigned to Ali | Order persists, human-readable order number exists, branch is valid, status is ASSIGNED, audit events created | Yes | Yes | Yes | VG-ADMIN-ORDER |
| TC-ADM-002 | Required order field missing | Submit blocked with clear validation feedback | Yes | Yes | Yes | VG-ADMIN-ORDER |
| TC-ADM-003 | Duplicate/order-number collision path | System handles uniqueness safely without corrupting order | Yes | Optional | No | VG-ADMIN-ORDER |
| TC-ADM-004 | Long customer name/address/problem description | UI remains usable without overflow | Optional | Yes | Yes | VG-ADMIN-ORDER |
| TC-ADM-005 | Successful order submission transition | Loading -> success summary is clear and not jarring | Optional | Yes | Yes | VG-ADMIN-ORDER |
| TC-ADM-006 | Create order with scheduled time | `scheduled_at` is stored and shown without changing lifecycle semantics | Yes | Yes | Yes | VG-ADMIN-ORDER |

---

## 3. Admin -> Technician Integration

| ID | Scenario | Expected result | Automated | Agent E2E | Human UAT | Group |
|---|---|---|:---:|:---:|:---:|---|
| TC-XMOD-001 | Admin assigns new order to Ali, then switch to Ali | New order appears in Ali's My Jobs | Yes | Yes | Yes | VG-ADMIN-TO-TECH |
| TC-XMOD-002 | Switch from Ali to John | Ali-only order is not actionable by John | Yes | Yes | Yes | VG-ADMIN-TO-TECH |

---

## 4. Scheduling / Reschedule

| ID | Scenario | Expected result | Automated | Agent E2E | Human UAT | Group |
|---|---|---|:---:|:---:|:---:|---|
| TC-RSCH-001 | Admin directly reschedules order | `scheduled_at` changes; `order_reschedules` event records old/new values and source | Yes | Yes | Yes | VG-RESCHEDULE |
| TC-RSCH-002 | Manager directly reschedules order | Same as Admin; source records Manager path | Yes | Yes | Yes | VG-RESCHEDULE |
| TC-RSCH-003 | Technician attempts direct schedule change | Direct mutation is blocked | Yes | Yes | No | VG-RESCHEDULE |
| TC-RSCH-004 | Technician submits request with reason | Pending request persists and Admin/Manager receives in-app notification | Yes | Yes | Yes | VG-RESCHEDULE |
| TC-RSCH-005 | Technician submits request without reason | Request is rejected with clear validation | Yes | Yes | Yes | VG-RESCHEDULE |
| TC-RSCH-006 | Admin/Manager approves Technician request | Request becomes APPROVED and one executed reschedule event is created | Yes | Yes | Yes | VG-RESCHEDULE |
| TC-RSCH-007 | Admin/Manager rejects Technician request | Request becomes REJECTED and no executed reschedule event is created | Yes | Yes | Optional | VG-RESCHEDULE |
| TC-RSCH-008 | Schedule changes time but remains same calendar day | Event is stored with `same_day = true` and counts in raw reschedule KPI | Yes | Yes | Yes | VG-RESCHEDULE |
| TC-RSCH-009 | Admin/Manager executes reschedule | Assigned Technician receives in-app notification | Yes | Yes | Yes | VG-RESCHEDULE |
| TC-RSCH-010 | Reschedule event occurs | Main order lifecycle status remains otherwise unchanged | Yes | Yes | No | VG-RESCHEDULE |

---

## 5. Technician Workflow & Evidence Upload

| ID | Scenario | Expected result | Automated | Agent E2E | Human UAT | Group |
|---|---|---|:---:|:---:|:---:|---|
| TC-TECH-001 | Ali opens assigned job | Customer/problem/service/schedule/quoted context is visible | Yes | Yes | Yes | VG-TECH-CORE |
| TC-TECH-002 | Ali starts assigned job | ASSIGNED -> IN_PROGRESS; audit event created | Yes | Yes | Yes | VG-TECH-CORE |
| TC-TECH-003 | Wrong technician tries Start Job | Server rejects state change | Yes | Yes | No | VG-TECH-CORE |
| TC-TECH-004 | Enter work done + extra charges | Final amount uses authoritative quoted + extra calculation | Yes | Yes | Yes | VG-TECH-COMPLETION |
| TC-TECH-005 | Upload valid evidence within six-file limit | Valid files persist in private Supabase storage and metadata remains visible to permitted roles | Yes | Yes | Yes | VG-TECH-UPLOAD |
| TC-TECH-006 | Attempt seventh evidence file | UI/server rejects exceeding limit clearly | Yes | Yes | Yes | VG-TECH-UPLOAD |
| TC-TECH-007 | Upload unsupported MIME/type | UI/server rejects file with actionable message | Yes | Yes | Optional | VG-TECH-UPLOAD |
| TC-TECH-008 | Upload file over configured per-file limit | File is rejected without corrupting successful uploads | Yes | Yes | Optional | VG-TECH-UPLOAD |
| TC-TECH-009 | Combined files exceed report total limit | Submit/upload path blocks additional excess data clearly | Yes | Yes | Optional | VG-TECH-UPLOAD |
| TC-TECH-010 | Partial evidence upload failure | Successful files remain; failed files are identified/retryable | Yes | Yes | Optional | VG-TECH-UPLOAD |
| TC-TECH-011 | Storage upload succeeds but metadata write fails | Best-effort cleanup runs or orphan is identifiable; failed item is not treated as valid metadata | Yes | Optional | No | VG-TECH-UPLOAD |
| TC-TECH-012 | Unauthorized user tries evidence access | Private evidence cannot be fetched through an unauthorized application path | Yes | Yes | No | VG-TECH-UPLOAD |
| TC-TECH-013 | Complete valid job | IN_PROGRESS -> JOB_DONE; report/audit/side effects created | Yes | Yes | Yes | VG-TECH-COMPLETION |
| TC-TECH-014 | Double-click / retry Complete Job | One service report/transition/completion event is produced; duplicate side effects are prevented | Yes | Yes | No | VG-TECH-COMPLETION |
| TC-TECH-015 | Retry completion after first response was slow but commit succeeded | Server returns safe already-completed/idempotent outcome instead of duplicating data | Yes | Yes | No | VG-TECH-COMPLETION |
| TC-TECH-016 | Phone viewport interaction | No horizontal overflow; touch targets/forms/nav remain usable | Optional | Yes | Yes | VG-TECH-COMPLETION |
| TC-TECH-017 | Completion UI motion | Pending/state/success transitions communicate progress without encouraging repeated taps | Optional | Yes | Yes | VG-TECH-COMPLETION |
| TC-TECH-018 | Reduced-motion preference where supported | Essential feedback remains understandable without unnecessary motion | Optional | Yes | Optional | VG-TECH-COMPLETION |

Suggested Agent visual viewports:

```text
360px
390px
430px
```

---

## 6. WhatsApp Notification + Manager Review

| ID | Scenario | Expected result | Automated | Agent E2E | Human UAT | Group |
|---|---|---|:---:|:---:|:---:|---|
| TC-CMP-001 | Job becomes JOB_DONE | Customer WhatsApp notification record becomes READY | Yes | Yes | Yes | VG-COMPLETION-INTEGRATION |
| TC-CMP-002 | Open Send Customer WhatsApp | WhatsApp/WhatsApp Web deep link opens and local notification becomes OPENED | Yes where possible | Yes | Yes | VG-COMPLETION-INTEGRATION |
| TC-CMP-003 | Inspect notification status | UI never claims SENT/DELIVERED/READ for deep-link implementation | Yes | Yes | Yes | VG-COMPLETION-INTEGRATION |
| TC-CMP-004 | WhatsApp generation fails | Valid job remains JOB_DONE; warning/retry is shown | Yes | Yes with failure fixture | No | VG-COMPLETION-INTEGRATION |
| TC-CMP-005 | Repeat completion/retry path | At most one completion WhatsApp notification business record exists | Yes | Yes | No | VG-COMPLETION-INTEGRATION |
| TC-CMP-006 | Manager opens completed-job queue | Newly completed job is visible | Yes | Yes | Yes | VG-COMPLETION-INTEGRATION |
| TC-CMP-007 | Manager approves completed job | JOB_DONE -> REVIEWED -> CLOSED with audit trace | Yes | Yes | Yes | VG-COMPLETION-INTEGRATION |
| TC-CMP-008 | Manager requests clarification | JOB_DONE -> IN_PROGRESS with traceable request | Yes | Yes | Yes | VG-COMPLETION-INTEGRATION |
| TC-CMP-009 | Admin/Manager reopens WhatsApp action | Existing message can be opened again without fabricating delivery state | Yes | Yes | Optional | VG-COMPLETION-INTEGRATION |
| TC-CMP-010 | Inspect role set / completion notification | No separate Accounts role is required; Manager in-app review queue covers assessment completion-review path | Yes/manual | Yes | Optional | VG-COMPLETION-INTEGRATION |

---

## 7. KPI Dashboard

| ID | Scenario | Expected result | Automated | Agent E2E | Human UAT | Group |
|---|---|---|:---:|:---:|:---:|---|
| TC-KPI-001 | Open Manager Dashboard | This Week is default | Yes | Yes | Yes | VG-KPI-DASHBOARD |
| TC-KPI-002 | Select Today | KPI values use today's range; trend uses hourly/time-of-day buckets | Yes | Yes | Yes | VG-KPI-DASHBOARD |
| TC-KPI-003 | Select This Week | KPI values use current week; trend uses daily buckets | Yes | Yes | Yes | VG-KPI-DASHBOARD |
| TC-KPI-004 | Select This Month | KPI values use current month; trend uses weekly buckets | Yes | Yes | Yes | VG-KPI-DASHBOARD |
| TC-KPI-005 | Switch Week -> Month -> Week | Cached weekly data can render without needless duplicate full-data fetch | Yes/Integration | Yes | Optional | VG-KPI-DASHBOARD |
| TC-KPI-006 | Compare dashboard output to deterministic seed manifest/query | Completed/amount/rescheduled/average/rankings match source of truth | Yes | Optional | No | VG-KPI-DASHBOARD |
| TC-KPI-007 | Complete a job then revisit affected period | Relevant dashboard cache invalidates/refreshes; unrelated app queries are not globally blown away | Yes | Yes | Yes | VG-DASHBOARD-INVALIDATION |
| TC-KPI-008 | Execute same-day reschedule | Raw Rescheduled KPI increases because executed same-day changes count | Yes | Yes | Yes | VG-KPI-DASHBOARD |
| TC-KPI-009 | Reject Technician reschedule request | Rescheduled KPI does not increase | Yes | Yes | Optional | VG-KPI-DASHBOARD |
| TC-KPI-010 | Period switch visual behavior | No full blank-page flash; loading/data transition remains understandable | Optional | Yes | Yes | VG-KPI-DASHBOARD |

---

## 8. AI Provider Configuration & Runtime Errors

| ID | Scenario | Expected result | Automated | Agent E2E | Human UAT | Group |
|---|---|---|:---:|:---:|:---:|---|
| TC-AICFG-001 | Admin adds compatible provider profile | Profile saved with declared/detected capabilities | Yes | Yes | Yes | VG-AI-CONFIG |
| TC-AICFG-002 | Manager/Technician attempts provider configuration | Configuration action is blocked | Yes | Yes | No | VG-AI-CONFIG |
| TC-AICFG-003 | Save BYOK credential | Credential is encrypted at rest and plaintext is not returned after save | Yes | Yes when ENV available | Yes | VG-AI-CONFIG |
| TC-AICFG-004 | Encryption key missing | Credential persistence path reports PENDING_ENV/configuration error; no plaintext fallback | Yes | Yes | No | VG-AI-CONFIG |
| TC-AICFG-005 | Single Model routing with compatible model | Compatible enabled AI tasks resolve to default profile | Yes | Yes | Yes | VG-AI-CONFIG |
| TC-AICFG-006 | Task-based routing | Different tasks resolve to configured profiles | Yes | Yes | Yes | VG-AI-CONFIG |
| TC-AICFG-007 | Route image document to non-vision model | UI blocks execution and explains capability mismatch | Yes | Yes | Yes | VG-AI-CONFIG |
| TC-AICFG-008 | Invalid provider key/model/base URL | Test Connection fails safely without logging/exposing secret | Yes/Mock + real when ENV | Yes | Yes | VG-AI-CONFIG |
| TC-AICFG-009 | Provider returns authentication error | Stable user-facing message tells Admin to verify settings/Test Connection | Yes | Yes with fixture | Yes | VG-AI-CONFIG |
| TC-AICFG-010 | Provider rate limits request | User sees temporary rate-limit/retry guidance; no fake answer | Yes | Yes with fixture | Optional | VG-AI-CONFIG |
| TC-AICFG-011 | Provider timeout/unavailable | User sees retryable failure; normal non-AI screens remain usable | Yes | Yes with fixture | Yes | VG-AI-CONFIG |
| TC-AICFG-012 | Provider fails and another provider is configured | System does not silently spend/use another provider without configured fallback policy | Yes | Yes | No | VG-AI-CONFIG |

Real-provider cases may be `PENDING_ENV` until a human configures a compatible credential.

---

## 9. AI Operations Query

| ID | Scenario | Expected result | Automated | Agent E2E | Human UAT | Group |
|---|---|---|:---:|:---:|:---:|---|
| TC-AIOPS-001 | Ask "What jobs did Ali complete last week?" | Approved tool/query retrieves matching records; answer matches deterministic fixture | Yes | Yes | Yes | VG-AI-OPERATIONS |
| TC-AIOPS-002 | Ask "Which technician completed the most jobs this week?" | Deterministic aggregation is source of numeric truth | Yes | Yes | Yes | VG-AI-OPERATIONS |
| TC-AIOPS-003 | Ask unsupported question | Assistant explains supported scope; no fabricated operational data | Yes | Yes | Yes | VG-AI-OPERATIONS |
| TC-AIOPS-004 | Tool returns no matching records | Explicit no-results answer | Yes | Yes | Yes | VG-AI-OPERATIONS |
| TC-AIOPS-005 | Tool failure | Operational error is surfaced; model does not invent values; Retry/normal screens remain available | Yes | Yes | No | VG-AI-OPERATIONS |
| TC-AIOPS-006 | Attempt prompt that implies arbitrary SQL/database browsing | Model remains constrained to approved tools | Yes | Yes | No | VG-AI-OPERATIONS |
| TC-AIOPS-007 | Same conversation: ask Ali this week then "What about Bala?" | Relevant metric/period context is preserved | Yes | Yes | Yes | VG-AI-OPERATIONS |
| TC-AIOPS-008 | Start/clear new conversation then ask context-dependent follow-up | Previous conversation context is not inherited | Yes | Yes | Yes | VG-AI-OPERATIONS |
| TC-AIOPS-009 | Previous conversation claim conflicts with fresh tool data | Current tool/system result wins | Yes | Yes | No | VG-AI-OPERATIONS |
| TC-AIOPS-010 | Switch Dashboard period and request insight | Insight input matches active period | Yes | Yes | Yes | VG-DASHBOARD-TO-INSIGHT |
| TC-AIOPS-011 | Toggle back to unchanged period | Cached insight for same period + metrics version is reused where valid | Yes | Yes | Optional | VG-DASHBOARD-TO-INSIGHT |

---

## 10. Workflow Supervisor

| ID | Scenario | Expected result | Automated | Agent E2E | Human UAT | Group |
|---|---|---|:---:|:---:|:---:|---|
| TC-WF-001 | Final amount exceeds configured variance threshold | Deterministic flag is created | Yes | Yes | Yes | VG-WORKFLOW-SUPERVISOR |
| TC-WF-002 | JOB_DONE with no evidence | Missing-evidence flag created | Yes | Yes | Yes | VG-WORKFLOW-SUPERVISOR |
| TC-WF-003 | Normal completed job | No false-positive flag for configured rules | Yes | Yes | Optional | VG-WORKFLOW-SUPERVISOR |
| TC-WF-004 | AI explanation unavailable | Deterministic flag remains usable without blocking review | Yes | Yes with provider failure | No | VG-WORKFLOW-SUPERVISOR |

---

## 11. Document Understanding

| ID | Scenario | Expected result | Automated | Agent E2E | Human UAT | Group |
|---|---|---|:---:|:---:|:---:|---|
| TC-DOC-001 | Upload text-native supported document | Text path extracts supported fields into validated draft | Yes | Yes | Yes | VG-DOCUMENT-UNDERSTANDING |
| TC-DOC-002 | Upload image/scanned document with vision-capable provider | Structured fields extracted into validated draft | Mock + real when ENV | Yes when ENV | Yes when ENV | VG-DOCUMENT-UNDERSTANDING |
| TC-DOC-003 | Clear unambiguous field | Field can display `high` confidence when validation succeeds | Yes | Yes | Optional | VG-DOCUMENT-UNDERSTANDING |
| TC-DOC-004 | Ambiguous candidate field | Field displays `medium` or `low` and is visibly reviewable rather than silently certain | Yes | Yes | Yes | VG-DOCUMENT-UNDERSTANDING |
| TC-DOC-005 | Missing field | Value remains null with `missing` confidence rather than guessed | Yes | Yes | Yes | VG-DOCUMENT-UNDERSTANDING |
| TC-DOC-006 | Admin edits extracted draft then confirms | Edited values are used for final create/update | Yes | Yes | Yes | VG-DOCUMENT-IMPORT |
| TC-DOC-007 | Model returns invalid amount/date/schema | Validation blocks write and shows reviewable error | Yes | Yes | No | VG-DOCUMENT-UNDERSTANDING |
| TC-DOC-008 | Provider/extraction fails | No operational record is written; uploaded source/retry path remains understandable | Yes | Yes with fixture | Yes | VG-DOCUMENT-UNDERSTANDING |
| TC-DOC-009 | Compatible provider credential missing | Real extraction is PENDING_ENV; rest of app remains usable | Yes | Yes | No | VG-DOCUMENT-UNDERSTANDING |

---

## 12. Release / Full Assessment Flow

| ID | Scenario | Expected result | Automated | Agent E2E | Human UAT | Group |
|---|---|---|:---:|:---:|:---:|---|
| TC-REL-001 | Full Admin -> Technician -> WhatsApp -> Manager -> Dashboard flow | End-to-end workflow succeeds with correct state/data transitions | Relevant suites | Yes | Yes | VG-RELEASE |
| TC-REL-002 | Full reschedule request/approval flow | Technician request -> Manager/Admin resolution -> schedule/history/notification works | Relevant suites | Yes | Yes | VG-RELEASE |
| TC-REL-003 | Full AI configuration -> Operations Query flow | Admin configuration drives Manager AI through approved tools | Relevant suites | Yes | Yes | VG-RELEASE |
| TC-REL-004 | Document import flow | Upload -> extraction/confidence -> human review -> create/update works | Relevant suites | Yes | Yes | VG-RELEASE |
| TC-REL-005 | Production build/deploy smoke | Build succeeds and deployed app loads required routes | Yes | Yes | Yes | VG-RELEASE |
| TC-REL-006 | Secret exposure review | No committed secret, browser plaintext re-exposure, or sensitive logging | Yes/manual QA | Yes | No | VG-RELEASE |
| TC-REL-007 | Deterministic seed/golden manifest review | Dashboard and AI eval use the same expected fixture facts without contradiction | Yes | Optional | No | VG-RELEASE |

---

# Human UAT Script

These are the minimum human-facing scenarios to execute before submission. Record actual outcomes in `VERIFICATION_LOG.md`.

## UAT-ADMIN-01 — Create and Assign an Order

Steps:

1. Open SejukOps and switch to Admin.
2. Create a realistic customer/service order.
3. Assign branch/technician and schedule.
4. Submit.
5. Open the resulting order detail.

Human verifies:

- form is understandable without explanation
- validation is clear
- success feedback is clear
- order number/status/customer/branch/technician values are correct
- desktop UI feels coherent and familiar

## UAT-RSCH-01 — Technician Request and Manager/Admin Reschedule

Steps:

1. Switch to Technician Ali.
2. Request a reschedule and provide a reason.
3. Switch to Admin or Manager.
4. Review and approve the request.
5. Confirm the new schedule and history.
6. Repeat with a same-day time change where practical.

Human verifies:

- Technician cannot directly change the schedule
- request reason/decision is understandable
- internal notifications are clear
- executed reschedule history is traceable
- same-day time change is still recorded

## UAT-TECH-01 — Complete a Field Job on Mobile

Steps:

1. Open the app at a phone-sized viewport/device.
2. Switch to Technician Ali.
3. Find the newly assigned job.
4. Start it.
5. Enter work done and extra charges.
6. Upload evidence.
7. Complete the job.

Human verifies:

- job is easy to locate
- controls are touch-friendly
- layout does not overflow
- status/action transitions are understandable
- loading/success animations feel purposeful rather than distracting
- completion pending state discourages duplicate taps
- final amount is understandable

## UAT-UPLOAD-01 — Evidence Validation and Retry

Steps:

1. Upload allowed photo/PDF/video fixture(s).
2. Attempt an unsupported or intentionally over-limit fixture/metadata case.
3. Trigger a designated partial-failure fixture where supported.
4. Retry the failed item.

Human verifies:

- accepted/rejected files are obvious
- six-file and size/type policy is understandable
- one failed item does not erase successful uploads
- retry is local to the failed item where possible

## UAT-WA-01 — Customer WhatsApp Action

Steps:

1. From Technician completion success, choose Send Customer WhatsApp.
2. Confirm WhatsApp/WhatsApp Web opens with the expected recipient/message.
3. Return to SejukOps.

Human verifies:

- prepared message is correct and readable
- SejukOps records only READY/OPENED-like observable state
- application does not claim delivery/read status

The human does **not** need to actually message a real customer for assessment validation unless a designated test number is intentionally used.

## UAT-MGR-01 — Review and Close Job

Steps:

1. Switch to Manager.
2. Open review queue.
3. Inspect the completed job, evidence, amounts, audit history, and flags.
4. Approve and close it.

Human verifies:

- information needed for decision is visible
- actions are clear
- state changes make sense
- desktop review UX is efficient

## UAT-KPI-01 — Dashboard Period Behavior

Steps:

1. Open Manager Dashboard.
2. Observe default This Week.
3. Switch to Today.
4. Switch to This Month.
5. Return to This Week.

Human verifies:

- KPI values/rankings/distribution change with period
- trend granularity feels appropriate
- switching periods does not cause jarring blank reloads
- chart/data transitions are readable
- executed same-day reschedules are represented by the raw Rescheduled metric

## UAT-AICFG-01 — Configure AI Provider

Steps:

1. Switch to Admin.
2. Add/configure an available test provider/model.
3. Test connection.
4. Choose Single Model or Task-based Routing.

Human verifies:

- capability requirements are understandable
- secret input is handled safely in UI
- routing choice is understandable
- incompatible configuration produces actionable feedback

If no real key is available, record `PENDING_ENV` rather than passing this case.

## UAT-AIOPS-01 — Ask Operations Questions and Recover from Failure

Steps:

1. Switch to Manager.
2. Ask at least two supported questions whose correct answers can be independently checked in Dashboard/order data.
3. Ask a same-conversation follow-up such as `What about Bala?`.
4. Clear/start a new conversation and verify the old conversational reference is gone.
5. Ask one unsupported question.
6. Use a failure fixture/provider state if available.

Human verifies:

- supported answers match visible data
- same-conversation context works
- a new conversation does not inherit prior memory
- unsupported behavior is clear
- provider/tool failure explains what happened and what to do next
- AI does not appear to have unrestricted database behavior

## UAT-DOC-01 — Document Understanding

Steps:

1. Switch to Admin.
2. Upload a designated test document.
3. Review extracted fields and confidence states.
4. Correct one field if needed.
5. Confirm the draft.

Human verifies:

- extracted values are presented as a reviewable draft
- high/medium/low/missing states are understandable
- uncertain/missing data is not silently invented
- editing before write is straightforward
- a failed extraction does not create/update operational data

If a compatible real provider/key is unavailable, record `PENDING_ENV`.
