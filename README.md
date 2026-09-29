# Sejuk Ops

Sejuk Ops is being rebuilt as a workspace-scoped field-service product with Traditional + AI Assist, a guided Agent Workspace, and a remote MCP adapter over shared capabilities. [PROJECT_STATE.md](PROJECT_STATE.md) records what has actually been implemented and verified. The P1–P6 rebuild is **in progress**; no phase is accepted and production deployment has not been authorized.

## Current product model

| Surface | Purpose |
| --- | --- |
| Traditional + AI Assist | Review service orders and perform explicit operations with contextual help. |
| Agent Workspace | Gather scoped evidence and prepare reviewable proposals. |
| MCP | Let a verified external client read scoped orders/knowledge and prepare a proposal; consequential execution still requires authenticated Web confirmation. |

The current interface uses Ant Design for its workspace shell, forms, feedback, and task cards. Document-to-order intake is a separate review flow: extraction proposes fields, and an Admin explicitly confirms before the customer and order are created.

One operational core enforces roles, workspace isolation, current data generation, and proposal state for every surface. Demo records are shared only within Demo; Owner records and platform credentials are separate. `SUPER_ADMIN` is a platform role, not a substitute for workspace membership. One-click Guest entry to the operational Demo and in-workspace perspective switching are implemented locally, with no visitor account and a single daily AI allowance shared by all Guest visits. Production readiness is still in progress.

The new workspace source lives under `src/app/workspaces/`, actor resolution under `src/lib/auth/`, shared operations under `src/lib/services/workspace-orders/` and `src/lib/capabilities/`, knowledge under `src/lib/services/workspace-knowledge/`, and the MCP adapter under `src/lib/mcp/`. Older assessment Admin/Manager/Technician business routes and mock role switching were retired from runtime. The historical baseline remains at [commit 8fe1a523](https://github.com/wong001110/sejukops-assessment/tree/8fe1a52378f1aa2976cab4b6d6b4b9497ab983b3).

## Run locally

Use Node.js 22+ and pnpm. The repository's [.env.example](.env.example) lists required local variables; keep service credentials server-side and out of commits.

```sh
pnpm install
pnpm dev
```

Useful checks are `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build`. Run focused checks while editing and the broad gate before phase acceptance. A build or mock test is not proof of live Auth, provider, browser, MCP-host, or Human UAT behavior.

The [Demo and local development handoff](docs/DEMO_HANDOFF.md) covers the already prepared Test environment, Guest/Owner entry, platform controls, and the current fresh-installation limitation.

The Guest entry, Demo-only visit, and one shared AI allowance have local and Test-project verification recorded in [PROJECT_STATE.md](PROJECT_STATE.md). A live paid Guest model call remains unverified. The permanent Owner password account was created without an invitation email; its browser login remains unverified. Do not treat a local Demo form or Vercel Preview as production readiness.

## Development authority

- [Product direction](docs/PRODUCT_DIRECTION.md)
- [Architecture and security boundaries](docs/ARCHITECTURE.md)
- [Implementation plan and acceptance IDs](docs/IMPLEMENTATION_PLAN.md)
- [Current progress and evidence](PROJECT_STATE.md)
- [Agent rules](AGENTS.md), [development protocol](docs/DEVELOPMENT_PROTOCOL.md), and [Git workflow](docs/GIT_WORKFLOW.md)
- [Documentation authority and assessment-era references](docs/README.md)

OpenWiki is derived engineering navigation. It does not define product authorization or supply a runtime knowledge base. Historical assessment tests and UAT do not verify the rebuild.
