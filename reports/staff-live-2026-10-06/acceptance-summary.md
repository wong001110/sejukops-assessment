# Formal Staff Live Acceptance — 6 October 2026

**Main decision: REPAIR. Human UAT: NOT RUN.** This is automated real-browser acceptance and recording against Supabase **Test** (`qobhjvrrpajoyvlgrkbx`), using formal staff sessions, fictional retained records and the saved live AI configuration. The recorded candidate is `8a66afa86425866f695edba72425afa61ae33154`. Main ran `pnpm.cmd build` successfully at that candidate before starting the local production server on port 3100: compilation, the build's TypeScript/lint checks and static generation completed. This is build execution evidence, not a new unit suite or full regression result.

The evidence records **21 AI endpoint requests** within a 24-request recording bound, using the active `qwen/qwen3.5-flash-02-23` configuration. Endpoint requests are not a count of underlying provider steps. There are 28 raw recording attempts, 62 screenshot entries and one recorded page-error event. Capture used 1536×864, a 16:9 frame.

## Verified flow matrix

| Flow | Admin | Manager | Technician |
| --- | --- | --- | --- |
| Formal login, first-password setup, onboarding data denial, old onboarding JWT rejection | PASS | PASS | PASS; both prepared Technician accounts onboarded |
| Role landing, published knowledge search, platform access denial, sign-out denying business reads | PASS | PASS | PASS |
| Manual order/customer creation and saved assignment review → explicit execution | PASS; exact order/technician and later schedule readback | Assignment mutation denied | Not granted |
| TXT intake → live extraction → editable review → explicit creation | PASS; no order before confirmation, corrected fields persisted | Not granted | Not granted |
| Knowledge draft → source → READY → review/publication → cited search | PASS | PASS; separate creator-owned guide | Published read only; no management tab |
| Schedule change with exact MYT timestamp and technician unchanged | No Manager Schedule page | PASS, including correction of AI date error | Not granted |
| Assigned job → IN_PROGRESS → COMPLETED with reload | Readback available | Readback available | PASS; other assigned order hidden by RLS and rejected update left it unchanged |
| Dashboard Today / This Week / This Month and live AI Insight | PASS | PASS | PASS; own-job scope |
| Operations Ask AI | Knowledge citations PASS; order query HTTP503 | Order and knowledge queries HTTP503 | Scoped order and knowledge citations PASS |
| Contextual selected-order AI Assist | PASS response/rendered evidence; screenshot guard failed afterward. Inspected frame shows PORT-1001 COMPLETED, 7 October 11:30 MYT | PASS; selected-order evidence and Schedule portal | Not granted |
| AI Workspace conversation and source views | Comparison/investigation completed; initial source-only result LIMITED; first proposal request rejected | Source investigation/follow-up PASS; no assignment confirmation control | Native API denied |
| AI-prepared saved assignment and explicit execution | PARTIAL: order and technician correct; requested date wrong, later corrected | Assignment denied; exact schedule correction PASS | Not granted |
| Native knowledge guidance request | Completed clarification; cited guidance NOT established | Completed clarification; cited guidance NOT established | Not granted |

## Failures and acceptance limits

- **Date failure and Main oversight:** the request was **8 October 2026, 10:00 MYT** (`2026-10-08T02:00:00Z`). The saved AI proposal instead used **10 August 2026, 10:00 MYT**. Main checked order and technician but missed the date before confirming. The original error remains in the evidence. Manager then corrected the same order to the exact requested timestamp while preserving its technician. This is not a reliable AI scheduling PASS; exact canonical-field validation and a targeted date/locale regression remain required.
- **Real AI failures:** Admin/Manager order Ask AI and Manager knowledge Ask AI returned HTTP503. Technician order/knowledge and Admin knowledge succeeded. Safe `INVALID_EXCERPT` and `PROVIDER_FAILURE` reasons were observed, but the exact reason is not established for every failed request. Initial Admin native preparation recorded `TOOL_CHOICE_IGNORED`; the targeted selected-order retry saved and executed a proposal, subject to the date failure above. A source-only result and native clarification are limited outcomes, not generated guidance successes.
- **Harness failures:** duplicate detail locators, a Windows filename containing a colon, post-success waits, and an overbroad screenshot guard interrupted recording attempts. Separate signed API, exact persistence readbacks and subsequent browser evidence establish the relevant business outcomes. A clip's capture result is not its functional result. Original failed attempts remain available.
- **Expected creator boundary:** Manager could not open Admin's private source-review link. Current service/SQL guards restrict document/version review and mutation to the creator; Manager successfully published a separate guide. Same-document cross-creator revision was not verified.
- **Narrow negative proof:** another Technician's order returned zero direct RLS rows. A current-version update attempt returned HTTP409 and left the row unchanged. This proves rejection and no mutation; it is not a claim of a specific HTTP403 authorization result. Formal order detail still displays a technician identifier rather than a resolved name.

## Retained inventory

All four fictional staff accounts are active with password setup complete: **Aisha Portfolio Admin**, **Daniel Portfolio Manager**, **Amir Portfolio Technician**, and **Sara Portfolio Technician**. Credentials and session state are excluded from this report and media delivery.

| Order | Final status | Technician | Schedule (MYT) |
| --- | --- | --- | --- |
| PORT-1001 | COMPLETED | Amir | 7 October 2026, 11:30 |
| PORT-1002 | ASSIGNED | Sara | 7 October 2026, 10:00 |
| PORT-1003 | ASSIGNED | Amir | 8 October 2026, 10:00; corrected |
| PORT-1004 | NEW | Unassigned | Unscheduled |

**Portfolio Service Playbook** and **Portfolio Schedule Handoff Guide** remain published. Exact temporary setup Auth/profile readback found zero remaining temporary identities. The saved provider configuration and actual usage remain retained.

## Evidence and scope

[Live results](live-results.json) contains signed application API/JWT checks, persistence observations, role outcomes and inventory. [Editorial input](editorial-input.json), [caption corrections](editorial-corrections.json), the `raw/` and `derived/` recordings, and the referenced PNGs provide the media evidence. The [inspected Admin Assist frame](assist-frame-review.png) confirms the rendered PORT-1001 result separately from the failed screenshot guard. Screenshots/video show rendered behavior; API, RLS and exact readbacks provide separate backend proof. Successful playback/export does not resolve the AI failures above.

This recording task changed fictional Test data and local evidence only. It did not test Owner/Excel import/account administration journeys, Guest flows, PDF/OCR, MCP, every product feature, production deployment or Human UAT. No product source, permissions, provider configuration or database schema change was made. No source mutation or full regression was needed for recording/report authoring, and none is claimed here.
