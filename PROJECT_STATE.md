# Sejuk Ops — Project State

Updated: 2026-09-28

## Current status

- **Stage:** P1_IN_PROGRESS
- **Current authorization:** phased P1–P6 rebuild development requested by the owner on 2026-09-28; production deployment remains separate.
- **Rebuild implementation:** IN_PROGRESS on `codex/phase-1-auth-workspaces`; no phase is verified yet.
- **Baseline source:** `8fe1a52378f1aa2976cab4b6d6b4b9497ab983b3` on `main` before this documentation change.
- **Confirmed Supabase target:** project `qobhjvrrpajoyvlgrkbx` (dashboard name `Test`), confirmed by the owner for P1; read-only inspection found the Sejuk Ops schema, 5 branches, 44 orders, 6 profiles, and 0 Auth users.
- **Database mutations:** `p1_workspace_identity_foundation` (`20260928131107`), `p1_platform_config_actor` (`20260928133735`), and additive `p1_workspace_operational_core` (`20260928140159`) were applied to the confirmed `Test` project on 2026-09-28. No legacy data was deleted or reseeded, and no Auth user or workspace row was created. **Deployment:** PR #37 has Vercel Preview activity; production deployment was NOT_RUN. The new operational core has not been browser-verified.

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
| P1 — Auth, isolation, clean baseline | IN_PROGRESS / REPAIR | Actor resolution and platform Super Admin boundary implemented in source; three incremental migrations applied. Independent review found and prompted closure of a direct audit-log read leak. Auth provisioning, full business isolation, data baseline, and live end-to-end verification remain. |
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

Independent P1 source review (2026-09-28): **REPAIR**. The selectable demo identity cookie feeds service-role access; existing operational tables/RLS and service-role-only/security-definer RPCs lack workspace binding; operational insight cache and Storage paths are unscoped. The first migration adds platform role, workspaces, memberships, self-only profile read policy, and read-only member policies. Read-back confirmed the new profile column, two tables, three policies, removal of the old broad profile policy, and no client write grants on the new tables. It does not close the remaining business isolation blockers; no Auth users or workspace data were created.

P1 platform boundary repair (2026-09-28): AI provider configuration, unlock, and technical observation reads now require the server-resolved platform `SUPER_ADMIN`; workspace Admin/Manager roles no longer grant platform permissions. Unlock cookies are signed and bound to the verified Auth user/profile. The second migration changed `ai_assert_config_actor` to require an active Auth-linked Super Admin and removed the old authenticated audit-log read grant/policy after an independent review found 29 technical observation rows exposed by the old null-order rule. Live catalog read-back confirmed `authenticated` cannot SELECT `audit_logs` or execute the config actor function; a legacy Admin profile was rejected with `INVALID_PLATFORM_ACTOR`. These checks do not prove a complete authenticated browser journey or full workspace isolation.

Independent re-review found that provider-test traces still depended on a Demo cookie. Provider tests now persist with platform authority and the trace contract accepts `SUPER_ADMIN`; focused tests verify persistence without Demo authority and denial without a platform actor. This repair is local and has no live provider-test evidence yet.

P1 operational core (2026-09-28): an additive migration created workspace-scoped branches, technicians, customers, and orders with composite foreign keys, workspace-local branch/order identifiers, RLS, and authenticated read-only grants. Anonymous Auth users with a missing `is_anonymous` claim fail closed for Owner reads. Independent read-only review found no obvious SQL/RLS recursion or cross-workspace FK gap; its missing-claim and customer-index findings were repaired before application. Live read-back confirmed migration version `20260928140159`, four RLS-enabled tables, four SELECT policies, no anon SELECT grant, no authenticated INSERT grant, and composite FK definitions. There are no workspace rows, positive Auth read tests, or completed business-path isolation. Cross-branch technician assignment is currently allowed within one workspace pending explicit dispatch rules. Existing service-role assessment paths still bypass this new schema and keep P1 at **REPAIR**.

The first new business adapter now exposes `GET /api/workspaces/{workspaceId}/orders` through a verified Supabase actor and an explicit workspace-filtered, user-session client query. It grants Admin/Manager order reads and Technician assigned-job reads; the database policy also filters assignment. Independent review found that relying on RLS alone would let a future caller pass a service-role client and broaden Technician reads. The service now resolves the actor's active technician mapping and filters assigned orders itself; seven focused tests passed, including no mapping, cross-workspace substitution, Super Admin without membership, and a route denial before data-client creation. `pnpm typecheck`, `pnpm lint`, and `pnpm build` passed after the route was added; targeted typecheck and tests passed after the review repair. Lint retains the old unused-import warning. No real Auth user or workspace data exists yet, so positive live API/RLS and browser checks remain **NOT_RUN**. This adapter is not evidence that old business routes are isolated.

An Owner password sign-in/sign-out entry was added using the request-scoped Supabase Auth client. After password authentication, the server requires an active, permanent, platform `SUPER_ADMIN` actor and signs out any user who lacks it. It does not offer public self-registration or grant an Owner workspace membership. The owner supplied the intended account email and chose password login in the current conversation; no password was requested or stored, and no Auth account was created. Four focused action tests passed for invalid input, non-Super-Admin denial, authorized redirect, and sign-out. The new login and account pages built successfully, but live login/browser verification is **NOT_RUN** until owner identity provisioning and the old business-path isolation gate are ready.

Pre-migration security advisors still reported existing assessment-era callable `SECURITY DEFINER` helpers (`can_access_order`, `current_actor_*`) and 11 old RLS tables with no read policies. Their behavior and grants must be handled as old paths are replaced; the new tables did not remove them. [Supabase advisory remediation](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable).

Current local checks for this slice: `pnpm typecheck` PASS; `pnpm lint` PASS with one unused-import warning in `operational-insight.tsx`; `pnpm build` PASS; targeted platform/config runs of 77 tests and 17 security tests both PASS (with overlap), as do the final two provider-trace tests. The most recent full Vitest run, before those final two tests were added, had **7 failures / 418 passes** in assessment-era completion, manager review, technician navigation/receipt, and related static/contract tests. These failures remain unresolved and are not a P1 acceptance pass.

Next: provision the confirmed Owner identity and two initial workspaces through a reviewed, server-controlled path; implement bounded anonymous Demo identity/provisioning, continue actor-bound services over the new operational core, then workspace-safe RPC/Storage/cache paths. Replace mock-cookie/service-role authorization before exposing Owner data or public sign-in. Verify allowed and denied paths before marking P1 complete.
