# DSH-inspired business interfaces

Status: implementation authorized on 2026-10-09; evidence belongs in PROJECT_STATE.md.

## Decision and scope

The owner chose to reference DSH interaction patterns, rather than embed its components or runtime. Keep the existing Next.js deployment, Supabase project, bounded AI SDK runtime, provider configuration and shared business services. No DSH dependency, Host, gateway, developer tools, external MCP, region model, shared rooms or product sub-agents are introduced. This supersedes the runtime integration proposal in `proposals/dsh-refactor`; that proposal remains historical research.

The shared Supabase Demo project may be used. Existing orders, staff identities, knowledge, provider configuration and approval contracts remain compatible with the deployed application. New session storage is additive, server-only and scoped; no business reset or destructive migration is required. Merge and production deployment remain separate decisions.

## Three interfaces

| Interface | Presentation | Authority |
| --- | --- | --- |
| Operations chatbot | Plain transcript, bottom composer, concise order/knowledge citations, retry; no tool inspector or management controls | Existing role-scoped independent Operations reads; Technician assigned jobs only; previews denied |
| AI Workspace | Task conversation, actual execution events and full-width schema-driven business canvas; bottom composer | Existing native role permissions and saved human-approved proposals; no automatic Technician native grant |
| Owner Console | My Workspace, Sessions and AI Settings navigation | Current permanent SUPER_ADMIN; personal tasks require actual Owner workspace membership; previews cannot execute AI |

Owner may inspect recorded Demo/Owner sessions as the authorized platform administrator. Inspection is read-only; it does not impersonate the original actor, resume their provider request, approve their proposal or make their transcript model context. Other users can only inspect their own matching workspace, role, surface and generation; Guest history additionally binds the current opaque visit. Old page-only conversations cannot be reconstructed.

## Session contract

New session IDs are opaque correlation identifiers, never authority. The server captures validated questions and verified public answers/results from actual AI handlers. Browsers cannot upload assistant messages, arbitrary execution logs or a completed status. Public history excludes raw provider payloads, credentials, system prompts and private reasoning. Historical canvases are snapshots, not fresh operational truth; restored sessions do not restore active confirmation controls. A new request revalidates the actor, generation and current records.

Existing clients without a session header keep their current request/response behavior. Session persistence failure must be visible to the new UI without changing an otherwise successful business read. A cancelled/disconnected or process-interrupted run cannot be labelled completed without a persisted verified result; history never automatically replays tools. Session limits and bounded lists avoid unlimited transcript growth. Restart recovery means reading settled history, not durable autonomous execution.

## Models

Reuse AISettingsWorkspace and the existing SUPER_ADMIN APIs as the only settings authority. Preserve SINGLE_MODEL/PER_TASK routing, capability compatibility checks, server-side credentials, safe outbound transport and explicit connection tests. This phase does not add unrestricted per-user provider endpoints or silently change provider settings. The shared routing already selects the appropriate model for each surface/task.

## Delivery slices and acceptance

1. DSHREF-01: actual Operations chatbot rendering with loading, sources, failure/retry, cancellation, role limits and responsive bottom composer.
2. DSHREF-02: native embedded task workspace and floating default, actual tool events, dynamic canvas, stale result actions disabled and human approval unchanged.
3. DSHREF-03: additive server-authored session storage; same-role/other-actor/Guest-visit/workspace/generation negative tests; no client-authored execution evidence.
4. DSHREF-04: scoped history UI, new session and historical restoration; no silent replay or revived stale proposals.
5. DSHREF-05: Owner personal workspace, read-only session inspection and existing model settings; formal/Guest/preview denials and no impersonation.
6. DSHREF-06: Mock actual-component E2E before real shared-Test integration; selected isolation/stale guard mutation checks and independent review.
7. DSHREF-07: old clients/schema and existing Operations/role/approval regression compatibility, rollback by UI feature removal without deleting records.

Use meaningful slices and commits. Record Mock, SQL, actual-browser, real-provider and Human UAT evidence separately. Do not infer production safety solely from a successful build or local UI. No production deployment or merge is included in this development authorization.

## Implemented storage and setup

`20261009121229_ai_session_history.sql` adds only `ai_chat_sessions`, `ai_chat_turns` and two service-only journaling routines. Browser database roles cannot select or write these tables or execute their routines. Existing clients omit `X-Sejuk-Session` and retain their old contracts; new clients surface unavailable recording separately. A session accepts at most 50 requests; lists page by immutable creation time and a scoped cursor. History offers snapshots, not durable task recovery. Operations snapshots retain bounded public order/citation text; truncation is explicitly labelled.

The fresh installer retains its immutable baseline and applies the same hash-pinned migration before catalog seeding. See [fresh setup](FRESH_BASELINE.md). The prepared Test migration was applied after a protected backup; its original business/Auth digest was unchanged. Rolling the application back leaves these isolated tables unused without changing old business functions; do not automatically drop recorded history. Older browser-only conversations remain unavailable. Verification and current live AI limitations belong in [PROJECT_STATE.md](../PROJECT_STATE.md).
