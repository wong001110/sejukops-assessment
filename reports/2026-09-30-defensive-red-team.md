# Defensive verification capability checkpoint — 2026-09-30

## Scope and decision

The owner requested capability confirmation before red-team delegation and reusable procedures/cases. Main decision: **PROCEED** with demonstrated local defensive checks. DeepSeek independent review: **NOT_COMPLETED / PENDING_ENV**. No conclusion about model policy acceptance/refusal is available from the failed model invocation.

Code: website candidate on `codex/phase-1-auth-workspaces`, base `0d1c96fb9a4f1f8eda7c5dac4a56de6c6c9c78ad` plus the repair diff recorded in the owning PR. Live resource authorization is only Supabase Test `qobhjvrrpajoyvlgrkbx`; this capability check did not write to it. Memento is excluded.

## Main: demonstrated scope

- Actual local Vitest, fake-SDK tool loop, rendered AntD and isolated MSW browser checks are available and have executed. Latest targeted capability exercise passed **54/54** across six suites (actor policy, opaque Guest visits, persisted assignment proposals, global Guest allowance, Demo reset and workspace knowledge agent). It used no live database or paid model.
- These tests exercise anonymous Owner/foreign workspace rejection, malformed/expired/revoked/reset-era visits, verified approval identity and ID-only execution, quota fail-closed behavior, rejected reset results, invalid tool arguments, fabricated citations/excerpts and hostile source instructions. Fake-SDK hostile-source evidence proves server validators, not resistance of a real model to prompt injection.
- Final current-source citation mutation repeat: green **62-test baseline**, both selected guards **KILLED**, no survivor/invalid. Earlier ten distinct selected mutations remain ten, not twelve; a previous provider late-result survivor was repaired and its rerun recorded.
- The [website verification report](2026-09-30-website-verification.md) separately records Mock browser, exact-target real Test, configured real-model and human-reported login evidence. Those are not evidence of a new independent red-team exercise.
- A GPT 6.1 Sol sub-agent performed bounded read-only coverage review; Main checked the referenced tests and executed the focused suites. It did not run live attacks or grant itself additional authority.

## DeepSeek: actual Host probe

Desktop session: `session-b2cd3b19-d491-497e-831f-52ba1ebb4838`.

Title: **SejukOps 红队 — 审批与重复执行 — 2026-09-30**. Same-batch supplement reused this session for traceability.

The existing environment-side desktop bridge authenticated to the loopback Host in memory; no grant, token, password, bridge implementation or runtime was added to this repository. The source snapshot is isolated outside the repository, contains 64 public source/test/SQL files with a SHA256 manifest and no `.env`, Git metadata or customer data. The snapshot predates the latest queryIndex/MYT changes and is not a review of the final deployed candidate.

- Initial bounded source-review request was accepted by Host; the user observed `DeepSeek Messages request failed (400)`. No model response/tool activity or findings resulted.
- After the user's capability-first correction, one harmless probe asked which listed defensive tasks the model accepted and could perform. If accepted, it allowed **one read** of the snapshot's `src/lib/auth/actor-policy.ts`, checking the expected refusal of anonymous Owner membership with exact line evidence. It requested a short declaration of static/Mock/live limits and separated declarations from actual execution.
- Prohibitions remained: writes, secrets/configuration, DB, reset, deployment, network/browser/shell execution, subagents and extra model calls. No dynamic test authority was delegated. No wording was used to override the model's restrictions.
- Host returned `accepted:true`. Filtered session readback subsequently reported **two turns/two steps total, not running, empty second response, zero tool time, zero model time and zero token usage**. The probe has not demonstrated even the one-file read. Host health and request reception are confirmed; model acceptance and execution are unconfirmed. The second turn's exact failure cause was not independently retrieved.

Do not retry a complete review batch or change DeepSeek model/configuration automatically. A future probe must first establish a working model response in this same documented scope, then prove file access and evidence quality. A model's oral promise is not an execution pass.

## Reusable assets and next cases

- [Capability-first procedure and delegation template](../docs/RED_TEAM_TESTING.md).
- [Selected mutations and rationale](../scripts/fixtures/p6-mutations.json) and [actual results](2026-09-30-targeted-mutations.json).
- Existing suites listed above retain deterministic fictional negative cases; [Mock browser setup](../tests/ui-browser/README.md) retains frontend scenarios.

Useful later bounded cases: simultaneous requests for the last quota slot; concurrent confirmations of one persisted proposal; a real configured-model query over explicitly malicious fictional published knowledge. These lack actual concurrent/live-model evidence in this checkpoint. Serial replay, double-click controls, atomic SQL source inspection and fake-SDK tests are not substitutes. Record target, permitted effects, request counts, expected result and cleanup before execution. Main must reproduce and verify any external finding.
