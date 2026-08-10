# SejukOps Agent Development Rules

This file is the mandatory entry point for any AI coding agent working in this repository.

## 1. Main Agent Role

The Main Agent is the **Project Orchestrator / Technical Lead / Acceptance Owner**.

Its primary responsibilities are:

- preserve product and architecture direction
- understand current project state and dependencies
- decompose work into bounded tasks
- select appropriate models/reasoning levels for delegated work
- dispatch implementation, QA, and E2E agents only when justified
- integrate cross-module work
- decide whether evidence is sufficient to accept a task or feature
- maintain implementation progress and verification records

The Main Agent should avoid spending most of its context on isolated implementation work. It may make small edits, wiring changes, configuration fixes, or merge-conflict resolutions when delegation would add more overhead than value.

The Main Agent is the final **development acceptance** authority, but it is not a substitute for Human UAT.

## 2. Mandatory Bootstrap

Before substantial implementation or delegation:

1. Read this file.
2. Inspect the models, reasoning levels, tools, browser/vision capabilities, and execution environment currently available.
3. Create or refresh `.agent/model-capabilities.local.md`.
4. Create or refresh `.agent/environment-status.local.md`.
5. Read `docs/IMPLEMENTATION_CHECKLIST.md`.
6. Read the relevant product/system specifications.
7. Read `docs/UI_STACK.md` before frontend/UI work.
8. Consult `openwiki/` when generated knowledge is available.
9. Verify any important OpenWiki claim against the relevant source code/spec before changing behavior.
10. Classify the requested task by scope, risk, capability requirement, and dependencies.
11. Decide whether the Main Agent should implement directly or delegate to a bounded sub-agent.

Local `.agent/*.local.md` files are intentionally gitignored and must never contain secret values.

## 3. Model Capability Inventory Is Required Before Delegation

No sub-agent may be delegated work until `.agent/model-capabilities.local.md` exists and reflects the current execution environment.

The inventory must record only capabilities that can be observed or are explicitly exposed by the host/environment. Unknown capabilities must be marked `unknown`; do not invent model capabilities.

Suggested fields per model:

```text
Model ID / display name
Available reasoning levels
Code generation
Repository analysis
Tool calling
Browser
Vision
Long-context
Known constraints
Best-fit task types
```

## 4. Sub-agent Selection

Sub-agents are **not** spawned by default.

For each candidate task, the Main Agent evaluates:

```text
Task scope
+ implementation complexity
+ product/architecture risk
+ required capabilities
+ required reasoning level
+ dependency state
+ expected cost/latency
→ execution strategy
```

Use the least expensive / lowest-reasoning model that can reliably satisfy the task's quality and risk requirements.

Possible scoped roles include:

- Frontend / UIUX Implementation Agent
- Backend / Data Agent
- AI Integration Agent
- Infrastructure Agent
- QA Agent
- E2E / User Simulation Agent

These are role templates, not always-running agents.

Every delegated task must include:

- role
- goal
- allowed scope/files
- relevant specs
- dependencies
- acceptance criteria
- required verification
- explicit non-goals

Sub-agents may not redefine architecture or product scope without returning the issue to the Main Agent.

## 5. Reasoning Routing

Reasoning level is part of task routing rather than a global setting.

Typical guidance:

| Task type | Typical reasoning |
|---|---|
| Copy, isolated styling, tiny UI state | Low |
| Straightforward CRUD / component work | Medium |
| Cross-module feature | High |
| DB schema / state transition / authorization | High |
| AI orchestration / provider routing | High |
| Complex root-cause debugging | High / highest justified |
| Security-sensitive change | High / highest justified |
| Final architecture review | High / highest justified |
| Routine E2E execution | Medium |

Use available host-specific reasoning names rather than assuming these exact labels exist.

## 6. Acceptance Chain

A coding agent saying "done" is not sufficient evidence.

Preferred chain:

```text
Implementation Agent
        ↓
Targeted automated checks
        ↓
Independent QA Agent
        ↓
Agent E2E / real usage test when required
        ↓
Main Agent integration + spec acceptance
        ↓
Development Accepted
        ↓
Human UAT (when required/available)
```

The implementation agent should not be the sole authority accepting its own work.

Where multiple suitable models are available, prefer a different model for independent QA when practical. If only one model is available, use a clean independent QA context/role.

## 7. Human UAT Is a Separate Evidence Class

Allowed Human UAT states:

```text
NOT_RUN
PASS
FAIL
BLOCKED
```

An agent must never mark Human UAT as `PASS` unless a human actually performed the test and reported the result.

Keep automated, Agent E2E, and Human UAT evidence separate.

## 8. Environment Dependencies

Read `docs/ENVIRONMENT_REQUIREMENTS.md` before environment-dependent integration work.

When a required environment value is missing:

- record it in `.agent/environment-status.local.md`
- mark only dependent verification/integration work `PENDING_ENV`
- continue unrelated implementation
- use mocks/contract tests where appropriate
- record exactly which tests must be re-run after the human supplies the value

Missing credentials should not block unrelated development.

Agents must never place secret values in committed Markdown, source files, logs, screenshots, test fixtures, or issue text.

## 9. Test Scheduling

Do **not** run the broadest test suite after every small task.

Use the smallest verification scope that provides sufficient confidence:

- **L0 Targeted Check** — affected lint/type/unit/component checks
- **L1 Feature Batch Gate** — related tasks tested together once they form a usable feature slice
- **L2 Cross-module Integration Gate** — integration between dependent modules
- **L3 Phase Gate** — broader QA + relevant E2E at phase completion
- **L4 Full Regression / Release Gate** — major architecture change, deployment candidate, or final submission

The Main Agent owns test scheduling and verification-group selection.

See `docs/DEVELOPMENT_PROTOCOL.md` and `docs/testing/TEST_MATRIX.md`.

## 10. Frontend / UIUX Quality

The authoritative UI technology decision is `docs/UI_STACK.md`.

Use:

- **Ant Design** for Admin and Manager desktop-oriented portals
- **Ant Design Mobile** for the Technician mobile-first portal
- shared project design tokens/CSS variables and limited project CSS where needed

Do not introduce Tailwind CSS as a second primary styling system unless the project owner explicitly changes the UI technology decision.

Frontend implementation is not complete when JSX renders successfully.

The Frontend / UIUX Agent owns:

- responsive layout
- touch-friendly mobile behavior
- loading and skeleton states
- empty states
- error states
- validation feedback
- hover/focus/disabled states
- transitions and purposeful micro-interactions
- navigation continuity
- reduced-motion behavior where applicable
- accessibility basics
- real browser/visual verification

Motion should communicate state change, hierarchy, feedback, or navigation continuity. Avoid decorative animation that slows field workflows.

Technician flows receive special attention on phone-sized viewports.

## 11. OpenWiki Usage

OpenWiki is a **derived codebase knowledge layer**, not the authority over explicit specs, tests, or source code.

Priority when conflicts exist:

1. explicit product/system specifications and accepted architecture decisions
2. verified source code + tests
3. OpenWiki-generated interpretation

Update OpenWiki after meaningful phase completion, architectural changes, or major module additions rather than after every trivial edit.

Repository-specific OpenWiki guidance lives in `openwiki/INSTRUCTIONS.md`.

## 12. Definition of Done

A task or feature is complete only when its required evidence gates are satisfied.

Possible states include:

```text
TODO
IN_PROGRESS
IMPLEMENTED
PENDING_ENV
QA_PENDING
E2E_PENDING
HUMAN_UAT_PENDING
VERIFIED
BLOCKED
```

`IMPLEMENTED` is not equivalent to `VERIFIED`.

Update `docs/IMPLEMENTATION_CHECKLIST.md` and `docs/testing/VERIFICATION_LOG.md` as work progresses.