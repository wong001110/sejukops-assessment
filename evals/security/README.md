# Targeted security and failure-flow evaluation

This batch exercises current application boundaries. It is separate from the sealed 7 October Codex Security scan and does not represent a new exhaustive scan, penetration-test certification or Human UAT.

## Current input-boundary repair

SEC-INPUT-01 is **fixed in the local candidate**: Operations authorizes scope before reading JSON, caps actual input at 4 KiB, starts its 30-second signal before params/auth/body, and cancels pending reads on disconnect/deadline. Overflow returns 413; authorized malformed input remains 400, unauthorized input returns 403 without body consumption, and abort remains a controlled 503. The original 120-unit question/schema, scope freshness, Guest reservations and safe runtime responses remain. The shared reader's signal argument is optional; Knowledge keeps its 1 MiB contract. Strict invalid-UTF8 rejection and rejection of excessive padding are intentional; valid Unicode and fully escaped questions are accepted.

Verification: **161 related assertions PASS** (including 27 input acceptance/control, 17 shared-reader, 39 Operations route, 49 runtime, 23 UI component and six Knowledge route); **3/3 new guard mutations KILLED**, zero survivors/invalid; **one selected actual-browser Mock 413 case PASS**; TypeScript, scoped ESLint and independent read-only investigation/candidate review completed. No new live provider/database/deployment, broad regression or full build was needed for this focused server input repair. Main decision **PROCEED for this local finding**, with unrelated live Staff/concurrency/Human UAT gaps unchanged. Raw fix evidence is retained in the standalone Codex Security target collection; current acceptance is in `PROJECT_STATE.md` and the owning PR.

## Recorded pre-fix candidate (historical)

- Product source: `1e230427f82d224ed4e75391cf99da75711515ea` (PR #41).
- [English report](results/2026-10-09/index.html) and [machine-readable evidence](results/2026-10-09/result.json).
- Decision at that snapshot: **REPAIR** for the Operations Ask AI input boundary. The four then-passing observations preserved the defect. Those tests are now replaced by acceptance/control cases; the report and raw-byte hashes still describe the pre-fix snapshot at test commit `1d678c4`, not the current working tree.
- 898 contract/regression assertions passed: 810 selected existing assertions, 59 new Auth/policy/service assertions and 29 new proposal assertions. Four additional input observations ran successfully and exposed the repair condition.
- Seven selected guard mutations were killed. Thirteen Mock browser exception cases and 33 real Guest check records passed. These counts describe different evidence layers and must not be combined into a security coverage percentage.

## Repeatable offline tests

```powershell
pnpm.cmd exec vitest run tests/security-adversarial --maxWorkers=1
pnpm.cmd exec tsc --noEmit
pnpm.cmd exec eslint tests/security-adversarial scripts/tests/security-ui-adversarial.mjs scripts/tests/security-guest-live.mjs
```

The tests load actual handlers, actor resolution, policies and domain adapters. Auth, database and provider transports are mocked. All fixtures are fictional; no credential input is required. The input tests deliver bounded 256 KiB streams with absent/dishonest Content-Length and assert unauthorized zero consumption, authorized early overflow/cancellation and unchanged Native controls. Actual abort-wrapper/reader cases cover stalled params, scope and body reads. They do not run stress traffic.

Targeted mutation runner: virtual source changes only, with an initial passing baseline and relevant failed assertions required for a kill. The report must be inside the OS temporary directory.

```powershell
$taskReportRoot = Join-Path $env:TEMP 'sejuk-security-mutations'
New-Item -ItemType Directory -Force -Path $taskReportRoot | Out-Null
node scripts/p6-targeted-mutations.mjs --manifest tests/security-adversarial/auth-mutations.json --report (Join-Path $taskReportRoot 'auth.json')
node scripts/p6-targeted-mutations.mjs --manifest tests/security-adversarial/proposal-mutations.json --report (Join-Path $taskReportRoot 'proposal.json')
node scripts/p6-targeted-mutations.mjs --manifest tests/security-adversarial/operations-input-mutations.json --report (Join-Path $taskReportRoot 'operations-input.json')
```

## Actual browser checks

`scripts/tests/security-ui-adversarial.mjs` uses the actual React frontend and local synthetic MSW/fetch responses. Start `node tests/ui-browser/start.mjs` separately at `http://localhost:3200`, then run the script. It denies external HTTP traffic and closes its own browser. It covers 403/429/503, network failure, cancellation/context changes, malformed/truncated output, invalid citations, inert hostile text and quota feedback. It does **not** measure a real model's prompt-injection resistance.

The new 413 response case can be selected alone with `SECURITY_EVAL_CASE='Operations HTTP 413'`; `SECURITY_EVAL_OUTPUT` sets the generated output directory. An unmatched filter fails instead of reporting zero executed cases as a pass. The repair run selected only this new case; it did not repeat the entire pre-fix browser batch.

`scripts/tests/security-guest-live.mjs --allow-live` is an explicit opt-in to the confirmed Supabase Test `qobhjvrrpajoyvlgrkbx` only. Start the normal application at `http://127.0.0.1:3100`; the ignored `.env` supplies its existing configuration. The script validates that exact public Supabase URL before entry. It opens a normal Guest visit, reads role-scoped Demo orders, checks denied Owner/private/configuration paths, compares the Demo order snapshots, exits and verifies a fresh request is denied. No paid AI or intended business mutation is performed. If a regression allows a forbidden request, its fixture uses nonexistent synthetic IDs; stop and inspect the evidence. Normal Guest entry/persona/exit updates Guest session records. The script does not create Staff accounts, reset data or adjust configuration.

These two browser scripts currently reference this machine's installed Playwright module and Chromium paths. Adapt those two paths on another machine; do not assume portability or download browsers as part of the test. Raw outputs go to ignored `evals/security/.local/`; never commit cookies, credentials, environment files or raw business records.

## Boundaries and failures retained

- Formal Staff disable/reset/role changes with retained signed JWTs and real simultaneous proposal execution were **not run**: no usable Staff credential fixture was present. Unit transport contracts and SQL lock metadata do not replace those checks.
- Live catalog evidence covers 11 selected tables and seven routines. It proves metadata at inspection time, not all RLS row visibility. Two bounded rollback procedure calls rejected database roles/synthetic claims with SQLSTATE `42501`; these were not signed Auth JWTs.
- The first read-only procedure probe returned `25006` because row locking was disallowed. That attempt is inconclusive; it was not counted as a permission pass.
- The first Guest entry timed out during cold compilation after entry was sent. Its browser closed, but visit revocation was not verified. The successful retry exited and verified denial. The harness now marks entry before navigation and treats cleanup failure as FAIL. No guessed visit row was deleted.
- Live provider injection, large-file upload/Excel abuse, deployed rate/load limits, dependency CVE scanning, production, external MCP and Human UAT are outside this batch.
- TypeScript and scoped ESLint passed. No full application build was required for tests/evidence only; executable product files are unchanged.

## Original repair follow-up (closed by the current candidate)

At the original snapshot, Operations `POST /api/workspaces/[workspaceId]/operations/ask` fully read JSON before actor authorization and created its deadline afterwards. A 120-character field limit did not bound JSON whitespace or total bytes. The current candidate applies the existing bounded streaming reader, before-body authorization and parsing deadline, with overflow/cancellation and valid Unicode acceptance tests. The original trigger no longer reproduces locally; deployed service exhaustion was not tested.
