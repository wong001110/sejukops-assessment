# Approval and Guest allowance concurrency — 2026-09-30

## Scope and Main decision

Owner authorized this first bounded batch with “来试试看吧”. **PROCEED** for the three tested RPC concurrency invariants. This is not a complete security assessment, HTTP authentication/E2E, load test, Human UAT or real-provider dispatch proof. No production application code changed. The completed website Goal remains completed.

Application version: `d059441e274c572791f957533b6b24fe158e98b3`, plus the new route contract case and verification runners in this slice. Only Supabase Test `qobhjvrrpajoyvlgrkbx` was accessed; memento was excluded. [Sanitized actual results and runner hashes](2026-09-30-concurrency-red-team.json).

## Mock first, then real Test

| Case | Actual evidence | Result |
| --- | --- | --- |
| RT00 — concurrent web confirmation contract | Actual GET/POST handlers and actual approval/execution service adapters; only Auth/query/RPC transports mocked. Both requests read the same PENDING snapshot. Mock DB single winner is an explicit premise. | 200 + 409; only winner reaches execute; canonical proposal ID and verified Auth identity passed. This does not prove DB locks. |
| RT01 — real parallel approval | Two independent PostgreSQL transactions using service_role approval RPC and an existing verified Owner Auth ID. Coordinator holds the actual proposal row lock until both workers' blocking chains are observed reaching it. | One APPROVED, one P0001. Exactly one APPROVED audit. |
| RT02 — real parallel execution/replay | Two independent authenticated-role transactions execute that approved proposal; both actual blocking chains observed before release. SQL claims simulate trusted server actor identity. | Both return the same EXECUTED proposal and durable order timestamp. One each PROPOSED/APPROVED/EXECUTED audit; assigned technician/current order match. Serial replay returns the same row. Manual audit is zero because this path uses proposal audit. |
| RT03 — real last allowance unit | Two different fictional current-generation Guest visits. Under global advisory lock, temporarily set limit from 20 to 3 while original usage is 2. Observe both workers waiting, release, execute actual reserve RPCs. | One allowed, one denied; both report used 3, remaining 0. No provider dispatch or billable call. |

The coordinator uses PostgreSQL row/advisory transaction locks; recursive `pg_blocking_pids` evidence includes a waiter behind another worker. See [PostgreSQL locking documentation](https://www.postgresql.org/docs/17/explicit-locking.html). Two workers per case, five-second observation window, eight-second connect/lock and twelve-second statement limits. This is controlled overlap, not random load or a statistical reliability claim.

Main ran **21/21** proposal/global-budget contract tests and **30/30** actual Orders/Knowledge/Intake route tests. Scoped ESLint, Node/Python syntax and diff checks passed. A GPT 6.1 Sol independent read-only review identified three harness risks: indirect lock chains, quota commit/rollback markers and midnight cleanup. Main repaired them before the successful run. The first run had already stopped with `RT01_OVERLAP_NOT_PROVEN`; it was a harness observation failure, not a product defect, and exact cleanup/digest comparison passed. Successful run: `6a9367aa-ea3d-4b42-b23c-b53c5c6d37b8`, approximately 18:38–18:39 MYT.

No full regression/build was repeated for this verification-only slice. A selected mutation command rejected a report path outside its required OS temp directory before mutation execution; no new mutation result is claimed. The planned repeat was not run after the user's local-model handoff directed later red-team work to another chat. Earlier ten distinct mutation results remain historical evidence, not additional kills in this batch.

## Cleanup and limits

Fixtures: one authless fictional Technician profile/membership/catalog row, one fictional customer/order/proposal and two fictional visits. No Auth user creation, Owner password change, email, reset, schema mutation or model call. Manifest IDs were saved before fixture commits in ignored `supabase/.temp`.

Exact IDs removed fixture proposal/audit/order/audits/customer/technician/membership/profile/visits. Under the same global lock, quota restoration checks original policy and expected counter; it refuses to overwrite unrelated concurrent changes. Policy restored to **20**, actual MYT counter restored to **2**. Server-computed aggregates of every public/private application table (quota compared separately) and Auth IDs matched before/after. Independent Supabase connector readback found **4 Auth users, 4 profiles, 4 orders, 5 historical visits, zero orders from either test run**. Existing Owner, Demo, provider/configuration and historical evidence remained unchanged.

SQL actor claims are deliberate test inputs, not JWT login evidence. No new concurrent HTTP/browser run occurred. RT02 proof combines current SQL control flow, one execution audit, equal durable result timestamps and order readback; no temporary write-counting trigger was installed. The runner declines starting a quota test within two minutes of MYT midnight; cross-midnight behavior is not exercised. Different proposals competing for one order, role changes/reset racing with execution, provider retries and real-model malicious knowledge are outside this batch.

## DeepSeek desktop independent static review

Chat: **SejukOps 防御验证 — 审批与额度并发 — 2026-09-30**.
Session: `session-8ca94509-2ae3-48a7-9041-5a0fae796062`.

Host accepted create/rename/prompt; model explicitly accepted static review and returned a completed visible response. Snapshot contained exactly seven already-pushed public source/migration files at d059441 plus SHA256 manifest, with no environment, credentials or customer data. The first proposed transfer including the full baseline was automatically rejected; Main verified the repository was public, removed the baseline, checked the seven public files and the reduced transfer was approved. No workaround bypassed that rejection.

Main inspected the actual event log selectively: **13 tool calls, 12 successful and one failed read of nonexistent SOURCE_MANIFEST.md**, final visible response at seq 72. Calls were read/glob/grep only; no shell/network/DB/write tool appeared. Original budget was 12 calls, so the review exceeded it by one. Its self-reported count of 10 is inaccurate. This is an explicit delegate budget defect, not an independently executed exploit or a security PASS.

| Returned finding | Main verification/disposition |
| --- | --- |
| Second concurrent PENDING confirmation returns generic 409 instead of executing again. | RT00 reproduces that contract, RT01/RT02 validate one canonical execution. Losing duplicate is expected rejection; absence of a second mutation/audit is correct. No lost winning action was demonstrated. Message/reload clarity is a possible UX follow-up. |
| Assignment helper absent; possible CAS/lock-order problem. | Missing from the seven-file snapshot, not absent from the repository. Main found `private.workspace_order_assign` in migration `20260928143945_p1_workspace_order_commands.sql:91` and fetched the current Test definition. UPDATE checks exact expected_updated_at and allowed status; execute also checks target state. Missing helper context is not a product defect. Proposed cross-proposal/member-management deadlock remains unverified; no concrete lock cycle was supplied. |
| Allowance reserve has no callers; possible dispatch overspend. | Snapshot omitted caller routes. Current Orders line 71, Knowledge line 73 and Intake line 141 reserve in beforeProviderCall and reject null/denied before dispatch; their 30 route tests passed. RT03 demonstrates one last RPC unit. Holding a DB lock throughout a paid HTTP request is not required to prevent this counter overspend. Failed/uncertain paid attempts are deliberately charged by architecture, not refunded. Real provider concurrency was not tested. |

Snapshot also omitted later helper revisions and tests. DeepSeek's statements about the “whole repository” and “no tests” cannot be adopted. Its static observations of proposal row locking, idempotent executed return and quota day derivation after locking do match inspected code. No returned item is accepted as a reproduced exploitable defect.

Main attempted a same-chat, zero-tool correction supplement; automatic approval rejected sending internal Test results/security findings to external DeepSeek. **The supplement was not sent.** No retry, indirect transfer or configuration change followed. Main's dispositions above were not acknowledged by DeepSeek. Missing external recheck remains recorded; independent Main reproduction is the acceptance basis.

## Later local-model handoff

The owner supplied a separate-chat handoff for three Ollama models. This chat did **not** read installed.json/API state, download, load, call or benchmark them. Model availability/digests and process settings are therefore owner-reported here, not independently verified. Downloads/metadata do not establish red-team acceptance.

Exact requested identifiers:

- `hf.co/bartowski/WhiteRabbitNeo_WhiteRabbitNeo-V3-7B-GGUF:Q4_K_M`
- `hf.co/fdtn-ai/Foundation-Sec-1.1-8B-Instruct-Q4_K_M-GGUF:Q4_K_M`
- `hf.co/fdtn-ai/Foundation-Sec-8B-Reasoning-Q4_K_M-GGUF:Q4_K_M`

At that handoff checkpoint the owner designated another chat. The owner subsequently paused DeepSeek and authorized a small local trial in this chat; [its later actual results](2026-09-30-local-model-calibration.md) supersede the pending-model statement for that precise calibration scope. Download metadata remains separate from inference/reproduction evidence. No real DB, paid cloud, deployment/reset, provider changes or forwarding reviewed content to DeepSeek was included in the local trial.
