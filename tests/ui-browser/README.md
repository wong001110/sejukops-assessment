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
