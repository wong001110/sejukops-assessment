# Sejuk Ops — Product Direction

Status: accepted discussion direction, recorded 2026-09-28 and revised for Guest access on 2026-09-29. **P1 development is in progress; the revised Guest target is not implemented yet.** Current evidence lives in [PROJECT_STATE.md](../PROJECT_STATE.md).

## 1. Purpose

Turn Sejuk Ops from an assessment into a small, understandable field-service demo that demonstrates applied AI engineering through a coherent business task. Preserve useful operational logic instead of rebuilding a CRM or assembling unrelated AI features.

The core story is: understand a service request, consult operational records and applicable knowledge, surface evidence and missing information, prepare a concrete next action, obtain approval, and execute it safely.

The project should demonstrate product judgment as well as RAG, tool calling, bounded agent execution, human approval, and observability. A longer feature list is not a success criterion.

## 2. Three interaction surfaces, one system

### Traditional + AI Assist

Users navigate records, lists, and forms themselves. AI supports a specific contextual step, such as summarizing an order, finding related knowledge, or suggesting a technician. Suggestions are editable and do not secretly take over the whole workflow. Manual submission is an explicit action under the same backend policies.

### Agent Workspace

Users state an outcome and the agent coordinates permitted reads and proposal preparation. Reduce navigation and repeated form-filling; do not merely add a chat box to the old portal.

First-use guidance must show supported task cards, examples, what the agent may inspect, and which changes need approval. During execution, show actual tool activity, relevant evidence, missing information, and the next available action. Guidance should become less intrusive after onboarding and remain accessible later.

Use fixed, schema-driven components for records, evidence, proposals, and execution outcomes. No arbitrary generated React/code. Preserve task/order context when opening the traditional detail view or returning to the agent. The two modes share backend capabilities but need not duplicate every screen or follow identical interaction steps.

### External agents through MCP

Expose business capabilities so an authenticated external agent can read and eventually perform approved changes without using the website. The external client can orchestrate tools itself; it need not invoke another Sejuk agent for every query.

MCP is an adapter, not a second backend or a commitment to one vendor's connector product. The first interoperability milestone is read/search and proposal inspection; a bounded approved-write milestone follows when identity and confirmation can be established safely. ChatGPT Web is an intended example client, not a guaranteed capability for every plan/account. Verify the actual client during implementation.

## 3. Primary demo journeys

| Journey | Intended result |
| --- | --- |
| Investigate a service order | Combine scoped operational records and applicable KB excerpts; distinguish facts, recommendations, and unknowns; prepare one actionable proposal. |
| Execute an approved operational change | Show exact fields/record/technician/time, approval, backend revalidation, persisted outcome, and audit; expose the result in the traditional UI. |
| Import an operational document | Extract an editable order draft; ask only for missing/ambiguous required fields; create the order after explicit confirmation. |
| Prepare service knowledge | Parse a supported document, suggest metadata, review source/quality, and publish/index it into that workspace's KB. |
| Query operations without RAG | Use a structured read tool for current records or aggregates rather than retrieving static documents for live state. |
| Use an external agent | Read the same scoped records/knowledge; separately demonstrate approved writes when the integration has passed its gate. |

A service “case” can be represented by the existing order/request entity. A separate case-management subsystem is not required simply because the demo narrative uses the word case.

Do not promise skill-based dispatch, certified expertise, or guaranteed free time unless structured data and deterministic rules support those statements. A proposed visit time is not a reservation. Minimal scheduling support may be added if necessary for the selected demo; route optimization and a complete workforce-planning product are excluded.

## 4. Auth, Demo, Owner, and Super Admin

The Owner uses a permanent Supabase email/password login; account setup must not depend on sending an invitation email. The public entry is one-click **Continue as Guest**, without email, password, or a Supabase Auth account per visitor. A display name is optional and is never an identity, quota key, or authority. Guests may switch among Dispatcher/Admin, Manager, and Technician perspectives and carry out permitted actions against the same fictional Demo workspace. This is an operational Demo role selection, never a platform `SUPER_ADMIN` role.

Do not distribute a shared Demo password or unrestricted Supabase session to browsers. The server must validate a bounded Guest session, selected role, workspace, and current permissions for every action. Shared Demo business records are expected; private conversations and unpublished drafts must remain session-scoped or be unavailable to Guest. Audit may identify the action as Guest with a session correlation identifier; it must not claim to know the visitor's real identity or trust a typed name.

Model platform `SUPER_ADMIN` / ordinary user status separately from workspace `ADMIN`, `MANAGER`, and `TECHNICIAN` memberships.

Create only two initial workspaces:

- **Demo:** shared, fictional, resettable data. Demo Admin remains an operational role, not platform administration.
- **Owner:** private data, KB, agent conversations, and experiments.

Super Admin can manage both workspaces, inspect technical observations, configure global AI providers/routing and sensitive settings, and control demo reset. Normal business actions still select an explicit workspace and obey that operation's rules. The platform role must not silently remove every workspace filter.

No self-service workspace creation, invitations, billing, or per-visitor isolated databases are required. Shared Demo does not imply sharing private conversation transcripts or unrestricted file access between visitors. Normal Demo operations have no product-level count quota; role checks, payload/file bounds, approval, and reset-generation checks still apply.

All Guest use one persistent **global daily AI allowance**, adjustable and visible to Super Admin. Every paid model entry point must reserve from it before a provider call; ordinary browsing and non-AI business writes do not consume it. When exhausted, AI actions explain when the allowance resets while non-AI Demo use remains available. Use a stated Malaysia-time reset boundary and a conservative hard ceiling; a low expected visitor count is not itself a cost control.

## 5. Two distinct document flows

The existing document-to-order extraction is valuable and may be retained/refactored. It does not become RAG simply by exposing an agent tool.

| Flow | Output | Publication boundary |
| --- | --- | --- |
| Operational intake | Validated, editable order draft | Human confirms the concrete order fields before creation. |
| Knowledge intake | Parsed source, metadata, chunks, embeddings, citations | Human reviews publication; only approved and successfully indexed active content is retrievable. |

Keep traditional upload/review available. In Agent Workspace, the agent prepares the same underlying draft instead of forcing users to repeat all form steps.

Start new KB ingestion with Markdown and text-native PDF. Existing image-based order extraction may remain if verified, but is not a promise of scanned-PDF knowledge ingestion. OCR, complex visual manuals, automatic document discovery, bulk version replacement, and semantic conflict resolution are not initial requirements.

Unknown metadata stays unknown. Filename similarity is not proof that a document supersedes another. Prefer exact-hash duplicate detection first; ambiguous replacement needs explicit review.

## 6. Scope and reuse

Retain operational records, useful lifecycle rules, deterministic calculations, role restrictions, transaction/idempotency behavior, evidence handling, and manual fallback where they support the demonstration. Evaluate source and tests before assuming complete reuse.

Replacement of the one-shot AI planner is expected. Move sensitive AI configuration/technical observation access to the platform boundary. Obsolete navigation, runtime calls, configuration, tests, and docs must be removed or deliberately re-scoped when their replacement is implemented.

Legacy feature parity is not required. Payment extensions, WhatsApp integrations, expansive KPI work, inventory, and assessment-specific administration are not reasons to expand this MVP. Retain a feature only when it supports a selected journey or costs less to keep safely than to remove. Do not rewrite unrelated working code for stylistic uniformity.

## 7. Data replacement decision

The owner permits abandoning existing Sejuk Ops application data and reseeding a clean target dataset. Do not build a historical-data migration, dual-write period, or old-schema compatibility layer solely to preserve this assessment.

The subsequent development authorization permits scoped implementation. The P1 Supabase target is confirmed in [PROJECT_STATE.md](../PROJECT_STATE.md); destructive changes still require an exact-effect review and a reproducible clean-baseline process. Existing SQL migration history must not be deceptively presented as newly applied or safely replayable against an unidentified database.

Seed useful fictional examples for normal handling, missing knowledge, stale proposals, access denial, and demo reset. Owner and Demo records must not accidentally share foreign keys or storage objects. Never copy real credentials or customer information into demo fixtures.

## 8. Non-goals

No multi-agent product runtime, long-term agent memory, generic workflow builder, autonomous company management, general database access, unrestricted network tools, generated executable UI, full scheduling optimizer, per-workspace BYOK/billing, or full SaaS tenancy management.

LangGraph/durable orchestration, hybrid retrieval, reranking, and a separate ingestion worker are conditional extensions only when a measured need justifies them. MCP write support remains a defined extension, not something to claim from a successful read-only connection.

## 9. Product acceptance

A useful demo must show a successful evidence-to-action path, an insufficient-evidence path, and a stale/unauthorized-action rejection. It must also demonstrate that Demo cannot access Owner data or sensitive platform controls.

The website remains usable without successful AI calls. Live execution must not silently switch to scripted success. Any replay/demo fixture mode is visibly labeled. User-facing activity comes from actual execution events, not invented reasoning steps or raw private chain-of-thought.

The detailed acceptance IDs and phase gates are in [the implementation plan](IMPLEMENTATION_PLAN.md).
