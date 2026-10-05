# Role dashboards and floating AI — acceptance record

Dates: 2026-10-05–06 MYT. Feature branch: `codex/agent-native-workspace`, PR #39.

Main decision: **PROCEED** for implementation, Mock/browser behavior and the
bounded real Test read/permission/provider slice. **NOT_REPORTED** for Human UAT.
The gallery is explicitly Mock, not live data or a portfolio recording.

## Changes and distinct capabilities

- Operations keeps the conventional portal. Admin, Manager and Technician have
  MYT period Dashboards with complete actor-visible queues, comparisons, service
  distribution, audited completion/reschedule activity and on-demand AI Insight.
- Removed standalone Document import navigation; contextual order intake remains.
- Floating Operations Ask AI combines order evidence and cited knowledge for
  Admin/Manager; Technician receives knowledge only. Owner previews cannot run AI.
- AI Workspace keeps its adaptive canvas. Conversation is a fixed overlay;
  closing retains transcript/pending work, while New conversation cancels/resets.
  Existing guarded persisted proposal confirmation remains unchanged.
- Dashboard Insight selects at most three source-verified highlights in one
  bounded model call. No tools or AI-triggered business writes. A fresh snapshot
  check rejects changed data before returning the result.

## Evidence

| Layer | Actual result |
| --- | --- |
| Final affected Vitest suite | 123 tests / 13 files PASS |
| Floating Operations component suite | 15 tests / 1 file PASS |
| Fresh installer Node tests | 3 PASS |
| TypeScript, scoped ESLint, production build | PASS |
| Operations Mock browser | 20 checks PASS, 1536×864 and 390×844; zero page errors or external requests |
| Native Mock browser | 9 scenario groups PASS, desktop and narrow screen |
| Source mutation testing | 4 selected real mutants KILLED; originals restored, baseline tests PASS |
| Local PostgreSQL 17 | Guarded fresh installer plus synthetic positive/negative RPC assertions PASS; disposable cluster stopped/removed |
| Hosted Test migration | Additive read RPC applied to `qobhjvrrpajoyvlgrkbx` only |
| Real Test browser | 8 checks PASS; Admin/Manager 4 visible orders, mapped Technician 3; three MYT periods each |
| Paid provider | 2 bounded AI requests PASS after midnight allowance refreshed naturally: Dashboard Insight and Technician knowledge EXCERPTS_FOUND |

Real browser also rejected a foreign workspace and Technician general order AI,
and verified Technician's floating knowledge-only entry. All test visits were
revoked; no business records, accounts, credentials, quota or provider settings
were modified. Final connector readback: Demo 4 orders / active recent test visits
0. Actual paid usage was retained, not restored. No memento access, deployment,
MCP work or PR merge. See [bounded live result](live-result.json).

Independent GPT 6.1 Sol reviews covered dashboard SQL/scope, task permission
resolution, panel lifecycle and fresh installer integration. Review findings
(session keys, offset datetime parsing, final-read cancellation and generation
remount) were repaired and tested. Main independently ran acceptance checks.

Four mutants: Technician returned-row scope, final dashboard generation guard,
Owner-preview knowledge denial, and Insight snapshot rejection. SQL mutation
testing was not run; actual SQL negative execution was performed locally.
See [dashboard evidence](../operations-dashboard-2026-10-05/README.md),
[dashboard mutants](../operations-dashboard-2026-10-05/mutations.json) and
[Main mutants](main-mutations.json).

The fresh installer retains its historical baseline/hash and appends the new
hash-pinned migration in the same guarded empty-database transaction. Local
fresh replay passed; no hosted empty-project replay or backup restore is claimed.
Three narrowly scoped Git LF attributes keep the byte-pinned baseline, catalog
and feature migration stable on Windows/Unix checkout. A separate checkout of
the staged inputs retained baseline `C2592217…719B89` and migration
`A29A9525…FD1F`; independent review and the 3 installer tests passed.

## Limits and repair history

- Financial amounts/average value are unavailable: no charge fields exist.
  Completion history uses real audit events, excluding invented seed history.
- Complete reads have an explicit 50,000-row ceiling. Multiple pages guard count,
  identity and generation; same-count concurrent field changes can still interleave.
  Current Demo data fits one page. The activity RPC itself uses one SQL snapshot.
- Native contract still lacks human-readable branch/technician names and
  customer/location/history/financial fields. Only existing grounded fields are shown.
- Mock first-run selector and live Technician-count assertion were corrected to
  inspected actual UI/schema data, not by weakening product validation. Initial
  SQL fixtures were repaired against real assignment constraints and enum types.
- A first mutation runner had a Windows output decoding error; source restored,
  UTF-8 rerun produced actual assertion failures and restored baseline PASS.
- The pre-midnight live attempt correctly skipped paid AI with zero allowance.
  After natural MYT midnight reset, a fresh visit had 20 remaining and both
  bounded AI requests passed. This was not a quota override or Mock substitution.
- A cleanup read first addressed a nonexistent private visit table; corrected
  to the existing public visit table. This was read-only and changed no data.

## Existing Test advisories

The security advisor reports protected tables with RLS/no public policies,
authenticated SECURITY DEFINER functions (including the new deliberately scoped
RPC), and disabled leaked-password protection. Internal function guards and
negative tests are recorded above; this is not a zero-warning security claim.
No Auth settings were changed.

- [Authenticated SECURITY DEFINER functions](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
- [RLS enabled with no policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
- [Password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)

See [English screenshot gallery](index.html),
[Operations Mock results](operations-mock/results.json), and
[Native Mock results](native-mock/result.json).
