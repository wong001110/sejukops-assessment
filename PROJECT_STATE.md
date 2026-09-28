# Sejuk Ops — Project State

Updated: 2026-09-28

## Current status

- **Stage:** DIRECTION_DOCUMENTED
- **Current authorization:** consolidate direction PRs #35 and #36 and squash merge the resulting documentation PR; no rebuild implementation.
- **Rebuild implementation:** NOT_STARTED; not authorized by the current request.
- **Baseline source:** `8fe1a52378f1aa2976cab4b6d6b4b9497ab983b3` on `main` before this documentation change.
- **Runtime, dependencies, migrations, seeds, and infrastructure:** unchanged by this direction update.
- **Merge/deployment:** direction-documentation merge authorized on 2026-09-28; deployment not authorized.

This file is the single mutable progress authority for the rebuild. The implementation plan defines acceptance, not a second set of completion statuses. Assessment-era checklist, release, and UAT results are historical evidence only.

Direction PR #35 is the consolidated integration path. PR #36's distinct guidance on historical checklist handling, knowledge publication/indexing states, failed replacements, and external-client acceptance is reflected in the active documents. Its alternate phase IDs are not a second acceptance ledger.

## Decisions carried forward

The target is a small agent-native field-service product, not another assessment or a general CRM. It retains useful operational behavior and introduces Traditional + AI Assist, a guided Agent Workspace, and an MCP surface over common capabilities.

The foundation includes real Supabase Auth, shared Demo and private Owner workspaces, separate platform/workspace roles, and Super Admin-only sensitive settings and technical AI observations. RAG knowledge intake remains distinct from the existing document-to-order extraction flow.

Old Sejuk Ops application data may be discarded and unnecessary features replaced during later authorized implementation. No legacy data migration/backward-compatibility requirement is imposed. No deletion, reseed, or database mutation has happened in this documentation task.

## Phase state

| Phase | State | Evidence / condition |
| --- | --- | --- |
| P0 — Direction and handoff | DOCUMENTED | PRs #35 and #36 consolidated into one direction; documentation merge authorized, P1 remains separate. |
| P1 — Auth, isolation, clean baseline | NOT_STARTED | Requires a later implementation instruction. |
| P2 — Shared capabilities and agent/proposal slice | NOT_STARTED | Depends on P1 boundaries. |
| P3 — Knowledge and document intake | NOT_STARTED | Depends on scoped storage and actor context. |
| P4 — Dual workspace UX | NOT_STARTED | Depends on usable capabilities and knowledge evidence. |
| P5 — MCP interoperability | NOT_STARTED | Auth/client/write gates must be verified separately. |
| P6 — Demo hardening and handoff | NOT_STARTED | Requires actual integrated verification. |

## Open implementation checks, not new product approvals

Verify actual deployment/database target before any reset; current dependency compatibility; chat and embedding providers; ingestion job needs; minimal scheduling data/rules; and the chosen external client's authentication, confirmation, and file-transfer support. None is assumed proven by the discussion.

The read/proposal MCP milestone must not be presented as successful external writes. A client-specific limitation must not be hidden by dropping the intended approved-write extension.

## Verification and next action

This change records requirements and development rules. Rebuild unit/integration tests, live model calls, browser E2E, database isolation tests, MCP tests, and Human UAT are **NOT_RUN**. Existing assessment results do not change those statuses.

Next permitted action after the direction merge: await an explicit implementation request. Do not start P1 automatically. When authorized, reconcile the actual branch and environment, select a bounded first phase, and record evidence and any plan adjustment here.
