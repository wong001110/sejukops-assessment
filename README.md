# Sejuk Ops

**Agent-native field-service operations, with a conventional interface when you need it.**

Sejuk Ops is being repositioned from a programmer assessment into a small, demonstrable AI product. The target combines operational records, source-grounded knowledge retrieval, and human-approved actions through shared business capabilities.

> **Direction update only — implementation has not started.**
> This change documents the agreed rebuild. The existing application still implements the assessment baseline: mock identities, a bounded single-tool AI planner, and document-to-order extraction. Real Auth, workspace isolation, the new agent runtime, RAG, and MCP are planned, not delivered. Opening or merging these documents does not authorize implementation or deployment.

## Three ways to interact with one system

| Surface | User experience | Boundary |
| --- | --- | --- |
| Traditional + AI Assist | Navigate familiar records and forms; AI helps with an individual step. | People control the workflow; ordinary server-side rules still apply. |
| Agent Workspace | Describe an outcome; the agent gathers evidence, requests missing information, and proposes the next action. | Guided task starters, activity, citations, and explicit approval; not an empty chat box. |
| External agent through MCP | Access selected capabilities without opening the website. | Authenticated, scoped tools; read/search first, controlled writes as a later extension. |

These are adapters over **one operational core**, not three implementations of the business rules. Agent-native describes the product; **AI-Native Development Practice** describes how we will develop it.

## Agreed foundation

- Supabase Auth, with a private owner sign-in and one-click demo personas rather than public shared administrator passwords.
- One shared **Demo workspace** and a separate **Owner workspace** in the same application/Supabase project. Shared demo data must never grant access to private owner data.
- Platform `SUPER_ADMIN` privileges separate from workspace `ADMIN`, `MANAGER`, and `TECHNICIAN` roles. Sensitive AI configuration and technical observation belong to the platform console.
- Retain useful order/service rules, transactions, audit, and conventional UI. Obsolete assessment features may be replaced or removed when implementation is authorized.
- Use established components: AI SDK for the bounded tool loop, Supabase/pgvector for knowledge storage, existing document parsing plus a text splitter, and Langfuse for AI traces/evaluation. Exact versions and provider compatibility require a future spike.

## First demo story

Select a service order → investigate using operational data and relevant SOP/manual passages → inspect evidence → review a concrete assignment proposal → approve → see the actual result in the conventional interface.

Also demonstrate missing evidence, a stale proposal, shared-demo/private-workspace isolation, knowledge intake, and an authenticated MCP read. The demo must distinguish live integrations from fixtures or scripted examples.

## Read the plan

1. [PROJECT_STATE.md](PROJECT_STATE.md) — current authority, phase status, verification limits, and next handoff.
2. [System specification](docs/SYSTEM_SPEC.md) — accepted target product, boundaries, architecture, and stack decisions.
3. [Rebuild plan](docs/plans/agent-native-rebuild.md) — phased scope, acceptance criteria, risks, and deferred work.
4. [Development protocol](docs/DEVELOPMENT_PROTOCOL.md) and [AGENTS.md](AGENTS.md) — AI-Native Development Practice.
5. [Documentation index](docs/README.md) — distinguishes target documents from historical assessment references.

## Data and removal policy

The owner permits discarding the old Sejuk Ops application dataset and reseeding from scratch. There is no requirement to preserve old demo records or retain unused assessment functionality. This is a **future implementation allowance**, not permission for this documentation PR to reset data, run migrations, delete infrastructure, or change secrets. The new Owner workspace is private and is never part of routine Demo resets.

## Existing application

Source code, dependency manifests, SQL migrations, seed data, and deployment configuration are unchanged by this direction update. [The assessment baseline at commit `8fe1a52`](https://github.com/wong001110/sejukops-assessment/tree/8fe1a52378f1aa2976cab4b6d6b4b9497ab983b3) preserves its README, setup instructions, specifications, and historical verification. Those results do not verify the rebuild.
