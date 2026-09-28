# Agent-native Rebuild — Phased Plan

**Planning only, 2026-09-28.** This plan records the direction; it does not start development. Read [AGENTS.md](../../AGENTS.md), [PROJECT_STATE.md](../../PROJECT_STATE.md), and [the system specification](../SYSTEM_SPEC.md). P0 is the only presently authorized work.

Use AI-Native Development Practice: phase-by-phase, bounded scope, adaptive execution, grouped edits/commits, evidence-based gates. Main Agent may split/reorder phases with rationale and preserved acceptance mapping. No mandatory fixed sub-agent team and no Agent Continuity runtime in this repo.

## P0 — Direction and handoff (documentation only)

**Deliverable:** scoped direction PR, updated entry points, one execution-state ledger, future phase acceptance, and explicit data/removal allowance.

**Gate P0-DOC:** the docs distinguish target from existing code, include all agreed surfaces and privacy/authority boundaries, contain working internal links, and change no code/manifests/migrations/seeds/deployment configuration. No app/runtime test claim. Leave the PR open; no merge/deploy; wait for explicit implementation authorization.

## P1 — Foundation, Auth, and workspace isolation

**Depends on:** explicit implementation authorization; confirmed repo/resource scope.

Reuse/reshape operational services around verified actor context. Add Supabase owner/anonymous-demo Auth, separate platform privilege and workspace membership, shared Demo + private Owner boundaries, scoped Storage, and a reproducible fresh schema/fixture path. Inventory all tables, joins, RPCs, caches, and privileged access before claiming isolation. Identify obsolete features for coherent removal. No legacy data backfill is required.

**Acceptance:**

- **F-AUTH:** real sessions; server-approved Demo personas; no client role escalation; audit preserves actual visitor identity and any synthetic technician persona.
- **F-ISOLATION:** Demo cannot list, query, join, mutate, retrieve, cite, or download Owner data through UI, API, direct data access, RPC, Storage, caches, or diagnostics. Foreign records cannot be linked across workspaces.
- **F-PLATFORM:** only Super Admin accesses sensitive settings/technical observations/reset; operational actions retain explicit workspace context and role rules.
- **F-DATA:** clean schema/seed can reproduce two distinct synthetic datasets; resource target verified before destructive work; baseline Owner data remains outside routine Demo resets.

**Evidence gate:** targeted unit/contracts plus live database/Auth/Storage negative tests where available. Focused boundary mutation/fault tests. Missing environment stays `PENDING_ENV`, never an isolation pass. No public launch before this gate.

## P2 — Shared capabilities, real-model spike, and proposals

**Depends on:** actor/capability contracts and usable P1 isolation. A narrowly scoped compatibility spike can run in parallel after authorization, without expanding access.

Replace the single-tool planner with a bounded AI SDK runtime. Adapt existing operational services; prove one real model can select typed tools and return a structured useful result. Add persisted proposal execution for one atomic creation/assignment workflow. Retire superseded generic planner plumbing rather than retaining two active architectures.

**Acceptance:**

- **A-TOOLS:** capabilities enforce the same actor/record rules as manual operations; unavailable tools are not exposed and cannot be invoked by fabricated names.
- **A-RUNTIME:** bounded reads/multi-step execution, missing-field questions, typed events, cancellation/timeouts and controlled provider failure. No silent scripted fallback.
- **A-PROPOSAL:** exact versioned payload, expiry, permission and state revalidation, atomic action/audit, idempotent retries, and rejection of stale/modified/cross-workspace proposals.
- **A-CONSENT:** model text cannot authorize its own write; edits require renewed human review. No paused durable agent is required just to store a proposal.

**Evidence gate:** live tool-calling spike early, adversarial tool/approval tests, concurrent/retry transaction checks. Historical CRM/assessment success is not evidence for this runtime.

## P3 — Knowledge pipeline and document intake

**Depends on:** P1 boundaries; P2 tools for agent access. Core ingestion may be developed alongside P2 when contracts are stable.

Separate operational document-to-order import from knowledge publication. Reuse upload/parser components, add bounded text/Markdown/PDF indexing, metadata review, stable citations, and workspace-scoped retrieval. Keep conventional intake and let the agent prepare the same drafts/proposals with fewer manual steps.

**Acceptance:**

- **K-INTAKE:** supported input limits, parse/index status, duplicate/version hints, reviewable metadata, useful failure/retry path; unknown metadata is not invented.
- **K-PUBLISH:** only authorized published+ready versions are searchable; failed replacement preserves the old active version; archive/delete invalidates retrieval; old workers cannot publish after Demo reset.
- **K-GROUND:** citations resolve to actual authorized passages; insufficient/conflicting sources produce limitations; retrieval quality and claim support are evaluated separately.
- **K-IMPORT:** operational import creates a reviewed order, not a KB entry by accident; knowledge intake publishes a document, not an order by accident.

**Evidence gate:** small curated fixture corpus with expected evidence/abstention cases, English/Chinese prompts, indexing/version/retry/isolation tests. Compare a simple retrieval/context baseline; add hybrid/reranking only when warranted. Scans, arbitrary URLs, and large ingestion jobs are not silently accepted.

## P4 — Two understandable interaction modes

**Depends on:** P2 core; P3 knowledge integration for the full demo.

Keep conventional operations with contextual AI Assist. Add a task-driven Agent Workspace with onboarding, task starters, real activity, evidence, typed record/proposal cards, approval, and navigation back to manual records. Reuse one backend and one domain policy, not two feature implementations.

**Acceptance:**

- **U-DUAL:** demonstrate the same case manually with AI assistance and through goal-driven agent orchestration; actual records agree in both surfaces.
- **U-GUIDE:** a first-time visitor can discover supported tasks, understand proposed changes, inspect sources, and complete or decline a task without guessing prompts.
- **U-STATE:** loading, errors, retries, cancellation, stale proposals, refresh, role/workspace changes, and private conversation handling work without leaking previous context.
- **U-FIELD:** retained Technician flow remains usable on mobile; no unnecessary full chat parity across all roles.

**Evidence gate:** focused UI checks and actual browser/visual E2E for significant flows, including failure paths. Human UAT recorded separately when a human performs it.

## P5 — Authenticated MCP interoperability

**Depends on:** P1 actor authorization and stable capabilities; full product story benefits from P3/P4.

Expose a small remote MCP adapter over existing read/search capabilities. Select one actual host and supported authentication path; use framework/SDK protocol support rather than hand-writing OAuth or a transport. Scoped credentials map to a real actor/workspace; they are not Supabase service-role keys. Do not depend on website cookies being present in an external client.

**Acceptance:**

- **M-READ:** one real client discovers tools and reads operational/knowledge data without navigating the website; results are structured and citations remain usable as text/source references.
- **M-AUTH:** missing/invalid/expired/revoked credentials and wrong workspace/role/scope are rejected by the server; no default-admin identity.
- **M-PARITY:** equivalent website/MCP reads share policy and data; use limits and audit identify the external client/actor.

**Evidence gate:** protocol/client integration plus negative authorization tests. ChatGPT-specific availability is checked against the actual account/client at implementation time, not hard-coded into acceptance from remembered subscription claims. Read-only MCP is not external-write completion.

**Deferred extension:** external proposal approval/execution, full multi-client OAuth onboarding, and external binary/document transfer. Reuse the same proposal/domain layer later. Before allowing writes, define how trusted consent binds the exact payload; do not rely on an LLM boolean or assume every host supports rich approval cards.

## P6 — Demo readiness, observation, and cleanup

**Depends on:** the accepted feature slices above. Observability is instrumented as those slices are built, not bolted on only at the end.

Integrate Langfuse and protect the Super Admin observation/configuration surface; keep user-facing activity separate. Enforce public-demo budgets and upload limits, provide a scoped manual Demo reset, complete evaluation cases, retire replaced features/docs, and prepare a repeatable demo.

**Acceptance:**

- **R-OBSERVE:** a real request is traceable through model/tools/retrieval/proposal; secret redaction and workspace access hold; external telemetry failure cannot corrupt business execution.
- **R-ABUSE:** account/IP/workspace/global quotas, bounded runs, restricted model routing, upload limits, and a shutoff path work server-side.
- **R-RESET:** reset affects only Demo data; in-flight/stale operations cannot mutate the new generation; private Owner data/settings remain intact; reset is auditable.
- **R-CLEANUP:** replaced runtimes/routes/settings are removed, active docs describe actual behavior, historical evidence remains labeled, and mocks/live modes cannot be confused.
- **R-DEMO:** demonstrate successful investigation/approval, missing evidence, stale proposal rejection, document intake, role restrictions, Demo/Owner isolation, and one authenticated MCP read.

**Evidence gate:** necessary broad regression, representative live model/DB/MCP checks, targeted security/adversarial and browser testing. Record measured latency/tool steps/usage and failures without invented targets or scores. Human UAT is `NOT_RUN` until reported. Deployment and merge still require their own authorization.

## Scope and effort controls

The largest work is P1's cross-cutting data/auth boundary and P3's knowledge lifecycle. UI and MCP registration are smaller only if they reuse verified capabilities. Avoid claiming that adding two workspaces or real Auth is just adding a field/login form.

Do not add multi-agent, long-term memory, a workflow builder, arbitrary document support, per-user cloned workspaces, billing, inventory, or autonomous scheduling. Do not install LangChain agent runtime, LangGraph, or LlamaIndex alongside AI SDK merely to list more technology. Choose one MCP adapter. Keep one complete write path and a small evaluation corpus before extending coverage.

At each gate the Main Agent records **proceed / repair / blocked** with evidence in `PROJECT_STATE.md`. Package choices, acceptance assumptions, or scope changes are recorded there with a pointer to the changed requirement. This plan contains criteria—not a second progress ledger.
