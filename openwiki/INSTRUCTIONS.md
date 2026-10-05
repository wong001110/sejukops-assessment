# OpenWiki Instructions for SejukOps

OpenWiki is used here as a **coding/development knowledge layer** for AI-assisted engineering. It is not part of the SejukOps runtime product and must not be presented as a RAG feature of the assessment application.

## Repository-native Adoption

SejukOps adopts the OpenWiki development concept without adding LangChain, the OpenWiki CLI, or another documentation generator to the application dependency tree.

- committed Markdown under `openwiki/` is the durable knowledge layer
- `openwiki/index.md` is the navigation entry point
- coding agents may maintain the pages directly from verified specifications, source code, tests, and accepted verification evidence
- no LLM provider is required or implied by this repository structure
- never send repository content to an external model merely to refresh these pages without explicit human approval
- generated tooling may be evaluated separately later, but the documentation format must remain useful without it

The intended outcome is living, traceable repository knowledge—not a runtime framework integration.

## Authoritative Sources

Treat `AGENTS.md`, `PROJECT_STATE.md`, `docs/PRODUCT_DIRECTION.md`,
`docs/ARCHITECTURE.md`, `docs/IMPLEMENTATION_PLAN.md`,
`docs/DEVELOPMENT_PROTOCOL.md`, and `docs/GIT_WORKFLOW.md` as the active
rebuild authority. Inspected source, migrations, and actual test results describe
implementation evidence. `docs/README.md` labels assessment-era references.

OpenWiki-generated documentation is derived context. Do not reinterpret generated wiki text as higher authority than explicit accepted specifications or verified code/tests.

## Prioritise These Topics

Maintain concise navigation for the current workspace actor and platform-role
boundaries, order capabilities, proposal approval, knowledge publication and
indexing, bounded AI runtime, MCP bearer and tool adapters, Demo budget/reset,
document intake, and real verification evidence. Mark historical assessment
behavior as historical. Never present retired routes or tables as active.

## Development Protocol Awareness

When documenting implementation progress, distinguish clearly between:

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

Do not describe a TODO, planned design, mock path, or `PENDING_ENV` integration as completed production behavior.

Use `PROJECT_STATE.md` for current progress and evidence. Historical checklist
and test logs do not accept rebuild phases.

## Git / PR Awareness

The Main Agent owns PR scope.

Remember:

- every phase or major feature is integrated through a PR
- small tasks are grouped into their owning phase/feature PR
- sub-agent count does not determine PR count
- accepted implementation uses Squash and Merge into `main`
- feature branches should not continue as the basis for future work after squash merge
- checklist and verification evidence should normally ship in the same PR as the work they describe
- meaningful OpenWiki updates should normally be included in the same stabilised phase/feature PR where practical

Do not describe unmerged branch work as accepted `main` behaviour.

## Environment Awareness

Do not copy secret values or local environment state into generated committed documentation.

The following files are intentionally local/gitignored:

```text
.agent/model-capabilities.local.md
.agent/environment-status.local.md
```

Committed environment definitions live in `docs/ENVIRONMENT_REQUIREMENTS.md`.

## Agent Architecture Awareness

The Main Agent is the Project Orchestrator / Technical Lead / Acceptance Owner.

Implementation work may be delegated to scoped sub-agents based on current local model capabilities, reasoning needs, risk, and cost. Avoid documenting a sub-agent as having authority to redefine global architecture.

Independent QA and Agent E2E are separate verification roles. Human UAT is a separate evidence class and cannot be inferred from agent testing.

## Testing Knowledge

Capture verification groups and their relationships rather than implying that the full test suite should run after every small change.

Important concepts:

- targeted implementation checks
- feature-batch gates
- cross-module integration gates
- phase gates
- full release regression
- deterministic seed/golden manifest reuse
- failure injection for integrations and AI runtime behavior

When a feature changes, help agents identify the smallest relevant verification group(s) before recommending broader regression.

## UI/UX Knowledge

Frontend documentation should include more than component/file names. Preserve relevant knowledge about:

- Ant Design for the current Traditional, Agent, Demo, and Owner surfaces
- familiar modern internal SaaS/operations visual conventions
- responsive behavior
- phone-first Technician constraints
- loading/empty/error/success states
- transitions and purposeful micro-interactions
- reduced-motion behavior
- visual QA expectations

## Update Cadence

Refresh OpenWiki after meaningful events such as:

- phase completion
- architecture change
- major module implementation
- significant change in important source locations or data flow

Avoid treating every trivial styling/copy edit as requiring a full wiki refresh.

## Conflict Handling

If generated understanding conflicts with explicit specs or verified implementation:

1. flag the conflict
2. verify the relevant source/spec
3. prefer the authoritative source
4. update generated documentation on the next appropriate OpenWiki refresh
