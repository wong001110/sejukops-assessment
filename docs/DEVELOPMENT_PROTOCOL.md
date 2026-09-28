# AI-Native Development Practice — Sejuk Ops

This protocol replaces the assessment-era fixed-role development protocol. It governs development method, not the product's agent runtime.

## 1. Native-first execution

Use the coding host's existing repository, terminal, test, browser, and delegation capabilities. The Main Agent chooses execution strategy based on task risk and available tools; it may implement directly when authorized or delegate clearly scoped work. Do not build a custom harness, prescribe a permanent multi-agent hierarchy, or require model-capability inventory files merely to begin a documentation task.

Before delegation, verify actual host capabilities. Give the delegate an objective, allowed files, dependencies, constraints, acceptance IDs, and required evidence. Main Agent integrates results and retains acceptance responsibility. Independent review must be real; do not fabricate a separate reviewer when none exists.

Agent Continuity, if used by the host, remains external optional execution-state support. It must not become repo product architecture, a dependency, or a competing roadmap.

## 2. Authority and current state

The latest user instruction and [AGENTS.md](../AGENTS.md) bound authorized work. [PROJECT_STATE.md](../PROJECT_STATE.md) is the single mutable progress authority. Product/architecture/plan documents define the intended outcome; source and evidence determine what actually exists.

The current task is direction documentation and a PR only. P1 begins only after a new implementation request. Permission to discard legacy Sejuk Ops data during that future work does not authorize immediate database changes, nor changes to unrelated resources.

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

Critical authorization, isolation, stale-state, idempotency, quota, and reset boundaries need negative tests. Use targeted mutation/adversarial checks when they test a real invariant, rather than adding a mandatory project-wide mutation framework. Explain skipped/non-applicable checks and compensate for absent review tools with explicit self-review and tests, without calling it independent QA.

Documentation-only verification covers scope, consistency, links, and an executable-file-free diff; no application test pass is implied.

## 5. Evidence classes and blockers

Separate `IMPLEMENTED` from `VERIFIED`. Record automated, live model/database, browser, independent review, and Human UAT evidence distinctly. Human UAT can be `PASS` only after an actual human reports it.

Use `PENDING_ENV` for specific credential/service-dependent verification, not for unrelated work. Record missing configuration names without values and state exactly what must be rerun. Mock success is contract evidence, not proof of live-provider/MCP compatibility. Do not downgrade an acceptance requirement just because its environment is unavailable.

New paid services, external permissions, an unidentified reset target, or a material scope/security tradeoff must be surfaced. Never put credentials, signed URLs, private customer data, or raw sensitive prompts in commits or reports.

## 6. Maintainability and delivery

Prefer maintained stacks and thin adapters. Share domain rules rather than duplicating them per interaction surface. Remove replaced runtime entry points/settings/docs when the relevant replacement is complete; preserve only useful evidence from the assessment.

Use coherent phase/feature PRs and meaningful commits. Keep `PROJECT_STATE.md` and affected docs in the same PR as their changes. Update derived OpenWiki only for material implemented changes, not to present future designs as existing code.

Follow [Git workflow](GIT_WORKFLOW.md). A PR ready for review is not permission to merge or deploy. Squash merge is the default method only when merge has been authorized.
