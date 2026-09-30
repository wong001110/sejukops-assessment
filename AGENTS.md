# Sejuk Ops — Agent Development Rules

This is the mandatory entry point for work in this repository.

## 1. Current authorization

The owner authorized phased P1–P6 rebuild development on 2026-09-28 after direction PR #35 merged. P1 is active. The current execution state and exact resource boundary are recorded in [PROJECT_STATE.md](PROJECT_STATE.md).

Develop the authorized phases through scoped PRs with evidence. Confirm the exact resource before any destructive database action. Production deployment remains a separate decision.

The owner accepts discarding old Sejuk Ops application data and replacing unnecessary assessment functionality during the authorized rebuild. The confirmed P1 Supabase project is recorded in `PROJECT_STATE.md`. This does not extend to unrelated projects or production deployment.

## 2. Bootstrap and authority

Read in order:

1. The latest explicit user instruction and this file.
2. [PROJECT_STATE.md](PROJECT_STATE.md), the only mutable rebuild progress authority.
3. [Product direction](docs/PRODUCT_DIRECTION.md).
4. [Target architecture](docs/ARCHITECTURE.md).
5. [Implementation plan](docs/IMPLEMENTATION_PLAN.md).
6. [Development protocol](docs/DEVELOPMENT_PROTOCOL.md) and [Git workflow](docs/GIT_WORKFLOW.md).
7. Relevant source, tests, and current official dependency documentation when implementation is authorized.

[docs/README.md](docs/README.md) distinguishes active direction from assessment-era references. In particular, the old `docs/SYSTEM_SPEC.md`, `docs/IMPLEMENTATION_CHECKLIST.md`, and historical test/UAT logs do not define the new scope or prove it complete. OpenWiki is derived navigation, not runtime knowledge or a source of authorization.

Specifications describe intended behavior; inspected source and execution evidence describe actual behavior. Never erase that distinction to make the project appear complete.

## 3. AI-Native Development Practice

Use native host capabilities first. The Main Agent owns scope, integration, verification choices, and phase acceptance. It may implement directly when authorized; it is not limited to delegating implementation.

Use sub-agents only when tools actually provide them and a bounded task benefits from independent context or parallelism. Do not invent agents, model availability, reasoning controls, QA results, or required local harness machinery. Before delegation, inspect actual capabilities and provide scope, dependencies, non-goals, acceptance criteria, and verification requirements.

Phases may be split, combined, or reordered based on evidence. Preserve the accepted outcome and acceptance IDs, explain meaningful changes, and keep `PROJECT_STATE.md` current. Do not request approval for routine in-scope implementation decisions after implementation is authorized; ask only for genuinely new scope, material tradeoffs, unavailable external authority, or destructive actions outside the recorded permission.

Agent Continuity is an optional environment-side aid, not this development methodology. Do not add its database, runtime, manifests, hooks, or CI to this repo.

## 4. Product and safety boundaries

- One operational core serves Traditional + AI Assist, Agent Workspace, and MCP.
- Services receive a server-resolved actor and workspace, not a model-selected identity or browser-cookie dependency.
- Demo data is shared within Demo only. Owner data, conversations, documents, caches, and credentials remain isolated.
- Platform `SUPER_ADMIN` is separate from workspace roles. Business operations still use an explicit workspace and permission checks.
- Consequential AI actions execute a persisted, concrete, authorized proposal; approval does not waive current-state checks.
- Retrieved/uploaded content is untrusted data, not instructions or authority to use tools.
- Prefer established libraries and adapters; do not stack AI SDK, LangChain agents, and LangGraph without a demonstrated need.
- Keep a single bounded agent runtime. No arbitrary SQL, shell, unrestricted network tools, or generated executable UI.
- Keep secrets server-side and out of commits, logs, screenshots, model context, and public diagnostics.
- Replaced assessment functionality must eventually be removed from runtime, entry points, settings, and active documentation, not merely hidden in navigation.

Detailed acceptance boundaries live in the architecture and plan, rather than being duplicated as another checklist here.

## 5. Verification and acceptance

Batch related changes into meaningful slices. Do not commit or run full regression after every small edit. Start with relevant contract/unit/static checks; expand to integration, real-browser, live-provider, or broad regression checks when risk and shared impact require them.

Every implementation phase needs evidence and a Main Agent decision: `PROCEED`, `REPAIR`, or `BLOCKED`. Security-sensitive auth, isolation, approval, and reset boundaries require negative tests and independent review where available. Use targeted mutation/adversarial tests where they provide evidence; document the rationale when a gate is not applicable or unavailable.

Do not weaken acceptance to make tests pass. Report mock, live-provider, browser, and human evidence separately. Human UAT is `PASS` only after a human reports it. Missing credentials block only dependent checks and must be recorded honestly; a mock does not validate live integration.

For documentation-only work, validate scope, cross-references, consistency, and the diff. Application build/test execution is not required when no executable behavior changes, and must not be claimed as performed.

## 6. Delivery

Use one coherent phase/feature branch and PR, not one PR per tiny edit or sub-agent. Update state and relevant docs in the owning PR. After accepted and authorized integration, use squash merge and begin subsequent work from updated `main`. Production deployment remains separate from development acceptance.
