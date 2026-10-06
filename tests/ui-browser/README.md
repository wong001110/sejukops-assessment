# Local rendered Mock preview

From the repository root, use the installed Node runtime:

```powershell
node tests/ui-browser/start.mjs
```

Open **http://localhost:3200**. This starts the existing Vite dependency of Vitest with `tests/ui-browser/vite.config.mjs`, binds localhost only, and fails if port 3200 is occupied. Stop the terminal process with Ctrl+C. No `.env` is loaded, no Next server is started, and no Supabase or paid AI client is used. Do not publish this test preview.

The pages render the actual OrdersWorkspace (including OrderIntakeCard), AgentWorkspace, KnowledgeWorkspace, AssignmentProposalPage, AISettingsWorkspace, DemoResetCard and GuestAiBudgetCard. Only Next navigation/link adapters are replaced in the preview. Application reset and product styles are imported. MSW starts before React renders request-making components; failed startup displays an error and renders none of them. The worker at `public/mockServiceWorker.js` is an unchanged copy of installed MSW 2.15.0's `lib/mockServiceWorker.js` and is served solely by this preview root. After changing MSW, refresh this copy from the installed package.

The visible scenario selector resets in-memory fictional records and remounts the active component. `success` provides records and supports mutation; `empty` provides empty order/technician/search/provider lists; `delayed` waits six seconds for every response; `server-error` returns 503; `quota-exhausted` returns 429 for simulated workspace paid operations but permits ordinary manual writes; `stale-write` rejects operational mutations with 409 (proposal preparation remains possible, confirmation returns STALE); `validation` rejects mutations with 400 including provider field errors. Select success after an error to retry. Switching pages/personas or resetting scenarios unmounts active components; old handlers keep the old store and cannot mutate the new reset store.

Mock persona controls configure actual component props for presentation checks. They do not simulate or prove server authorization. AI Settings and Assignment tabs intentionally remain accessible for isolated component verification. The preview persists orders, assignment proposals, knowledge stages/publications, and masked provider settings only in browser memory. A reload or Reset mock records restores fixture state. The fixture upload sample is `tests/fixtures/ui/order-source.txt`; PDF responses are scripted and do not prove parsing.

Platform controls use the exact GET/POST reset and budget endpoints; unsupported methods remain unknown APIs. Mock reset increments generation, reseeds records and invalidates proposals while retaining provider profiles and the daily budget. Its `stale-write` scenario simulates a concurrent generation change followed by an uncertain 503 result, so the actual control must reload status and clear confirmation. Budget changes preserve used count. This is fictional browser state, not authorization or transaction evidence.

Every application `/api` request has a mocked response or a visible 500 missing-handler error. External HTTP fetch/XHR is denied by the final MSW handler. Same-origin Vite module/style/assets remain served by Vite. A server-side catch rejects any `/api` request when the worker is unavailable. Request activity displays method, path, and status only; request bodies/credentials are not logged. Type only fictional mock credentials in this preview.

Suggested rendered journeys: manual order create and refresh; focused Orders → Agent handoff; populated/empty cited knowledge; slow AI request then Cancel and navigation; intake upload/extract/edit/confirm and cancel; knowledge create/stage/index/review/publish/search; assignment prepare/review/execute and stale rejection; provider edit/test/save/close/reopen, capability routing, validation/server retry; repeat selected journeys at a narrow viewport. Browser execution results must be recorded separately by the Main Agent. Implementation or a build/typecheck pass does not prove these browser journeys passed.

This is **rendered Mock integration**, not real Auth/database E2E, model/provider acceptance, parser/embedding quality, transaction or isolation proof, independent hosted installation, or Human UAT.

The setup follows [MSW browser integration](https://mswjs.io/docs/integrations/browser/) (await worker startup) and [Vite configuration](https://vite.dev/config/).

## Actual Next.js order navigation regression

`order-navigation.mjs` is an opt-in integration check against an explicitly authorized loopback Test server. Set `UAT_ORIGIN`, `UAT_ORDER_NO` to an existing fictional Demo order, and optionally `UAT_PLAYWRIGHT_PATH`, `UAT_CHROMIUM_PATH`, `UAT_OUTPUT`; then run `node tests/ui-browser/order-navigation.mjs`. It creates and revokes one Guest visit, mocks the order model endpoint with 503, and checks that the selected order survives the resulting router refresh and Manager perspective switch. It records a 1280×720 isolated video with pauses. It does not create orders, change role-specific business data, call a paid provider or log session cookies. Guest entry may run the application's existing expired-visit retention cleanup. If revocation fails, its result says so; exact temporary visit cleanup remains the operator's responsibility. This is real Next/Guest integration with a mocked model response, not live provider evidence.

## Rich operational UI gallery

The default scenario is now `realistic`: 48 service orders, 12 fictional Malaysian customers, three branches, six technicians, six published documents, three masked model profiles, 12 staff accounts and 28 metadata-only AI observations. IDs, staff/technician relationships, branch assignment, visit dates and dashboard period totals are consistent. Existing `success` fixtures remain available for earlier browser checks; choose the scenario explicitly in those checks. `index-failed` adds a failed, unpublished knowledge version with retry controls.

Public/account/platform/diagnostics pages reuse their source markup through `public-pages-plugin.mjs`, which replaces server-only identity/actions inside this Vite renderer. Product Next builds never load this adapter. Staff password submissions call only a local synthetic function; sign-in/sign-out forms are inert. Mock personas and successful local password screens do not prove real Auth. Native agent responses remain scripted snapshots of fixture records, distinct from mutable manual-order browser state.

Capture the 1920×1080 gallery while this preview is running:

```sh
node scripts/tests/ui-browser/realistic-gallery.mjs
python scripts/tests/ui-browser/build-realistic-gallery.py
```

Set `UI_PLAYWRIGHT_PATH` and `UI_CHROMIUM_PATH` to installed browser tooling where needed. The cloud defaults are `/opt/codex/cua_node/lib/node_modules/playwright` and `/usr/bin/chromium`. No browser installation or package declaration change is required. `UI_GALLERY_ONLY` accepts exact journey names separated by `|` for a diagnosed retry; it preserves unrelated checks and failures. The builder keeps the latest capture of each screen, validates PNG dimensions, and removes superseded images from the deliverable. Inspect `reports/ui-mock-gallery/index.html`, its README and browser-results.json for the current evidence. Screenshot controls are hidden and a small fictional-data watermark remains; every PNG is a viewport capture, including scrolled segments of long pages.
