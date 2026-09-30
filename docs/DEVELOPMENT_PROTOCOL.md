# AI-Native Development Practice — Sejuk Ops

This protocol replaces the assessment-era fixed-role development protocol. It governs development method, not the product's agent runtime.

## 1. Native-first execution

Use the coding host's existing repository, terminal, test, browser, and delegation capabilities. The Main Agent chooses execution strategy based on task risk and available tools; it may implement directly when authorized or delegate clearly scoped work. Do not build a custom harness, prescribe a permanent multi-agent hierarchy, or require model-capability inventory files merely to begin a documentation task.

Before delegation, verify actual host capabilities. Give the delegate an objective, allowed files, dependencies, constraints, acceptance IDs, and required evidence. Main Agent integrates results and retains acceptance responsibility. Independent review must be real; do not fabricate a separate reviewer when none exists.

For the website completion Goal authorized on 2026-09-30, use `gpt-6.1-sol` or `gpt-6-luna` for sub-agents. Main Agent selects reasoning according to task risk and complexity. Delegate bounded independent work when useful, not every minor change.

Agent Continuity, if used by the host, remains external optional execution-state support. It must not become repo product architecture, a dependency, or a competing roadmap.

## 2. Authority and current state

The latest user instruction and [AGENTS.md](../AGENTS.md) bound authorized work. [PROJECT_STATE.md](../PROJECT_STATE.md) is the single mutable progress authority. Product/architecture/plan documents define the intended outcome; source and evidence determine what actually exists.

The owner subsequently authorized phased P1–P6 development. P1 is active; [PROJECT_STATE.md](../PROJECT_STATE.md) records its current evidence and confirmed target. Permission to discard legacy Sejuk Ops application data does not extend to unrelated resources or production deployment.

## 3. Adaptive phase cycle

For each authorized phase:

1. Reconcile current branch, source, evidence, and environment with the task.
2. Define a bounded objective, dependencies, non-goals, acceptance IDs, and risk-based checks.
3. Select direct implementation or justified delegation; implement a coherent slice.
4. Review the diff and run relevant checks when a meaningful batch/major change is ready.
5. Obtain independent review where warranted and available; verify actual UI/live integration when required.
6. Record `PROCEED`, `REPAIR`, or `BLOCKED` with evidence in the state/handoff; continue only within authorization.

Phases can change with evidence. Do not silently drop acceptance criteria or introduce unrelated product scope. Once implementation is authorized, routine in-scope choices do not need repeated confirmation.

## 4. Verification proportional to risk

Use targeted contract/unit/static checks first; expand to integration and real-browser checks for affected journeys. Cross-cutting auth, data isolation, approval, shared schema, or release work warrants broader regression. Do not run the whole application suite or create a commit for every small edit.

### Frontend sequence: mocked data before live integration

The owner requested this sequence on 2026-09-30. Develop and exercise frontend journeys with synthetic MockUp data and deterministic API/model responses first. Match the actual contracts, including status/error envelopes and agent activity events; do not use a separate simplified interface that hides integration behavior.

Before switching a changed journey to live data, render its actual components and exercise the relevant interactions: loading, empty, populated, slow response, validation failure, server/network error, retry, cancel, double submit, modal close/reopen, and stale responses after navigation or role changes. Add long text, missing optional fields, and narrow-screen cases where relevant. Source-string assertions and mocked backend unit tests alone do not establish that the frontend works.

Keep mock fixtures/adapters explicitly scoped to local development or tests, with no real credentials or sensitive records. Mock persona states establish UI behavior only; real Auth, authorization, workspace isolation, and database behavior require their own live checks. A live failure must never silently switch to mock success.

After the mocked UI checks pass, verify the same journey against the confirmed Supabase Test project with fictional records, then make only the bounded real-provider calls needed to validate integration when authorized. Report mocked UI, live database/browser, and paid model evidence separately. Batch related checks and commits; run broad regression only for a shared-risk change or final candidate.

Critical authorization, isolation, stale-state, idempotency, quota, and reset boundaries need negative tests. Use targeted mutation/adversarial checks when they test a real invariant, rather than adding a mandatory project-wide mutation framework. Explain skipped/non-applicable checks and compensate for absent review tools with explicit self-review and tests, without calling it independent QA.

The current Goal explicitly calls for necessary E2E and mutation testing. Exercise affected important journeys through the actual rendered UI, first with deterministic mocked API/model scenarios, then with real Test integration. Target mutations at meaningful guards and state transitions (for example authorization, workspace/version/generation checks, approval/idempotency, quota reservation, and stale-response handling); establish a passing baseline, require relevant tests to reject each valid mutation, restore the source, and inspect survivors. Record the mutation, test outcome, and limitations. Do not count merely adding an error fixture as mutation testing or a source assertion as E2E.

Documentation-only verification covers scope, consistency, links, and an executable-file-free diff; no application test pass is implied.

For independent defensive reviews, follow [RED_TEAM_TESTING.md](RED_TEAM_TESTING.md): verify model acceptance, actual tools and one harmless capability probe before a new delegate batch. Keep model refusals, transport failures, static review, Mock reproduction and live evidence distinct. Save reusable cases and exact results; never use different wording to evade a refusal.

## 5. Evidence classes and blockers

Separate `IMPLEMENTED` from `VERIFIED`. Record automated, live model/database, browser, independent review, and Human UAT evidence distinctly. Human UAT can be `PASS` only after an actual human reports it.

Use `PENDING_ENV` for specific credential/service-dependent verification, not for unrelated work. Record missing configuration names without values and state exactly what must be rerun. Mock success is contract evidence, not proof of live-provider/MCP compatibility. Do not downgrade an acceptance requirement just because its environment is unavailable.

New paid services, external permissions, an unidentified reset target, or a material scope/security tradeoff must be surfaced. Never put credentials, signed URLs, private customer data, or raw sensitive prompts in commits or reports.

## 6. Maintainability and delivery

Prefer maintained stacks and thin adapters. Share domain rules rather than duplicating them per interaction surface. Remove replaced runtime entry points/settings/docs when the relevant replacement is complete; preserve only useful evidence from the assessment.

Use coherent phase/feature PRs and meaningful commits. Keep `PROJECT_STATE.md` and affected docs in the same PR as their changes. Update derived OpenWiki only for material implemented changes, not to present future designs as existing code.

Follow [Git workflow](GIT_WORKFLOW.md). A PR ready for review is not permission to merge or deploy. Squash merge is the default method only when merge has been authorized.
