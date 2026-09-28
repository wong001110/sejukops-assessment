# Sejuk Ops — Project State

Updated: 2026-09-28

## Current status

- **Stage:** P1_IN_PROGRESS
- **Current authorization:** phased P1–P6 rebuild development requested by the owner on 2026-09-28; production deployment remains separate.
- **Rebuild implementation:** IN_PROGRESS on `codex/phase-1-auth-workspaces`; no phase is verified yet.
- **Baseline source:** `8fe1a52378f1aa2976cab4b6d6b4b9497ab983b3` on `main` before this documentation change.
- **Confirmed Supabase target:** project `qobhjvrrpajoyvlgrkbx` (dashboard name `Test`), confirmed by the owner for P1; read-only inspection found the Sejuk Ops schema, 5 branches, 44 orders, 6 profiles, and 0 Auth users.
- **Database mutations:** the additive `p1_workspace_identity_foundation` migration was applied to the confirmed `Test` project on 2026-09-28; the Supabase ledger recorded version `20260928131107`. No legacy data was deleted or reseeded. **Application deployment:** NOT_RUN.

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
| P1 — Auth, isolation, clean baseline | IN_PROGRESS / REPAIR | Actor permission boundary and additive identity/workspace migration drafted. Independent source review found live isolation blockers; Auth, full schema isolation, data baseline, and live verification remain. |
| P2 — Shared capabilities and agent/proposal slice | NOT_STARTED | Depends on P1 boundaries. |
| P3 — Knowledge and document intake | NOT_STARTED | Depends on scoped storage and actor context. |
| P4 — Dual workspace UX | NOT_STARTED | Depends on usable capabilities and knowledge evidence. |
| P5 — MCP interoperability | NOT_STARTED | Auth/client/write gates must be verified separately. |
| P6 — Demo hardening and handoff | NOT_STARTED | Requires actual integrated verification. |

## Open implementation checks, not new product approvals

Verify actual deployment/database target before any reset; current dependency compatibility; chat and embedding providers; ingestion job needs; minimal scheduling data/rules; and the chosen external client's authentication, confirmation, and file-transfer support. None is assumed proven by the discussion.

The read/proposal MCP milestone must not be presented as successful external writes. A client-specific limitation must not be hidden by dropping the intended approved-write extension.

## Verification and next action

P1 actor policy and verified-user/profile/membership resolver: 7 focused Vitest cases passed; the server adapter is written but not yet wired to application entry points. A pre-existing `ANSWER` fixture was given its required `presentation: null`; `pnpm typecheck`, targeted ESLint, and 17 focused tests (including that eval harness) now pass. These are local code checks, not live Auth or data isolation proof. Live Auth, database isolation, browser E2E, MCP, and Human UAT remain **NOT_RUN**. Existing assessment results do not change those statuses.

Independent P1 source review (2026-09-28): **REPAIR**. The selectable demo identity cookie feeds service-role access; existing operational tables/RLS and service-role-only/security-definer RPCs lack workspace binding; AI config/observability use workspace roles; operational insight cache and Storage paths are unscoped. The applied migration only adds platform role, workspaces, memberships, self-only profile read policy, and read-only member policies. Read-back confirmed the new profile column, two tables, three policies, removal of the old broad profile policy, and no client write grants on the new tables. It does not close the remaining blockers; no Auth users or workspace data were created.

Next: implement real Auth identity/provisioning and workspace-safe operational schema/RPC/Storage/cache paths as one gated rollout. Replace mock-cookie/service-role authorization before exposing Owner data or public sign-in. Verify allowed and denied paths before marking P1 complete.
