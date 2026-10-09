# Targeted security and failure-flow evaluation

This batch exercises current application boundaries. It is separate from the sealed 7 October Codex Security scan and does not represent a new exhaustive scan, penetration-test certification or Human UAT.

## Recorded candidate

- Product source: `1e230427f82d224ed4e75391cf99da75711515ea` (PR #41).
- [English report](results/2026-10-09/index.html) and [machine-readable evidence](results/2026-10-09/result.json).
- Decision: **REPAIR** for the Operations Ask AI input boundary. Passing observation assertions deliberately preserve the defect; they are not acceptance tests.
- 898 contract/regression assertions passed: 810 selected existing assertions, 59 new Auth/policy/service assertions and 29 new proposal assertions. Four additional input observations ran successfully and exposed the repair condition.
- Seven selected guard mutations were killed. Thirteen Mock browser exception cases and 33 real Guest check records passed. These counts describe different evidence layers and must not be combined into a security coverage percentage.

## Repeatable offline tests

```powershell
pnpm.cmd exec vitest run tests/security-adversarial --maxWorkers=1
pnpm.cmd exec tsc --noEmit
pnpm.cmd exec eslint tests/security-adversarial scripts/tests/security-ui-adversarial.mjs scripts/tests/security-guest-live.mjs
```

The tests load actual handlers, actor resolution, policies and domain adapters. Auth, database and provider transports are mocked. All fixtures are fictional; no credential input is required. The input tests deliver a bounded 256 KiB stream with no Content-Length and record actual reader consumption/cancellation. They do not run stress traffic.

Targeted mutation runner: virtual source changes only, with an initial passing baseline and relevant failed assertions required for a kill. The report must be inside the OS temporary directory.

```powershell
$taskReportRoot = Join-Path $env:TEMP 'sejuk-security-mutations'
New-Item -ItemType Directory -Force -Path $taskReportRoot | Out-Null
node scripts/p6-targeted-mutations.mjs --manifest tests/security-adversarial/auth-mutations.json --report (Join-Path $taskReportRoot 'auth.json')
node scripts/p6-targeted-mutations.mjs --manifest tests/security-adversarial/proposal-mutations.json --report (Join-Path $taskReportRoot 'proposal.json')
```

## Actual browser checks

`scripts/tests/security-ui-adversarial.mjs` uses the actual React frontend and local synthetic MSW/fetch responses. Start `node tests/ui-browser/start.mjs` separately at `http://localhost:3200`, then run the script. It denies external HTTP traffic and closes its own browser. It covers 403/429/503, network failure, cancellation/context changes, malformed/truncated output, invalid citations, inert hostile text and quota feedback. It does **not** measure a real model's prompt-injection resistance.

`scripts/tests/security-guest-live.mjs --allow-live` is an explicit opt-in to the confirmed Supabase Test `qobhjvrrpajoyvlgrkbx` only. Start the normal application at `http://127.0.0.1:3100`; the ignored `.env` supplies its existing configuration. The script validates that exact public Supabase URL before entry. It opens a normal Guest visit, reads role-scoped Demo orders, checks denied Owner/private/configuration paths, compares the Demo order snapshots, exits and verifies a fresh request is denied. No paid AI or intended business mutation is performed. If a regression allows a forbidden request, its fixture uses nonexistent synthetic IDs; stop and inspect the evidence. Normal Guest entry/persona/exit updates Guest session records. The script does not create Staff accounts, reset data or adjust configuration.

These two browser scripts currently reference this machine's installed Playwright module and Chromium paths. Adapt those two paths on another machine; do not assume portability or download browsers as part of the test. Raw outputs go to ignored `evals/security/.local/`; never commit cookies, credentials, environment files or raw business records.

## Boundaries and failures retained

- Formal Staff disable/reset/role changes with retained signed JWTs and real simultaneous proposal execution were **not run**: no usable Staff credential fixture was present. Unit transport contracts and SQL lock metadata do not replace those checks.
- Live catalog evidence covers 11 selected tables and seven routines. It proves metadata at inspection time, not all RLS row visibility. Two bounded rollback procedure calls rejected database roles/synthetic claims with SQLSTATE `42501`; these were not signed Auth JWTs.
- The first read-only procedure probe returned `25006` because row locking was disallowed. That attempt is inconclusive; it was not counted as a permission pass.
- The first Guest entry timed out during cold compilation after entry was sent. Its browser closed, but visit revocation was not verified. The successful retry exited and verified denial. The harness now marks entry before navigation and treats cleanup failure as FAIL. No guessed visit row was deleted.
- Live provider injection, large-file upload/Excel abuse, deployed rate/load limits, dependency CVE scanning, production, external MCP and Human UAT are outside this batch.
- TypeScript and scoped ESLint passed. No full application build was required for tests/evidence only; executable product files are unchanged.

## Repair follow-up

Operations `POST /api/workspaces/[workspaceId]/operations/ask` fully reads JSON before actor authorization and creates its deadline afterwards. A 120-character field limit does not bound JSON whitespace or total bytes. Reuse a bounded streaming JSON reader, move authorization ahead of body consumption where practical, start the deadline before parsing and add acceptance tests for overflow/cancellation and valid Unicode. Re-run the affected handler and UI checks after the fix. The current tests show the application boundary defect, not deployed service exhaustion.
