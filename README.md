# Sejuk Ops

Sejuk Ops is a workspace-scoped field-service product with **Operations** and **AI Workspace** over shared capabilities. External MCP integration remains deferred. [PROJECT_STATE.md](PROJECT_STATE.md) records implemented behavior and verification limits. The latest real Staff acceptance includes successful manual business flows and live AI failures that still require repair; Human UAT and production readiness are separate.

## Current product model

| Surface | Purpose |
| --- | --- |
| Operations | Review service orders and perform explicit operations with contextual help. |
| AI Workspace | Gather scoped evidence, render adaptive working views and prepare reviewable proposals. |
| MCP (later phase) | Let a verified external client read scoped orders/knowledge and prepare a proposal; consequential execution still requires authenticated Web confirmation. The external endpoint is disabled by default for the website MVP. |

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

The [Demo and local development handoff](docs/DEMO_HANDOFF.md) covers the Test environment, Guest/Owner entry, platform controls, and fresh-installation limits. The [latest Staff acceptance report and videos](reports/staff-live-2026-10-06/index.html) and [English acceptance summary](reports/staff-live-2026-10-06/acceptance-summary.md) record the current browser/API/data evidence and known failures. Previous reports were removed at the owner's request; tracked historical evidence remains accessible through Git history.

Guest entry, Demo-only visits, shared AI allowance, formal Staff onboarding, role isolation and Owner management have scoped evidence in [PROJECT_STATE.md](PROJECT_STATE.md). The latest Staff recording uses the configured live model and retains four fictional Staff accounts, four orders and two published knowledge documents. AI provider reliability remains **REPAIR**; successful recordings and Vercel Preview do not establish production readiness.

## Development authority

- [Product direction](docs/PRODUCT_DIRECTION.md)
- [Architecture and security boundaries](docs/ARCHITECTURE.md)
- [Implementation plan and acceptance IDs](docs/IMPLEMENTATION_PLAN.md)
- [Current progress and evidence](PROJECT_STATE.md)
- [Agent rules](AGENTS.md), [development protocol](docs/DEVELOPMENT_PROTOCOL.md), and [Git workflow](docs/GIT_WORKFLOW.md)
- [Documentation authority and assessment-era references](docs/README.md)

OpenWiki is derived engineering navigation. It does not define product authorization or supply a runtime knowledge base. Historical assessment tests and UAT do not verify the rebuild.
