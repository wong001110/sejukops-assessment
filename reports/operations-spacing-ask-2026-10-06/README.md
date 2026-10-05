# Operations spacing and unified Ask AI

Date: 2026-10-06. Base snapshot: `fc661855b44ae514fabfc7dcedb7d2a5705cb8ac`; this feature slice is delivered on `codex/agent-native-workspace` in PR #39.

## Changes

- Dashboard section/KPI gaps are 20 px on desktop/tablet and 16 px on mobile. Scoped legacy-style overrides remove joined KPI borders, inconsistent sibling margins and hover movement. Comparison text can wrap without clipping.
- Guest Perspective uses Ant Design Select with a hidden `persona` field and the existing explicit Switch POST. Choosing a field value does not automatically submit. Owner preview remains a separate guarded interaction.
- Technician bottom navigation uses three columns for its three links; the mobile floating button and drawer clear the navigation without overlaps.
- Operations Ask AI has one question input for orders, published knowledge, or both. No topic picker is required. The fixed drawer overlays the portal.
- Admin/Manager read actor-visible workspace orders; Technician reads only assigned jobs. All three read published workspace knowledge. Owner read-only previews cannot invoke AI. General Technician order-agent/native-agent permissions are not broadened.
- One existing SDK loop executes one bounded evidence tool and at most two provider steps. Orders are limited to the latest 20 visible records, with at most five selected records; knowledge shows at most three exact cited excerpts from eight hits.
- A zero-hit knowledge query falls back to original literal spans, at most eight unique candidate searches, stopping at the first hit. Selected citations receive a separate freshness search using the successful query (at most nine knowledge service reads including verification). No additional model steps. All reads retain scope, generation and cancellation checks and the 25-second runtime deadline.
- Public prose is server-authored. Selected order fields and citations are revalidated before returning; model prose, invented IDs, translated queries and unsupported excerpts are rejected. Missing knowledge is disclosed when only order evidence was verified.
- Independent uncached actor, Guest visit and generation checks settle in parallel before validation. The scope check returns its fresh generation to the runtime, avoiding a duplicate read. Adjacent fallback completion/start guards share the same freshly completed check only when no asynchronous operation intervenes. No cached scope, deadline extension or permission bypass.

- Guest UI identity uses the visit, principal profile and Demo generation. Request-local delegated Auth session rollover no longer clears results during allowance refresh; formal Auth sessions, persona/workspace/visit/generation and Owner preview changes still reset state. Server authorization remains unchanged.
- Server failure diagnostics output only a fixed allowlisted reason, never raw model/source/error/credential data.

## Evidence boundaries

| Layer | Result | Scope |
| --- | --- | --- |
| Mock browser layout/Select | PASS — 15 checks | Actual components, fictional MSW data. Admin/Manager/Technician at 1536×864, 1024×768, 390×844; 20/16 px section and KPI gaps, no page overflow or clipped comparison text, explicit switching |
| Mock unified panel | PASS — 12 checks | Three roles × orders/knowledge/mixed; quota fallback without stale results; mobile Technician overlay, single-row navigation and button clearance |
| Affected contracts/components | PASS — 139 distinct tests across scoped runs | Runtime40, route30, layout lifecycle4, panel15, provider scope3, actor5, recent-order capability17, listing15, overview9, Guest Select1 |
| Targeted source mutation | PASS — 3 mutants KILLED/restored | Staff revision guard, exact contiguous-excerpt validation and Guest refresh-session identity; not a full mutation score |
| Static / production build | PASS | Typecheck, scoped ESLint, diff checks, final Next production build after retrieval repair |
| Independent review | PROCEED | GPT6Luna source review of auth/provider/runtime boundaries and final literal fallback; Main independently inspected runtime/API and scoped services |
| Real Test Guest provider queries | PASS — 3 scoped assertions | Admin4 / Manager4 / Technician3 returned records, each with one published excerpt, matched against real scoped APIs; separate sessions before final UI key correction |
| Final production Guest UI / authorization | PASS — 4 checks | Real RSC refresh and switching with one intercepted fictional AI response (no paid call); actual Technician general-agent and foreign-workspace denials |
| Formal employee login / Owner interaction | NOT_RUN in this slice | No employee or temporary Owner credentials used |
| Human UAT | NOT_REPORTED | Automated checks are not human acceptance |

## Repair history

Two initial real Admin mixed requests returned four orders but zero knowledge hits. This was a real retrieval failure, not a successful mixed-flow check. The knowledge RPC uses literal full-text AND search; a mixed sentence can miss a manual matching only `filter`. The bounded literal fallback and four new contracts were added before the final rebuilt rerun. Earlier failed selectors/build-during-edit attempts were repaired and are not counted as passes.

One isolated preview start had outbound `EACCES`: Guest entry failed without a paid call. After granting the temporary server its required network access, an Admin run returned 503 after 27,242 ms with one provider step. This was consistent with pressure from repeated sequential scope reads; it was not counted as success. The scoped parallel/duplicate-read repair and nine additional contracts followed, preserving all deadlines. Raw attempts remain local; safe final evidence is separate.

An earlier Manager 503 at 16,632 ms / two steps did not reproduce after adding safe diagnostics. Its exact cause is **NOT_CONFIRMED**. Three real provider query assertions passed, but their original whole-run failures (dropdown/reset/close) are preserved; the identified Guest UI session-reset bug was then repaired and separately verified on the final build without more paid calls. This is layered evidence, not one uninterrupted full-flow PASS.

Main decision: **PROCEED for this scoped slice**, with the intermittent unknown 503 retained as a reliability limitation.

## Resources and limitations

Only confirmed Supabase Test `qobhjvrrpajoyvlgrkbx` and its Demo workspace were used for real verification. Queries are read-only apart from ordinary Guest visit lifecycle, paid-step allowance reservations and safe technical AI observations. No business writes, accounts, provider configuration, quota override, schema changes, resets, deployment or unrelated/memento access. Paid usage is retained. Final connector readback: Demo orders4, active visits created today0. Owned preview servers and headless browsers were closed. One hung UI runner required precise revocation of its owned visit; no business record was deleted.

The gallery screenshots are all explicitly Mock. Keyword retrieval is not semantic RAG; a relevant document can still be missed. Latest-20 order context is not a full historical query. Additional fallback reads can increase latency within the deadline. No claim of universal source selection, full repository regression or production readiness.

## Reproduction

- Mock server: installed Vite CLI with `--config tests/ui-browser/vite.config.mjs` on localhost:3200. MSW rejects unhandled API requests.
- `node scripts/tests/ui-browser/operations-spacing.mjs`
- `node scripts/tests/ui-browser/operations-unified-ask.mjs`
- `pnpm.cmd build`
- Real verification uses an independent headless browser on the final localhost:3100 production build. One-click Guest entry, actual Ant Design Perspective Switch, scoped order API comparison and one mixed question per role; ordinary exit revokes the owned visit. Live runner and raw failed diagnostics remain local under ignored `.agent`.

[English screenshot gallery](index.html) · [Layout results](layout-results.json) · [Mock Ask AI results](ask-results.json) · [Mutation results](mutations.json) · [Safe repair history](repair-history.json) · [Layered live evidence](live-results.json)
