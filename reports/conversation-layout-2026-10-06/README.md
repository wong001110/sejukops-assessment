# Conversation layouts — 2026-10-06

Main decision: **PROCEED for the scoped UI slice**.

Operations uses a chatbot transcript with a pinned bottom composer. Up to 12 independent questions are retained locally while open; each answer keeps its scoped records, excerpts and returned activity. Cancel/stale-result/close/reset/role/navigation handling remains. Native Conversation uses a coding-agent panel, separate actual-stream Execution display and pinned composer. The full canvas is preserved; earlier results are explicitly labelled and cannot dispatch agent actions or confirm a proposal until a new result succeeds. Mobile comparison overflow is repaired. No backend contract, permission, quota, provider, data, schema, account, MCP or deployment change.

## Evidence

- Final affected tests: **50 PASS** — Operations23, Native12, resolved layout4, stream parser11.
- Actual component browser: **27 PASS**, 1536×864 / 1024×768 / 390×844; no runtime errors or external requests. Fictional local MSW replies only.
- Targeted virtual source mutant: **KILLED** by both earlier-proposal confirmation checks (error and cancel); marker loaded once and source hash unchanged.
- Independent read-only GPT 6 Luna source review: **PROCEED**, no blockers in lifecycle, actual progress, stale action controls, scroll or scope. Main inspected implementation and device/mobile screenshots and independently ran integration checks.
- Final production build, scoped ESLint, TypeScript and diff checks: **PASS**.
- First browser attempt failed mobile comparison overflow (572px page /390px viewport); final contained grid repaired it. The previous lifecycle expectation for a retained input was updated to assert the submitted message stays in the transcript and the composer clears, as specified by the new layout.

## Limits

Mock UI verifies rendering/control/event handling; it is not evidence of paid-provider reliability, Auth/RLS or live database writes. Real provider, formal employee/Owner login and database checks were not rerun; these layers were unchanged. Human UAT **NOT_REPORTED**. No shutdown outcome is included in product acceptance.

[Gallery](index.html) · [Browser](browser-results.json) · [Tests](targeted-tests.json) · [Mutation](mutation-results.json)
