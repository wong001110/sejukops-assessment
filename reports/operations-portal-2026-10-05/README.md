# Operations portal restoration — 2026-10-05

Main decision: **PROCEED for the scoped portal implementation**. Related gates: UX-01, DEMO-01 and read-only PREVIEW-01. This is not full product acceptance or Human UAT.

## Implemented

- Fixed Operations sidebar and a role overview; Operations and AI Workspace remain separate modes over existing services.
- Overview counts explicitly describe up to 20 recent actor-visible records, not historical/period totals.
- Searchable order table, status filter and selected detail. New order, document intake, Guest assignment and Manager rescheduling open on demand in drawers. AI Assist opens in a modal.
- Manager Schedule includes visible unscheduled requests. Technician has My jobs and existing start/complete controls. Submitting mutation drawers cannot be dismissed while their result is pending.
- Formal Admin Assignment shows the business order number and MYT time. Technician choices and confirmation consistently use a shortened identifier because the existing projection supplies IDs, not verified employee names. Full technical identifiers are expandable.
- Formal Assignment now checks the server actor before rendering: Guest, non-Admin, preview and onboarding actors are denied. Existing mutation APIs retain their own authority checks.
- Knowledge defaults to Search; permitted editors have a Manage tab, explicit review/search preparation/publish steps and local PDF selection. Review URLs survive tab changes.
- Orders, Schedule and Knowledge separate client state by resolved actor/session/perspective. Fresh Guest entry, staff login and workspace-root navigation land on Overview.

## Evidence

| Layer | Observed result |
| --- | --- |
| Affected automated tests | 54 PASS across nine files: entry, persona return, login, navigation policy, overview, Orders scope, Schedule authority, Assignment authority and actual Owner preview pages |
| Rendered Operations Mock | 13 checks PASS: fixed navigation, filters, create/assign/reschedule/start/complete, on-demand AI modal, narrow layout, safe failure/empty states, pending-write drawer, stale rejection and saved formal proposal execution |
| Rendered Knowledge Mock | 21 assertions PASS: default Search, review query/tab context, draft → PENDING → READY → publish → search, Guest/Technician editor visibility |
| Targeted mutation | Four exact loaded mutants KILLED: Guest Assignment page access, Schedule preview permission, preview Schedule navigation and Orders scope key |
| Static/build | TypeScript, scoped ESLint, diff check and final Next production build PASS |
| Independent review | GPT 6.1 Sol reviewed integration and final authority/key deltas; scoped PROCEED. GPT 6 Luna independently exercised the Knowledge Mock flow |
| Real Test browser | Fresh Guest Overview, manual create, assign, Manager reschedule, Technician start/complete PASS across resumed test sessions. SQL independently observed COMPLETED, 11:30 MYT and unchanged assigned technician |
| Final build direct access | Guest formal Assignment and Technician Manager Schedule render the unavailable page without operation controls; Technician Overview renders |
| Cleanup | Exactly two temporary fictional orders removed. Original four Demo orders retained; zero test orders and zero active Guest visits in the run window on readback. Test audit evidence retained |

Initial live attempts failed on test selectors (hidden Select options, an incorrect success string, duplicate order text and an already-selected row), not a demonstrated failed write. The runner also initially assumed HTTP 404/semantic heading markup: streamed Next unavailable pages can return 200 and this application's message is not a heading. Final evidence checks the rendered denial and absence of controls. Early service launch requests did not execute because automatic approval review was temporarily at capacity; the service was started later through normal approval. Raw live attempts remain local.

## Reproduce the bounded Mock checks

Start `node tests/ui-browser/start.mjs`, then in a separate terminal:

```text
node scripts/tests/ui-browser/operations-portal.mjs
node scripts/tests/ui-browser/operations-knowledge.mjs
node scripts/tests/operations-portal-mutations.mjs
```

The browser scripts use the installed bundled Playwright runtime; `PLAYWRIGHT_MODULE` and `PLAYWRIGHT_EXECUTABLE` can override the Operations runner's local defaults. Mock APIs are fictional MSW responses with a synthetic navigation adapter. They do not prove authentication, row isolation, transactions, PDF parsing, embeddings or provider quality. Sanitized Mock summaries are committed beside this report; raw live data is not published.

## Limits

No new Auth accounts, emails, schema migrations, reset, provider configuration, paid model calls, MCP development, production deployment or merge. Existing Owner data and unrelated memento resources were not changed. Formal staff login and real-provider AI are not rerun for this portal slice; formal proposal execution and Knowledge authoring here have Mock evidence. Human UAT remains NOT_REPORTED. Owned test browsers/services were closed. Broad full-product regression was not repeated; checks targeted changed presentation, lifecycle and authority boundaries.
