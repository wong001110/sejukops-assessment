# Sejuk Ops

**Agent-native field service operations, with traditional controls and evidence-backed assistance.**

Sejuk Ops is being redirected from an assessment into a small, demonstrable AI product. The intended product combines an existing operational core with knowledge retrieval, a guided Agent Workspace, and an external MCP interface.

> **Direction update only — implementation of the rebuild has not started.**
> This documentation change does not add Auth, workspace isolation, RAG, an agent runtime, or MCP to the running application. It does not reset data or authorize deployment. See [PROJECT_STATE.md](PROJECT_STATE.md) before starting any work.

## Product direction

One operational system, three interaction surfaces:

| Surface | Who drives the workflow? | Intended experience |
| --- | --- | --- |
| Traditional + AI Assist | The user | Navigate records and forms; use AI for a bounded contextual task. |
| Agent Workspace | The user supplies an outcome; the agent coordinates permitted steps | Discover supported tasks, gather evidence, review a proposal, and approve consequential changes. |
| External agent through MCP | An authenticated external client | Use the same business capabilities without needing to navigate the website. |

These are not separate backends or different permission systems. Domain rules, workspace boundaries, proposals, and audit records are shared.

The primary demonstration is a service order investigation: operational records + relevant knowledge → cited findings → a concrete proposal → authorized execution. Document intake is a second demonstration, with **document-to-order extraction** kept distinct from **document-to-knowledge ingestion**.

## Accounts, workspaces, and administration

The target is one application deployment and one Supabase project, with two logically isolated workspaces:

- **Shared Demo**: fictional records that visitors may collaboratively change, with restricted AI usage and an explicit reset policy.
- **Private Owner**: the owner's operational records, knowledge, conversations, and experiments, inaccessible to demo visitors.

Platform `SUPER_ADMIN` privileges are separate from workspace `ADMIN`, `MANAGER`, and `TECHNICIAN` roles. Provider credentials, model routing, technical AI observations, and sensitive system controls belong to platform administration, not public Demo Admin access.

## Existing implementation versus planned work

The source baseline is commit `8fe1a52378f1aa2976cab4b6d6b4b9497ab983b3`. It contains the assessment's operational portals, application/database rules, audit paths, document-to-order extraction, and bounded Operations AI. Its mock role switching is not the planned real authentication system; its document extraction is not a knowledge base.

The existing implementation remains unchanged by this PR. Historical release and UAT evidence must not be presented as verification of the redesign.

Existing data need not be preserved or migrated into the new product. The owner accepts a clean Sejuk Ops data baseline and replacement/removal of unnecessary assessment features during later authorized implementation. **No data is deleted by this direction update.**

## Read next

- [Product direction and scope](docs/PRODUCT_DIRECTION.md)
- [Target architecture and security boundaries](docs/ARCHITECTURE.md)
- [Phased plan and acceptance criteria](docs/IMPLEMENTATION_PLAN.md)
- [Current execution state](PROJECT_STATE.md)
- [AI-Native Development Practice](docs/DEVELOPMENT_PROTOCOL.md)
- [Agent entry point](AGENTS.md) and [PR workflow](docs/GIT_WORKFLOW.md)
- [Documentation authority and legacy references](docs/README.md)

## Technology direction

Retain Next.js, TypeScript, Ant Design / Ant Design Mobile, Supabase PostgreSQL, and private Storage where useful. Prefer AI SDK as the single agent runtime; reuse document parsing, established text splitters, pgvector, and an existing observation/evaluation platform rather than rebuilding infrastructure. Exact packages, versions, provider compatibility, and MCP hosting/auth integration require implementation-time verification. LangChain utilities may be used selectively; a second agent runtime and LangGraph are not baseline requirements.

## Running the current baseline

The existing package manifest and environment example remain unchanged:

```sh
pnpm install
cp .env.example .env.local
pnpm dev
```

Configure [.env.example](.env.example) using server-side secrets. These commands run the existing application, not the planned redesign. Do not interpret legacy database setup instructions as permission to reset a connected project.

Existing verification commands include `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`. Future implementation uses proportionate verification rather than running the full suite for every edit.

The [pinned assessment README](https://github.com/wong001110/sejukops-assessment/blob/8fe1a52378f1aa2976cab4b6d6b4b9497ab983b3/README.md) preserves the original setup, routes, and historical delivery evidence.
