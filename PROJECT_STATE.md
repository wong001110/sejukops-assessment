# Sejuk Ops — Project State

This is the **only live execution-state ledger** for the agent-native rebuild. Requirements live in the system specification and phase plan; historical assessment evidence is not rebuild evidence.

## Current checkpoint

| Field | State |
| --- | --- |
| Direction recorded | 2026-09-28 |
| Assignment | Update direction, architecture, and development plan; open a new documentation PR |
| Authorization | `DOCUMENTATION_ONLY` |
| Rebuild implementation | `NOT_STARTED` |
| Working branch | `docs/agent-native-direction-20260928` |
| Baseline main commit | `8fe1a52378f1aa2976cab4b6d6b4b9497ab983b3` |
| Integration | Documentation branch; not merged |
| Database/data actions | `NOT_RUN` — no reset, migration, seed, or auth provisioning |
| Deployment actions | `NOT_RUN` |
| Next action | Review the direction PR; wait for explicit implementation authorization |

The owner clarified twice that updating the repo means **updating direction, not starting development**. This checkpoint overrides older assessment execution instructions. Documentation acceptance/merge alone does not start P1.

## Agreed scope

Shared operational capabilities for Traditional + AI Assist, a goal-driven Agent Workspace, and staged external MCP access. Real Auth; shared Demo and private Owner workspaces; platform Super Admin; RAG/knowledge intake; persisted proposals; private technical observability; evidence-based demo/evaluation.

Old Sejuk Ops application data can be discarded and reseeded during authorized implementation. Obsolete functionality can be removed with its replaced entry points and docs. Do not require a legacy-data backfill or keep dead runtime paths solely for assessment compatibility. Do not reset anything in this documentation task.

## Phase status

| Phase | Scope | Status |
| --- | --- | --- |
| P0 | Direction, boundaries, methodology, and plan | Documentation prepared for review; no implementation acceptance implied |
| P1 | Auth, actor context, workspace isolation, fresh schema/fixtures, platform boundary | `NOT_STARTED` |
| P2 | Shared capabilities, real-model spike, bounded agent, persisted proposals | `NOT_STARTED` |
| P3 | Knowledge intake, retrieval, citations, and existing order-import adaptation | `NOT_STARTED` |
| P4 | Dual interaction surfaces and guided demo UX | `NOT_STARTED` |
| P5 | Authenticated MCP read/search interoperability | `NOT_STARTED` |
| P6 | Isolation/abuse checks, observation/evaluation, cleanup, demo acceptance | `NOT_STARTED` |

Scope and acceptance IDs: [rebuild plan](docs/plans/agent-native-rebuild.md). Phases may be adjusted after implementation is authorized, with requirement mapping preserved here.

## Verification and unknowns

Documentation checks: **PASS** for 10 Markdown files, 38 local document links, balanced fences/formatting, and 20 scope-presence checks. Scope-presence checks are not behavioral tests or independent review. Remote PR diff scope must also be checked before handoff.

Application build, unit/integration tests, live model execution, live Supabase checks, MCP client tests, browser E2E, and human UAT for the rebuild are all **`NOT_RUN`**. This documentation PR does not claim they pass.

Future prerequisites: verify the intended Supabase/Vercel resources without inferring from similar names; inspect dependency compatibility; choose actual chat/embedding models; test tenant-aware RPC/Storage boundaries; select and test one MCP host/auth flow. Current credentials, deployment health, client-plan permissions, and model behavior are not established by this checkpoint.

## Future checkpoint format

Record phase/acceptance IDs, current commit, implementation status, checks actually run and results, independent-review status, environment blockers, residual risk, and next permitted action. Evidence may link to PRs or focused logs; keep phase/task status here rather than reviving the historical checklist.
