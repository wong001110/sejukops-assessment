# Staff accounts extension — development evidence

Date: 2026-10-01. Candidate incomplete; Goal remains active. Source is feature branch `codex/staff-accounts-perspectives` based on `b88bc9b`, dependent on unmerged PR #37. The implementation checkpoint is commit `6c43d3b`. This report distinguishes local checks, hosted migration and pending real Auth/browser acceptance; Human UAT is unreported.

## Implemented candidate

Formal email/password login, mandatory first-password setup, session/revision readiness gates, Owner-managed account creation/list/update/reset, XLSX template/parser, secret-free persisted import drafts and bounded sequential confirmation batches are present. Owner read-only perspectives preserve the actual Owner identity and scope selected Technician reads to that employee. No application email flow is introduced.

## Mock and local evidence

- Main reran 56 focused login/password/actor/provisioning/database-contract checks: PASS.
- Main import service and HTTP checks: 26 PASS, including exact workspace authorization before parsing, strict multipart shape, independent workbook/body bounds, sanitized diagnostics, explicit saved-draft confirmation, stable per-row operation IDs, partial failure and lost-credential guidance.
- Main scoped import ESLint and global TypeScript checks: PASS at this checkpoint.
- Excel owner reported 53 parser/template checks and two detected mutations: expanded-archive total bound and duplicate-email rejection. These are XLSX library checks, separate from browser navigation.
- Staff UI owner reported 20 actual rendered component/API-adapter checks and two detected mutations: workspace credential state separation and stale pre-mutation list response invalidation. Later Owner perspective additions need their own results.
- Main detected two additional import mutants with behavioral assertions: replacing the persisted row creation UUID with a new random UUID, and placing returned credentials into persisted batch RPC arguments. Both mutants were killed; the original file was restored and the 9-test pre-guidance baseline passed again. The later 26-test batch includes the new guidance check.
- Isolated Chromium headless actual staff UI: 16 flow groups PASS at 1280×720 and 390×844. Populated/empty/loading/error, create/edit/disable/reset, validation/cancel, sequential partial import/retry, stop/resume and narrow layout were exercised with fictional MSW responses. No external requests, runtime errors or warnings; four HTTP 503 console entries were asserted intentional error fixtures. Main read the result and inspected desktop list and narrow invalid-import screenshots. [Browser evidence](artifacts/2026-10-01-staff-mock/result.json).
- Template navigation is a synthetic Playwright download fixture because MSW does not intercept browser navigation downloads; harness reload follows that case. This is **not** proof of the real template HTTP route or downloaded workbook.
- Disposable localhost PostgreSQL 17 ran the actual baseline/migrations with synthetic Auth tables and signed-claim substitutes. The SQL owner reports 23 foundation/lifecycle/password-proof groups, nine preview/session groups, 19 authenticated preview business-command denials, service proof denial and a two-connection preview/command lock overlap with no unauthorized order. The import SQL rehearsal also passed authorization, malformed email, branch/Auth conflicts, ten-row lease, NULL/expired/consumed/unclaimed/fabricated completion denial, secret-free ledger and stable failed-only retry. Main reviewed source and the independent review findings; hosted JWT/GoTrue behavior remains unverified.

## Protected Test backup

Main executed the reviewed read-only backup script against only `qobhjvrrpajoyvlgrkbx`. Manifest `test-backup-2026-10-01T07-28-26-499Z-e373ac20.json` is under Git-ignored, restricted-ACL `supabase/.temp/backups`.

| Archive | Bytes | TOC entries | SHA256 |
| --- | ---: | ---: | --- |
| Full Test | 738873 | 924 | A5A60B874D3DA7EDC3C32AC05164BDC774D14CE772799ED794D60AC29A2DFED2 |
| Application | 298480 | 375 | A19AA429C1B1BB3F0BBCFA3D1A729C23282BC5A094BC7AA092BB9BD039341C30 |

Both custom archives were listed and fully extracted without connecting a restore target. Application and Auth digests matched before/after backup. Live restore was **NOT_RUN**. Backups contain sensitive database state and are excluded from source, reports, model context and PR artifacts.

After applying the six migrations, the old backup digest's 24-table guard correctly rejected the expanded schema. A separate read-only staff backup digest now requires all 31 exact reviewed application table names; historical destructive replay/restore callers retain their original guard and fail closed. Five focused backup/digest tests passed. The new protected manifest `test-backup-2026-10-01T08-23-09-274Z-b1bc140b.json` records a full archive (880109 bytes, 1082 TOC entries, SHA256 `29BA0BAFFA6AB8DC90669FCE3593FC221C491FA23C81A443CB4ECA5173BBAA6D`) and application archive (422686 bytes, 533 TOC entries, SHA256 `99542478DD3E338959E90DB0E6B6128DF5AF62854A2BAF19BCD20CF313890D88`). Both archives were fully extracted without a database connection, include all seven new private tables, and preserve the original before/after application/Auth digests. Post-extension restore rehearsal remains **NOT_RUN**.

## Main candidate checkpoint

Main independently ran the complete disposable PostgreSQL rehearsal: exit 0, 35 labeled staff/preview/reset SQL groups plus import assertions and an actual two-connection overlap. No generated staff-foundation scratch directory remains. A separate copied preview migration removed only the write guard: the real SQL negative check rejected the mutant at `workspace_order_create` (expected 42501, got P0001 from its expected-denial sentinel). The original migration was not edited. This is a seventh distinct detected mutation in this feature batch; it is local SQL evidence, not a hosted JWT attack.

The shared Vitest run passed **743 tests / one optional live-JWT skipped**, 107 passed files / one skipped, in 94.87 seconds with two workers. Main also reran the reset/login/password subset: 33 PASS. Global TypeScript, scoped ESLint and Next.js 15.5.23 production build passed. A later Technician name-only presentation change passed the six affected page checks; full regression was not repeated for that small edit.

Owner preview browser baseline passed 12 groups at the same desktop/narrow sizes, and the assigned-only Technician/name follow-up passed two groups. Main inspected the narrow Technician screenshot and read the follow-up results. Synthetic data/session/expiry and rendering props are not real Auth/RLS evidence. Four deliberate baseline 409/503 errors were isolated; the follow-up had no console/runtime/external errors. Both owned browser/Vite runs were closed. [Preview evidence](artifacts/2026-10-01-owner-preview-mock/result.json), [Technician follow-up](artifacts/2026-10-01-owner-preview-mock/result-technician.json).

GPT 6 Luna independently traced the other authors' auth/preview/import sources and reported no concrete blocker. Main checked the claim sequence: Auth update → private fingerprint claim → desired-password fresh sign-in → completion, rather than interpreting it as a pre-password-change claim. GPT 6.1 Sol independently reviewed Main's import and Luna's reset SQL and ran the repaired local assertions. These reviews and Main checks are separate from live acceptance.

Read-only confirmed-Test inventory showed the two expected active workspaces, four expected Auth users, one active Super Admin and zero new staff tables before migration. No unrelated project was queried.

## Remaining gates

Before hosted application, an independent read-only comparison found all 11 covered business routine bodies, signatures, security settings and grants matched the existing baseline after removing only the new staff guard injections. All six reviewed staff migrations were then successfully applied to `qobhjvrrpajoyvlgrkbx`. Readback found seven new private staff/preview tables with zero rows, the same four Auth identities and one provider, no authenticated direct staff-table privileges, and the intended denied anonymous/service-only RPC boundaries. No Auth identity or password was changed by this migration step.

The owner explicitly authorized one new temporary Super Admin acceptance batch, restricted to UUID-marked fictional Test staff/orders/import/preview and exact cleanup. Runner implementation and review precede execution. Remaining: real Auth/JWT/API/browser journeys, precise cleanup and preservation readback, fresh schema-track consistency, necessary repairs, final documentation and coherent dependent PR delivery. Public push/new PR, production deployment, memento access, paid AI and external/model red-team have not been performed for this feature. Human UAT is **NOT_REPORTED**.

Decision: **PROCEED with implementation; acceptance incomplete**.

## Real acceptance attempt and repair

The first attempted batch used run `fe33e24d-2790-467f-bbf6-4ce8538704f5`. Temporary Auth creation and fixture setup succeeded, but the restricted local Next process failed to reach Auth during Owner login (`AuthRetryableFetchError`). No employee account was created. The runner's automatic cleanup passed, removing the temporary identity/profile/membership/branches/customers and restoring all 31 application-table summaries plus the original four Auth identity/credential summaries. [Failed attempt, not acceptance](artifacts/2026-10-01-staff-real-fe33e24d-2790-467f-bbf6-4ce8538704f5/result.json).

A separate credential-free browser check exposed a real rendering defect on the new `/login`: `Input.Password` is a compound client export unavailable from this Server Component. The page now uses the same direct Ant Design password input pattern as Owner login. Production rebuild passed; 15 login action tests and 12 onboarding form/database-static tests passed. The owned Next process is being restarted with the already-authorized Test network access. A narrowly guarded recovery option permits reusing only this fully cleaned, pre-staff run's original Owner UUID/marker after exact baseline equality; it cannot reuse a run with staff operations/imports/orders. The original failed evidence is retained separately from any subsequent attempt.

## Fresh application schema consistency

Read-only schema export from the migrated Test produced normalized baseline SHA256 `C259221764D6217449208AEF54DD808ACC1D9D0B6907E7796125A284A7719B89`, with 18 public/13 private tables, 54 public/64 private routines and 32 RLS policies. The installer pins this hash; its static audit requires the new staff objects and rejects selected historical objects/data. The export rejects copied rows, project URLs, identity UUIDs and common credentials; the only literal UUID allowed is the existing source-defined AI settings singleton.

The independently delegated local rehearsal applied the pinned installer and catalog once, then verified empty staff/business/credential state, effective grants and foreign keys, all 35 labeled staff/preview/reset groups, import assertions and an actual two-connection preview/write ordering. The existing preview-write mutation was killed again against this baseline; it is the same mutation, not an eighth distinct mutant. Scratch cleanup was verified. The final P1 script suite passed 39 tests (including the three new backup digest checks), plus eight staff static tests, scoped lint and diff checks. Main reviewed the export/installer/rehearsal diff and ran the static audit and focused backup checks. This is disposable local PostgreSQL with minimal managed-schema substitutes, **not a new hosted Supabase installation or real Auth/JWT bootstrap**. Historical destructive replay/restore guards remain unchanged and reject this expanded schema.
