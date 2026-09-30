# Recorded website UAT journey — 2026-09-30

Status: **PROCEED for the scoped Mock + Guest browser acceptance**, after repairing one navigation defect. This is Main Agent browser execution; Human UAT remains unreported. Video packaging is recorded below.

## Authorized scope

- Owner requested a complete website walkthrough with video, natural pauses and no interference with other desktop work.
- Owner explicitly authorized an independent headless Playwright browser. Current IAB viewport measured 1280 × 720; the independent context and native video both use that size. This is the measured browser content viewport, not a claim about the physical panel resolution.
- Owner then chose **Mock and Guest only**. Permanent Owner login, password change, real platform administration/reset/provider edits and real Owner approvals are NOT_RUN in this batch.
- Mock uses actual client components and the existing browser-memory MSW preview at localhost:3200. Live uses localhost:3000 and only confirmed Supabase Test `qobhjvrrpajoyvlgrkbx`; no memento, deployment, merge, cloud red-team or external MCP work.
- Ordinary actions pause about 1.8 seconds before and 2.2 seconds afterward. Input/submit/result checkpoints are saved. Native page video captures only the isolated browser content, not the desktop, unrelated tabs, clipboard or credentials.
- At most three real Guest AI UI requests are planned (order Assist, knowledge Assist, text intake). Actual model steps/debits must be reported separately. No provider/allowance configuration changes are authorized by this walkthrough.

## Baseline

Initial snapshot: `a833a1272bef3720e123ed42dbc19bc9074f7efb`, plus the local completion-report edit. The navigation repair and focused regression were added during this batch.

Exact Test readback before live writes: four Auth identities, one provider, Owner generation 1 with zero orders/knowledge documents; Demo generation 2 with four orders/two documents; daily Guest limit 20, current 2026-09-30 used 2.

The initial sandbox server could not reach Test (`EACCES`). It was stopped and an approved-network loopback server started. Supabase health returned HTTP 401 without a credential header, confirming reachability. Initial IAB true-page navigation/CDP attempts timed out; screenshot sampling did not establish a reliable continuous recording and is not counted as UAT. The native headless recording supersedes it. The bundled Playwright expects Chromium revision 1234, absent locally; the already-installed headless Chromium revision 1243 launched via explicit executable path. No browser/package download or project dependency change.

## Cases and evidence

| Evidence layer | Executed journey | Result |
| --- | --- | --- |
| Rendered Mock | Populated/empty Orders, required-field gating, scripted 503 recovery | PASS |
| Rendered Mock | New customer/order, persisted proposal preview and explicit execution | PASS |
| Rendered Mock | Knowledge text create/stage/index/source review/publish/search with citation | PASS |
| Rendered Mock | Text upload/extract/edit/explicit confirmation | PASS |
| Rendered Mock | Slow order request cancellation, scripted order/knowledge quota rejection | PASS |
| Rendered Mock | Provider edit/test/save/reopen with blank key preservation; routing save | PASS |
| Rendered Mock | Shared budget update and confirmed Demo reset, preserving provider/usage | PASS (memory only) |
| Rendered Mock | Admin assignment → Manager reschedule → Technician start/complete | PASS |
| Real Guest/Test | Entry with role switch inside workspace; manual new customer/order creation | PASS |
| Real Guest/Test | Assignment → reschedule to 3 Oct 2026 10:30 MYT → start/complete | PASS; SQL status COMPLETED, UTC 02:30 |
| Real Guest/provider | Selected-order Assist | PASS; one scoped order returned, trace `443fecf7-6f35-4978-b732-aa6b9f9b767b` |
| Real Guest/Test | Manual keyword `filter` knowledge search | PASS; original text and title/source/page/version citation |
| Real Guest/provider | Knowledge question about inspecting/cleaning a filter | INSUFFICIENT handled clearly, 0 source hits; trace `aeb0789a-bb72-4c4f-9b80-c9e4f74a7d36`. This is not a successful live AI citation result. |
| Real Guest/provider | Text document extraction, editable draft, reviewed confirmation | PASS; missing amount/date remained Not found; no order before confirmation |
| Real Guest/Test | Owner workspace direct access, platform AI settings, workspace after exit | PASS; Owner/expired workspace 404, platform redirects to public landing |
| Real Guest/Test | Exit/re-enter: shared records visible, allowance still 14/20 | PASS; no per-visit allowance refill |
| Real Next/Guest + mocked model | Order selection → scripted model 503/router refresh → Manager switch | PASS after repair; selected query and detail retained; no provider call |

The real Guest has read-only knowledge access, so live knowledge authoring/PDF upload was not attempted. Owner login/password/settings, live platform reset/provider edits and real Owner proposal approval are **NOT_RUN** under the user's explicit scope. Live positive AI citation quality, PDF parser acceptance and mobile layout are not proven by this batch. MCP/red-team/deployment/merge remain outside scope.

## Navigation defect and verification

The first live order AI read succeeded, but switching to Manager afterward lost the selected order query. Orders passed `window.history.state` back to `replaceState`; installed Next 15.5.23 sees its `__NA` marker and bypasses application URL synchronization. Its subsequent `router.refresh()` therefore restored the earlier URL. The repair passes `null`, allowing Next to copy its metadata and synchronize the router URL.

- Added a rendered regression with a private router history marker; all six workspace request lifecycle tests passed, including cancellation and late-response guards.
- Targeted mutation: temporarily restoring the old call caused the new test to fail (`expected true not to be true`); restored source and reran six tests successfully. One mutant killed; this is not a suite-wide mutation score.
- Typecheck and scoped ESLint passed. No full regression/build was repeated for this one-line navigation repair.
- Reusable opt-in browser regression: `tests/ui-browser/order-navigation.mjs`. It runs against an explicitly authorized loopback Test server, creates/revokes one Guest visit, intercepts only its order AI response, performs no business writes and no paid model requests. Local result is `.agent/order-navigation.local.recording/result.json`.
- Reference: [Next native History API](https://nextjs.org/docs/app/getting-started/linking-and-navigating#using-the-native-history-api). The installed source, rather than newer documentation alone, established the private-marker behavior.

Script errors from ambiguous Ant Design selectors, premature assertions during cold compile, and mismatched expected success wording were corrected without repeated business submissions. They are harness failures, not additional product defects. Five Mock console errors were deliberate 503/429 cases. Negative 404 checks are expected; no uncontrolled live page exception was observed.

## Exact cleanup and usage

Only the confirmed Test project was used. The guarded cleanup transaction removed:

- Order `6b84a581-a1e7-4d19-8e55-84b949e4f5aa` / `UAT-20260930-REC-01` (completed).
- Order `af818008-6773-49cb-8e1b-67a855e1438b` / `UAT-20260930-REC-DOC` (NEW after explicit confirmation).
- Customer `fb387dfb-4a33-4476-bd16-c3e1eb0e2a19` / `UAT-20260930-REC Fictional Customer`.
- Three already-revoked visits: `7337dcd5-b7f4-4cba-ac5b-e9bbb3a4bbca`, `a7c4efba-32c3-4eaa-a261-07833d910971`, `8900ae31-e7a7-4357-9ebd-9cbfc0667c12`.

Final aggregate readback: Auth 4; providers 1; Owner generation 1/orders 0/documents 0; Demo generation 2/orders 4/documents 2; daily limit 20; used 6; zero UAT orders remain. Three real UI AI requests consumed four provider steps (order 2, knowledge 1, intake 1), increasing used from 2 to 6. Actual usage and technical audit records remain. Two older visits disappeared through existing entry-time retention pruning (`expires_at < now - 24 hours`); two newer historical revoked visits remain. The Main cleanup did not target those historical visits.

## Recording artifacts

Local native recordings, screenshots and event/API-status manifest are under `.agent/uat-2026-09-30.local.recording`; the independent navigation regression has its own `.agent/order-navigation.local.recording` video. These ignored artifacts contain only fictional browser data and are not committed. HTML report links to these adjacent local files. It offers original playback and optional skipping of long operator idle gaps; ordinary action delays are retained. The recorded 1280×720 size is a browser viewport, not an inferred physical display resolution.

All recording contexts/browser closed and native videos finalized. ffprobe and a fresh headless HTML preview confirmed VP8/1280×720 and playable durations: Mock 3099.28s, Guest 1951s, navigation regression 44.72s. The preview loaded all three videos, decoded a regression frame and reported zero page exceptions. Long raw durations include tool/repair waits and idle Mock time; optional playback skipping changes playback position, not the source footage or playback rate.

Mock preview was stopped, Guest visits exited/revoked, and the unused early headless recorder was closed. The user's existing browser tabs were not used for recording. The loopback project server remains available at localhost:3000.
