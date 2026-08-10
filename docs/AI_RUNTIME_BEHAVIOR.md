# SejukOps AI Runtime Behaviour

This document defines runtime behaviour for AI failure handling, conversation scope, and Document Understanding confidence/ambiguity UX.

## 1. General Principle

AI features are optional decision-support and interpretation layers. Core operational data, deterministic business rules, and KPI calculations remain usable when an AI provider fails.

The product should never hide a provider/tool failure behind a fabricated answer.

## 2. Error Categories

Normalise provider/runtime failures into a small application-level error model such as:

```text
AI_NOT_CONFIGURED
AI_AUTH_FAILED
AI_RATE_LIMITED
AI_TIMEOUT
AI_PROVIDER_UNAVAILABLE
AI_TOOL_FAILED
AI_INVALID_RESPONSE
AI_CAPABILITY_MISMATCH
```

Provider-specific error bodies should be logged safely on the server where appropriate, but the user sees a stable, understandable SejukOps message.

Secrets and raw provider credentials must never appear in error UI or normal logs.

## 3. User-facing Recovery Messages

### Not configured

```text
AI is not configured for this feature.
Ask an Admin to configure a compatible model in AI Settings.
```

Action:

```text
[Close]
```

Admin may additionally receive a shortcut to AI Settings.

### Authentication / invalid credential

```text
The configured AI provider rejected the credential.
An Admin should verify the provider settings and run Test Connection again.
```

### Rate limited

```text
The AI provider is temporarily rate limited.
Please try again later. Your operational data has not changed.
```

### Timeout / provider unavailable

```text
The AI provider did not respond in time.
Please retry. The underlying SejukOps data remains available.
```

### Tool/data retrieval failed

```text
SejukOps could not retrieve the operational data needed for this answer.
No AI answer was generated. Please retry or use the normal operations screens.
```

### Invalid model response

```text
The AI response could not be validated safely.
Please retry or choose another compatible model.
```

### Capability mismatch

```text
The selected model does not support this input/task.
Choose a compatible model in AI Settings.
```

## 4. Retry Policy

Keep the assessment implementation simple.

- Do not implement complex cross-provider automatic failover.
- Respect the Admin-selected Single Model / Task-based Routing configuration.
- UI should always expose a clear manual **Retry** action for retryable failures.
- At most one bounded automatic retry may be used for clearly transient network/5xx failures if implementation proves useful.
- Do not automatically retry authentication failures, capability mismatch, invalid configuration, or deterministic tool validation failures.

If a provider remains unavailable, non-AI operations continue normally.

## 5. No Silent Fallback to Another Provider

SejukOps should not silently route a failed task to another paid provider because that can change:

- cost
- privacy expectations
- capability
- output behaviour

A future production version may introduce explicit fallback policies, but the assessment keeps provider selection transparent and predictable.

## 6. Operations Assistant Conversation Scope

The Manager AI Assistant uses **conversation/session-scoped context only**.

It does not use:

- persistent long-term AI memory
- embeddings/vector memory
- cross-user conversation memory
- cross-conversation inferred preferences

Multi-turn context exists only for the current Assistant conversation so follow-ups such as:

```text
Manager: How many jobs did Ali complete this week?
Manager: What about Bala?
```

can preserve the relevant metric and period.

## 7. Session Persistence

Assessment implementation should keep the design simple:

- a new conversation starts with no previous conversational context
- closing/clearing the conversation removes the remembered conversational context
- no conversation memory is written into the operational knowledge/data model

If the UI uses browser `sessionStorage` to preserve the current conversation across a page refresh in the same browser session, that is acceptable, but it must remain session-scoped and clearable. Database persistence is not required.

## 8. Conversation Safety Boundary

Conversation context may help interpret references, but it must never override:

- role/data scope
- supported tool list
- server-side date normalisation
- business rules
- current database truth

If previous conversational context conflicts with current tool results, current system data wins.

## 9. Document Understanding Output Shape

Document extraction should expose confidence/ambiguity per field rather than presenting every model value as equally certain.

Suggested schema:

```ts
type ExtractionConfidence = 'high' | 'medium' | 'low' | 'missing';

type ExtractedField<T> = {
  value: T | null;
  confidence: ExtractionConfidence;
};

type ExtractedServiceDocument = {
  customerName: ExtractedField<string>;
  serviceType: ExtractedField<string>;
  serviceDetails: ExtractedField<string>;
  amount: ExtractedField<number>;
  date: ExtractedField<string>;
};
```

Use categorical confidence instead of pretending a model-generated percentage is statistically calibrated.

## 10. Confidence Semantics

### high

The model/extraction path found a clear, unambiguous value that passes deterministic schema validation.

### medium

The model found a plausible value but the document context is not fully unambiguous.

### low

The model found a candidate value that requires explicit human attention.

### missing

The field was not found safely and `value` should normally be `null`.

Deterministic validation may downgrade/reject a model value regardless of model confidence.

## 11. Document Review UX

Example presentation:

```text
Customer Name
Ahmad                         ✓ High

Service Type
Aircond Repair                ✓ High

Amount
RM 320                        ! Low — review

Date
Not found                     — Missing
```

All extracted fields remain editable before confirmation.

Low/missing values should be visually prominent enough that Admin cannot reasonably mistake them for confirmed source data.

## 12. Database Write Rule

AI extraction is always a draft.

```text
Upload
-> Extract
-> Validate
-> Show field confidence
-> Human review/edit
-> Confirm
-> Create/update operational record
```

The system must not silently create/update an order directly from an unreviewed model extraction.

The committed operational record stores the human-confirmed normalised values. Retaining the original extraction JSON for debugging/audit is optional for the assessment.

## 13. Failure Behaviour by Feature

### Manager Operations Assistant

Provider failure:

- preserve conversation UI
- show clear retry/error state
- do not invent an answer
- normal Dashboard/Orders remain available

### Operational Insight

Provider failure:

- deterministic KPI cards/charts remain visible
- show `AI insight unavailable` rather than failing the Dashboard

### Workflow Supervisor explanation

Provider failure:

- deterministic workflow flag remains visible
- explanation/recommendation can show unavailable state

### Document Understanding

Provider failure:

- uploaded source file remains available where safe
- extraction step reports failure
- no operational record is written
- user can retry after provider/configuration recovery
