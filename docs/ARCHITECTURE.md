# Sejuk Ops — Target Architecture

Status: direction only. No components described here are added by the documentation PR unless explicitly identified as existing baseline behavior.

## 1. Shared application boundary

```text
Traditional UI + AI Assist       Guided Agent Workspace       External MCP client
            |                            |                           |
     Web request/session          Web request/session         MCP authentication
            |                            |                           |
            +---------------- server-resolved actor ----------------+
                                         |
                         Shared business capabilities
                                         |
                  Operations | Knowledge | Proposals | Audit
                                         |
                         Supabase PostgreSQL / Storage

Platform administration is a separately authorized surface.
AI SDK coordinates internal tools; MCP exposes adapters to the same capabilities.
```

Keep one Next.js deployment and one Supabase project as the target footprint. Add services only for an evidenced requirement. Do not build another REST backend merely to wrap existing in-process services.

The current Operations portal and AI Workspace have separate client interactions.
Operations uses manual business forms, scoped read-only Ask AI, and on-demand
dashboard highlights. Technician knowledge/own-job highlights do not grant general
order agent access. AI Workspace retains bounded tool orchestration and guarded
proposal confirmation; its Conversation panel overlays rather than narrows the
canvas. Both surfaces use server-resolved scope. Dashboard event analytics read
private audit aggregates through a signed-in, generation-checked RPC; raw private
audits are not exposed. See current implementation evidence in PROJECT_STATE.md.

### Actor resolution

Resolve the caller and selected workspace on the server: permanent Auth user/profile/membership for Owner and MCP, or a validated, short-lived Guest visit bound to Demo and a business persona for public Web use. Business services receive an explicit actor context and must not infer authority from a browser field, a model argument, or mere possession of a cookie.

Inputs such as `workspaceId`, `profileId`, `role`, `technicianId`, or `approved` from a model/client are untrusted requests, not authority. Check membership and resource ownership independently. Effective permissions intersect business role, workspace/demo policy, and delegated credential scope. Platform capabilities are explicitly granted rather than inferred from a workspace role.

MCP and web may share actor resolution logic without sharing or forwarding every token. Supabase web login alone does not implement a complete remote-MCP OAuth flow.

## 2. Auth and workspace isolation

Use Supabase Auth for the permanent Owner account. Guest entry requires no visitor Supabase Auth account, email, or password. The application issues an unguessable, opaque, short-lived Guest visit in an HttpOnly/SameSite cookie and validates it server-side; it fixes the workspace to Demo and binds a permitted business persona. Entry starts as Demo Admin; the Guest can switch persona inside the workspace. Rotate or revoke visits when appropriate; expired or reset-era visits fail closed. Guest writes require origin/CSRF defenses. Optional typed names are display-only. Do not give browsers a shared Supabase credential or promote a Guest visit into an Owner/platform actor. Local and Test-project Guest verification is recorded in [PROJECT_STATE.md](../PROJECT_STATE.md); production entry remains a separate release gate.

Current business RPCs and RLS depend on `auth.uid()` and membership rows. A Guest adapter must therefore use narrowly authorized Demo-only operations with explicit server-resolved visit, workspace, persona, and resource checks; a service credential alone must never grant a caller arbitrary database access. MCP remains separately authenticated and is not a public Guest transport.

A minimal model contains profiles/auth linkage, platform privileges, workspaces, and memberships. Scope mutable operational data, KB sources/versions/chunks, proposals, conversations, ingestion jobs, audit/observation records, and storage metadata by workspace. Every dependent record must have a provable workspace relationship, whether directly stored or enforced through its parent.

Review the whole data path, not only service `WHERE` clauses: database/RPC authorization, foreign keys, lookup options, joins, aggregate functions, unique keys, query/model caches, signed file URLs, background jobs, and retrieval filters. Customer phone deduplication and other business uniqueness must not accidentally merge Owner and Demo records.

Enable and verify appropriate RLS on exposed tables. Privileged service-role and security-definer paths require explicit actor/workspace checks; do not claim RLS protects requests that bypass it. Never accept a supplied actor ID simply because an RPC's caller has a server credential. Narrow grants and test both allowed and forbidden paths.

Super Admin selects a workspace before business actions. Global provider management and cross-workspace technical diagnostics use separate platform-authorized functions. Owner assignment does not make a Manager able to assign technicians. New workspace role capabilities require an explicit policy decision, not a convenient tool override.

Rendering/caching must not mix Owner or Guest visits. Sensitive state changes recheck current authority; Guest persona changes must be server-validated and must not affect another visit. Logout, role changes, expired visits, and Demo reset must not leave prior authority implicitly available.

## 3. Demo policy

### Staff and Owner inspection extension

The [staff access contract](STAFF_ACCESS.md) extends permanent Auth to ordinary staff. Business readiness and authenticated-session cutoff are server-controlled database state, checked by API resolution, business RLS and definer entry points. Role changes and revocation must not depend on JWT role metadata or UI controls. Account provisioning uses a durable idempotent ledger because Auth and application SQL cannot commit atomically.

Owner inspection preserves the actual Owner identity and uses bounded database reads for effective role/employee scope. Its explicit preview context denies all workspace writes and mutation-capable AI calls; selecting a Technician is not an impersonated login. Audit retains actual Owner and effective employee. Global administration continues through its separate platform gate.

Public visitors share Demo operational records; mutations are explicitly labeled as shared and resettable. Use only fictional inputs. Explain that publishing a demo KB document makes it available within the shared demo; avoid soliciting personal/confidential uploads.

Keep conversations and unpublished intake drafts scoped to a Guest visit, or disable their persistence for Guest. Public users see safe business evidence and action progress, not another visit's private content or privileged traces. Technician perspectives need a server-controlled mapping to fictional seeded technicians. Audit records identify Guest action and a visit correlation value, without claiming the typed display name proves a real person. A shared database principal, if used behind the server, does not make all its private drafts visible to every visitor.

Use one persistent, atomic, global daily Guest AI allowance across Agent, Assist, extraction, embedding, and any other paid model entry point. Count one unit for each outbound paid-model request, including every step of a multi-call run; reserve immediately before each attempt and conservatively keep the unit if the provider fails or the attempt is canceled after dispatch. Fail closed when exhausted, including across concurrent instances and when Super Admin lowers the limit mid-day. Super Admin can view and adjust a bounded limit; show the remaining units and the next reset at midnight in `Asia/Kuala_Lumpur`. Bound provider/model choice and tokens per request so a call-count ceiling also bounds spend. Browsing and ordinary non-AI Demo writes do not consume this allowance. Do not treat a per-visit name, cookie, or expected low traffic as a spending control. Independent request-size, concurrency, tool-step, file-type, and security limits still protect the service; they are not per-visitor product quotas.

Reset is a Super Admin operation scoped to Demo. Invalidate pending proposals, Guest visit state tied to the old dataset, and in-flight work using a dataset generation/version; coordinate cancellation/leases, clear temporary data, and reseed deterministically. A callback from before reset must not repopulate the new dataset. Preserve platform credentials and Owner data. Manual reset is the initial requirement; a scheduled reset is a later configured operation, not a background task started by this PR.

## 4. Capabilities and internal runtime

Keep reusable application services with explicit actor context. Define shared validation contracts and adapt them to UI, AI SDK tools, and MCP tools. Do not build a generic plugin registry merely to avoid several small adapters. Adapter-specific descriptions/transport metadata may differ without duplicating domain rules.

Candidate capabilities include scoped order lookup/search, service history, workload/schedule queries, knowledge search, document intake preparation/status, and proposal preparation/execution. Final names and schemas follow source inspection and the chosen demo; they are not frozen code APIs.

Use AI SDK as the preferred single internal agent runtime. Replace the one-tool JSON planner and custom loop plumbing where superseded, while preserving relevant provider security, error normalization, routing, and useful deterministic output checks. An OpenAI-compatible endpoint is not automatically proven to support the chosen streaming/tool/structured-output behavior.

Bind actor/workspace permissions and budgets for the run and revalidate at execution. Use a bounded tool set, limits, timeouts, cancellation, and constrained result sizes. The model may gather evidence and propose actions; it cannot expand permissions, disable checks, choose arbitrary endpoints, or call raw SQL/shell tools.

Agent Workspace receives actual structured events. Render fixed record/evidence/proposal components, loading/empty/error/cancel states, and clear handoff to conventional pages. AI Assist invokes bounded tasks over the same capabilities without automatically adopting a whole autonomous workflow.

## 5. Persisted proposals and writes

A proposal stores its workspace, initiating actor, action type, concrete canonical payload, target record/version, relevant evidence references, expiry, dataset generation, and status. The human sees exactly what will change. Sensitive side effects such as updating an existing customer's details during order creation must be represented in that preview, not hidden behind a friendly action name.

The investigation can finish after saving a proposal; no long-running agent is required while waiting for approval. Execute through a deterministic service after confirmation. Recheck permission, workspace ownership, target state/version, expiry, current availability when supported, and dataset generation. Use atomic state transitions and idempotency so retries cannot create duplicate actions. Changed payloads require a fresh preview/approval.

Persist audit with the mutation or an equivalently reliable transactional mechanism. Identify initiator, approver, execution source/client, proposal, target, and outcome without storing secrets. Manual actions and AI actions must observe the same domain rules. Existing human form submission remains a valid explicit confirmation; not every ordinary edit needs an artificial agent proposal.

The approval channel must be trustworthy. A model-generated `approved=true`, an echoed token, or possession of the normal tool credential alone does not prove a human reviewed the proposal. Keep approval outside the unrestricted tool loop. For a client that cannot provide an adequately trusted confirmation path, expose reads/proposals only or use an explicit authenticated confirmation flow and disclose the limitation.

## 6. Knowledge and documents

Reuse private Storage and parsing where appropriate, but keep operational-document drafts separate from KB publication. Metadata extracted by AI is a suggestion with uncertainty, not authoritative truth.

A minimal knowledge lifecycle separates publication (`DRAFT`, `PUBLISHED`, `ARCHIVED`) from indexing (`PENDING`, `PROCESSING`, `READY`, `FAILED`). Only authorized `PUBLISHED` + `READY` versions participate in retrieval. Index replacement must not mix embeddings from incompatible models or leave partially published versions searchable. A failed replacement preserves the previous active version; workers started before a Demo reset cannot publish afterward.

Start with Markdown and text-native PDF, bounded file/text sizes, reusable parsing, established splitting, a separately configured embedding model, and pgvector. Store source/version/chunk IDs plus reliable page or section references. Preserve exact source text for inspection. No fabricated page numbers or source links.

Authorization and publication/version filtering occur in retrieval before results reach the model. Vector similarity alone is not a trust score; citations must both resolve to an allowed source and support the claim. Evaluate evidence sufficiency, unsupported answers, and Chinese/English retrieval behavior separately from interface language. A full UI localization system is not added merely to claim cross-language retrieval.

Use simple retrieval first. Evaluate exact identifiers/error codes and a baseline before introducing hybrid search or reranking. Detect exact duplicates; review uncertain version replacement. Superseded or deleted content must not remain searchable through stale chunks/caches.

Ingestion should use deterministic application steps rather than a model controlling each parser/embedding call. Reuse a managed job primitive only if measured document processing exceeds safe request execution. Expose job state and safe retry; do not keep an HTTP request open indefinitely or add a general workflow engine by default.

Retrieved files may contain prompt injection. Treat their contents as evidence only; never let them change tool scope, actor context, publication policy, or approval.

## 7. MCP boundary

Serve a standards-based remote MCP adapter over the same capability services. Prefer a maintained SDK/Next.js-compatible adapter after compatibility verification. Do not duplicate the domain implementation or require every internal tool invocation to round-trip through MCP.

Expose business operations rather than tables. A small initial surface supports order lookup/search, knowledge retrieval, and proposal inspection. Read tools can be orchestrated by an external model without an additional internal LLM call. A server-side investigation tool is optional and must disclose its extra model usage/budget.

Use authenticated, scoped credentials with validated issuer/audience/expiry and active workspace access. Remote OAuth/discovery, consent, and token lifecycle are a separate integration task, not solved by adding a login screen. Use established auth infrastructure rather than inventing OAuth. A scoped demo token can test clients that explicitly support it but does not prove generic ChatGPT compatibility.

Deliver and verify read/proposal support first. The intended next milestone is at least one approved write using the same proposal executor, state checks, and audit. Do not label the MCP integration write-capable until that path has passed a real client test. Keep unsupported clients read-only rather than weakening authorization.

Attachment transfer is also client dependent: do not assume ChatGPT-uploaded bytes automatically reach a remote server. Start with already staged document IDs or an explicitly supported scoped upload mechanism. External document upload/publication is not required for the first read milestone. No arbitrary URL fetch is exposed as a shortcut.

## 8. Observability and stack decisions

Separate public task activity from platform technical observations and from durable business audit. Technical views may include trace/run ID, provider/model, latency, usage, safe tool metadata, failures, and estimated cost when supported. Keep sensitive configuration and technical observation access Super Admin-only; do not expose raw secrets even to that UI.

Prefer Langfuse for detailed AI traces and dataset experiments if integration/privacy constraints are satisfied. Mask sensitive data before export, define retention, and preserve local business audit independently. A small safe product activity view is not a reason to rebuild a complete observability platform.

| Layer | Direction |
| --- | --- |
| Application/UI | Retain Next.js, TypeScript, Ant Design / Ant Design Mobile; no competing UI framework by default. |
| Identity/data/files | Supabase Auth, PostgreSQL and private Storage with verified workspace isolation. |
| Internal agent | AI SDK; reuse provider configuration/security with compatible adapters. |
| Documents/RAG | Existing unpdf where suitable, established splitters such as LangChain utilities, embeddings, pgvector. |
| Observation/evaluation | Langfuse preferred; deterministic application tests remain separate. |
| MCP | Maintained MCP SDK/adapter; choose and test transport/auth against the actual host. |
| Verification | Existing Vitest plus browser/Playwright-style E2E where appropriate. |

Do not install both AI SDK and another full agent runtime without an ADR-level reason. LangChain utilities are allowed; LangGraph/LlamaIndex/full hybrid retrieval are not baseline dependencies. Package versions, embedding dimensions, provider/model IDs, transport details, and quotas are implementation decisions to verify, not guessed in this direction PR.

## 9. Official reference points

Checked as architectural references on 2026-09-28; recheck relevant docs/source at implementation time:

- [AI SDK loop control](https://ai-sdk.dev/docs/agents/loop-control)
- [Supabase user identities](https://supabase.com/docs/guides/auth/users)
- [MCP authorization specification source](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-11-25/basic/authorization.mdx)

These references support capability/security considerations, not a claim that the planned integration is already built or that a particular client subscription supports it.
