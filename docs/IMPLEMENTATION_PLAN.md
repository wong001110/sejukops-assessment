# Sejuk Ops — Adaptive Implementation Plan

**Planning only. No implementation phase is authorized by this document.** Current progress lives only in [PROJECT_STATE.md](../PROJECT_STATE.md).

## Execution rules

Use AI-Native Development Practice: native-first tooling, Main Agent ownership, selective delegation, phase-by-phase delivery, evidence-based acceptance, and risk-proportionate testing. Split/merge/reorder phases when dependencies or evidence justify it; retain acceptance IDs and record the reason. Do not change an unverified item to complete simply because a phase was renamed.

Group meaningful changes before testing/committing. Broad regression is justified for cross-cutting authorization/isolation or a release candidate, not every UI edit. New external costs, unidentified deployment targets, or material scope changes need explicit resolution; routine in-scope decisions do not require repeated approval once implementation is authorized.

## P0 — Direction and handoff

Scope: record accepted product direction, target architecture, scope exclusions, data replacement permission, development rules, and the implementation-not-started boundary. Consolidate direction PRs #35 and #36 into one documentation PR.

Exit: coherent documentation, current/target distinction, and no runtime/dependency/database/infrastructure changes. The owner authorized merging the consolidated direction; deployment and P1 implementation remain separate permissions.

## P1 — Auth, workspaces, administration, clean baseline

Scope: verify the exact Sejuk Ops environment; design a reproducible fresh baseline without historical-data migration; retain real Owner Auth and add a one-click, application-managed Guest visit for the shared Demo workspace. Enter in the Demo Admin perspective and switch perspectives inside the workspace. Resolve Owner and Guest actors separately, with server-validated Demo persona selection, platform privileges, workspace scope, and Demo/Owner isolation. No visitor Auth account, email, password, or name is required. Provide the sensitive administration boundary, not a full account-management product.

Replace the unfinished Supabase-anonymous entry, persona, actor, and quota assumptions rather than layering a second public identity mechanism on top. Include workspace-safe operational keys/RPCs/storage/caches, Guest visit isolation for drafts/proposals/audit, server-controlled fictional technician mapping, one shared daily Guest AI allowance, and a deterministic reset design. Ordinary Demo writes have no count quota. Verify required existing business invariants rather than blindly preserving assessment feature parity.

Exit: AUTH-01, ISO-01, ADMIN-01, DATA-01. Integration/negative tests must cover privileged DB paths as well as UI routes. The owner has authorized P1 and confirmed its project target; the exact effects of a migration or reset still require review before execution.

## P2 — Shared capabilities, proposals, first live agent slice

Scope: expose a small set of actor-aware operational capabilities; replace the one-shot planner with the preferred AI SDK runtime; retain relevant provider credential/network safety. Add persisted proposals and deterministic execution for one chosen operational action.

Run a real-provider tool-call slice early, before broad UI work. Ensure the selected scheduling/technician claims are backed by data; limit recommendations when that data is absent. Keep manual operations usable.

Exit: CAP-01, ACT-01, RUN-01. Cover stale proposals, duplicate execution, permission denial, provider/tool failures, and hidden side effects. A mock pass cannot satisfy the live-provider portion.

## P3 — Knowledge pipeline and document intake

Scope: add workspace-scoped KB storage/metadata/version/chunk/embedding state; implement supported text ingestion, review, indexing, retrieval, citations, and failure/retry behavior. Keep or refactor document-to-order extraction as a separate capability using the same useful intake infrastructure.

Start with a small set of fictional/licensed reference documents and an evaluation dataset. Add a job primitive, hybrid retrieval, or reranking only when measured needs require it. Do not expand to arbitrary document types.

Exit: KB-01, KB-02, DOC-01. Verify wrong-workspace queries, unpublished/archived content, missing knowledge, misleading embedded instructions, duplicate imports, and index failure.

## P4 — Traditional + AI Assist and guided Agent Workspace

Scope: add the goal-driven workspace with discoverable task cards, progressive guidance, real tool activity, evidence/proposal cards, and approvals. Integrate contextual AI Assist into selected conventional screens and preserve context when switching surfaces.

Reuse components and services; do not rebuild every portal twice. Include editing/clarification, loading, empty, error, cancellation, and failure recovery. Sensitive settings and technical observations stay outside public workspace navigation and API permissions.

Exit: UX-01, DEMO-01. Verify the main journey in a browser plus the insufficient-evidence and stale-action cases. Users must be able to finish manually when AI is unavailable.

## P5 — External MCP interoperability

Scope: adapt the same capabilities to a small remote MCP surface. Resolve credential-scoped actors without browser-cookie assumptions. Verify a real external client for tool discovery, read/search, and access denial.

Milestone M1 is authenticated read/search and proposal inspection. Milestone M2 is one safely confirmed external write through the existing proposal executor. Maintain M2 explicitly even if client/auth confirmation support delays it; do not describe M1 as complete read/write interoperability.

Choose a maintained transport/auth adapter, verify issuer/audience/expiry/revocation behavior, and state which client/account/configuration was tested. Do not implement every connector ecosystem or assume external attachments can be fetched automatically.

Exit: MCP-01 for M1; MCP-02 separately for M2. M2 can be blocked with evidence without preventing an honestly labeled website + read-only MCP demo. No unattended write tool is an acceptable substitute for confirmation.

## P6 — Public demo hardening, cleanup, handoff

Scope: complete Super Admin technical observation/usage views and global Guest AI allowance controls, scoped manual Demo reset, and the selected demonstration dataset. Retire anonymous Auth/CAPTCHA entry and per-IP/per-user product quotas after the replacement is verified. Remove replaced runtime/entry points/settings/docs rather than hiding old paths. Verify a clean setup and document Guest/Owner usage and real limitations.

Run broader regression where cross-cutting changes justify it, a real model/DB/browser demo, and focused adversarial or mutation checks for critical boundaries. Keep Human UAT separate. Publishing requires explicit deployment permission, even if development acceptance passes.

Exit: OBS-01, SAFE-01, CLEAN-01, and all required preceding acceptance evidence. Missing external MCP write capability is disclosed as M2 pending, not silently omitted.

## Stable acceptance criteria

| ID | Required observable evidence |
| --- | --- |
| AUTH-01 | Owner can authenticate/logout with a permanent password account without email invitation. Guest enters without a visitor Auth account and receives only a bounded, revocable Demo visit with server-granted business persona access. Forged names, cookies, persona/workspace IDs, or expired visits cannot grant Owner or Super Admin access. |
| ISO-01 | Demo cannot read/write Owner records, KB/chunks, threads, proposals, files, or caches through GUI, API, tools, RPC, or MCP. Cross-workspace foreign-key/identifier substitution is rejected. |
| ADMIN-01 | Platform settings, provider credentials/routing, technical observations, and reset are Super Admin-only; business actions remain workspace scoped. Secret values are not exposed in UI or logs. |
| DATA-01 | Fresh fictional seeds are reproducible without preserving old data. Reset affects Demo only, invalidates stale/in-flight work, and preserves Owner data and platform configuration. |
| CAP-01 | GUI, Assist, internal agent, and MCP adapters use common domain capabilities and cannot bypass role/lifecycle rules. |
| ACT-01 | Previewed canonical payload is the executed payload; explicit approval, permission/version/expiry/generation checks, atomic idempotency, and audit prevent unauthorized, stale, or duplicate writes. |
| RUN-01 | Real provider completes a bounded tool sequence with actual evidence. Step/time/usage limits and cancellation/failures are observable; no silent scripted success fallback. |
| KB-01 | A supported document progresses through review/indexing to retrieval; unsupported/failed/unapproved/archived content is not searchable. Failed replacement preserves the old active version; reset-era workers cannot publish afterward. Replacement does not mix versions/embedding spaces. |
| KB-02 | Citations resolve to the scoped source/version/section and support the answer. Missing knowledge produces uncertainty/clarification. Test Chinese/English queries and exact identifiers without claiming untested quality. |
| DOC-01 | Document-to-order and document-to-KB remain distinct. Extracted metadata/fields are reviewable; no order creation or KB publication is silently approved by the model. |
| UX-01 | Both modes are understandable, share business outcomes, preserve context through handoffs, and handle loading/error/cancel/empty states with a manual fallback. |
| DEMO-01 | Guest can switch business perspectives and perform permitted actions only in shared, resettable Demo. All Guest paid-model calls consume one atomic global daily AI allowance; Super Admin can view/change its bounded limit, and exhaustion leaves ordinary Demo use available with a clear reset time. Guest conversations/unpublished drafts are visit-scoped or unavailable. |
| MCP-01 | A real client discovers and uses scoped read/search tools; equivalent website/MCP reads share policy and data. Wrong-workspace and invalid/expired/revoked credentials fail; external actor/client use is attributable in audit and limits. Document exact host/auth limitations. |
| MCP-02 | A supported authenticated client confirms and executes one concrete write without weaker rules than the web. An arbitrary tool caller cannot self-assert human approval. |
| OBS-01 | Public activity reflects execution events; private technical observations and business audit have appropriate access, masking, correlation, and retention. |
| SAFE-01 | Focused adversarial/negative checks cover document injection, Guest visit/persona/workspace forgery, duplicate execution, global AI allowance bypass across paid entry points, stale work, and unsafe file access. |
| CLEAN-01 | Replaced features have no stale runtime callers, routes, settings, or misleading active docs; fresh setup and limitations are documented with truthful test evidence. |

## Evidence reporting

Record affected acceptance IDs, code/docs changed, commands and outcomes, live versus mock status, independent review availability/results, browser evidence, and unresolved environment dependencies in the phase handoff. Summarize the current truth in `PROJECT_STATE.md`; use focused evidence attachments/logs only when they add value, not another mandatory harness.

All implementation acceptance above is currently unverified. Historical assessment test counts or UAT results cannot satisfy it.
