---
type: workflow
title: AI Capabilities and Boundaries
description: Provider configuration, grounded Operations AI, Workflow Supervisor, and Document Understanding behavior.
tags:
  - ai
  - providers
  - grounding
  - documents
updated: 2026-08-13
---

# AI Capabilities and Boundaries

SejukOps AI features use a configurable OpenAI-compatible provider adapter. This runtime architecture is separate from the repository knowledge layer in `openwiki/`. Maintaining these Markdown pages does not select, configure, or invoke a SejukOps AI provider.

## Provider Configuration

Admin can create encrypted provider profiles, test connectivity, and choose single-model or task-based routing. Plaintext keys are accepted only by server routes, encrypted with AES-256-GCM, and never returned to the browser. A saved, selected provider is authoritative: an incompatible or failing provider does not silently fall through to another paid provider.

Relevant code:

- `src/domain/ai-config/`
- `src/lib/services/ai-config/`
- `src/lib/ai/providers/`
- `src/app/api/admin/ai-settings/`

## Operations AI

Manager Operations AI cannot run arbitrary SQL. A bounded planner may choose at most one allow-listed tool:

- `getJobs`
- `getTechnicianStats`
- `getOperationalSummary`
- `getWorkload`

Tool arguments are schema-validated, bounded symbolic periods are converted to Malaysia-time bounds server-side, RPC limits are bounded, and deterministic tool output is the source of answer facts. All four tools accept `today`, `this_week`, `last_week`, `this_month`, `last_month`, or an explicit calendar month encoded exactly as `month:YYYY-MM` (for example `month:2026-08`). Arbitrary start/end dates remain unsupported. Conversation context is session/request scoped and is not persisted as business data.

`getJobs` supports bounded multi-value filters for order numbers, technician names, lifecycle statuses, and service types. `getTechnicianStats` and `getWorkload` support bounded technician lists for direct comparisons. Every filter list is capped at 10 values; values inside the same filter are OR conditions while separate filters combine with AND. Result sets remain capped at 25 rows and one user request still executes at most one approved tool, so broader filtering does not turn the runtime into an unrestricted agent loop.

Legacy single-value filter payloads are normalized to the corresponding one-item arrays at the contract boundary so older browser session context and deterministic eval fixtures remain compatible. New planner output uses the plural array form.

Relevant code: `src/lib/ai/runtime/`, `src/lib/services/ai-operations/`, `supabase/migrations/202608100011_ai_operations.sql`, `supabase/migrations/202608130001_ai_operations_multi_filters.sql`, and `supabase/migrations/20260902093210_ai_operations_calendar_month.sql`.

## Workflow Supervisor

Workflow flags are deterministic operational rules. AI is optional and can only explain a stored flag; it cannot create the underlying fact, hide it, or make an operational decision. Explanations have durable request/replay behavior and safe `AVAILABLE`/`UNAVAILABLE` states. Provider failure leaves the deterministic flag visible.

Implemented rules include high amount variance, missing evidence, and unusual extra charge. Rule thresholds and current-revision behavior live in `src/domain/workflow-supervisor/rules.ts` and `supabase/migrations/202608100012_workflow_supervisor.sql`.

## Document Understanding

Admin document import separates extraction from operational writes:

```mermaid
flowchart LR
    U["Private source upload"] --> X["Text or vision extraction"]
    X --> D["Confidence-aware draft"]
    D --> H["Human review and edits"]
    H --> P["Preview"]
    P --> C["Explicit confirm"]
    C --> O["Atomic order creation"]
```

TXT and text-native PDF sources use bounded server-side text extraction. JPEG, PNG, and WebP sources require a vision-capable selected provider. Extraction produces strict structured fields with categorical confidence and issues; it must not create customers, orders, audits, or other operational records. Only explicit confirmation may call the atomic order-creation boundary.

Relevant code: `src/domain/document-understanding/`, `src/lib/services/document-understanding/`, `src/app/api/admin/document-imports/`, and `supabase/migrations/202608100013_document_understanding.sql`.

## Failure Contract

Provider bodies, keys, causes, and internal URLs are never exposed to the browser or persisted as user-visible diagnostics. Errors use stable codes and truthful recovery actions. Automatic retry/failover is not used where it could cause duplicate cost, hidden provider switching, or ambiguous operational effects.

## Primary Sources

- [`docs/AI_CONFIGURATION.md`](../../docs/AI_CONFIGURATION.md)
- [`docs/AI_RUNTIME_BEHAVIOR.md`](../../docs/AI_RUNTIME_BEHAVIOR.md)
- [`docs/LLM_EVALUATION.md`](../../docs/LLM_EVALUATION.md)
- [`docs/SYSTEM_SPEC.md`](../../docs/SYSTEM_SPEC.md)
