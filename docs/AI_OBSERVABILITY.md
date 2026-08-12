# AI Observability for Assessment Review

## Purpose

SejukOps exposes `/diagnostics/ai-observability` as a **technical assessment surface**, not as a fourth business role. The application business roles remain Admin, Technician, and Manager.

The purpose of this page is to make the AI implementation inspectable without turning operational screens into developer tooling. It answers three reviewer questions:

1. Did this feature actually invoke an AI provider when required?
2. What controlled application path did the AI participate in?
3. What safety or human-review boundary prevented the model from becoming an unrestricted business-data or decision-making layer?

The diagnostics feed is server-owned and centralized. It does not depend on the browser tab that initiated the request.

## Why provider logs alone are insufficient

A successful HTTP request to an LLM only proves that a model was called. It does not prove that the application retrieved business data safely or grounded the result correctly.

For that reason, SejukOps records an **AI run** with two complementary layers:

- **Execution trace** — a safe summary of the application-controlled AI workflow.
- **Provider-call metadata** — provider/model, endpoint, HTTP status, latency, and token usage when supplied by the provider.

Raw prompts and raw provider responses are deliberately not persisted.

## Observation matrix

| AI capability | What the model does | What application code controls | Observation evidence |
|---|---|---|---|
| Operations Query | Plans one supported request and selects one approved operations tool | Tool allow-list, validated arguments, Malaysia-time period boundaries, database query, result facts, deterministic grounded answer formatting | Outcome, selected tool, bounded-filter presence, result count, fact count, grounding state, provider/model/status/latency/tokens |
| Operational Insight | Interprets deterministic dashboard facts | Dashboard aggregation, metrics version, cache, fact set, citation validation, numeric-claim validation | Period, cache hit, fact count, citation count, grounding state, provider metadata when a model call is required |
| Workflow Supervisor explanation | Explains an already-created deterministic workflow flag and suggests human review | Flag rule/severity, grounding facts, citation validation, persisted explanation status, Manager decision remains human-owned | Rule code, severity, flag status, explanation status, replay state, provider metadata when an explanation is generated |
| Document Understanding | Extracts a structured draft from supported text/image input | Private storage, file policy, text/image routing, strict extraction schema, field validation, explicit Admin review and confirmation before order creation | MIME type, extraction status/attempt, field confidence categories, safe failure code, human-confirmation requirement, provider metadata |
| Provider Test | Responds to an isolated connectivity/compatibility request | Saved/unsaved provider configuration validation and safe server transport | Connection outcome, provider/model/endpoint, HTTP status, latency, token usage when supplied |

## Operations Query trace example

A question such as `What jobs did Ali complete last week?` is not implemented as free-form SQL generation.

The observed execution path is:

```text
Manager question
  -> LLM request planner
  -> approved tool: getJobs
  -> validated bounded arguments
  -> controlled Supabase query
  -> structured records / facts
  -> deterministic grounded formatter
  -> Manager answer
```

The trace stores that `getJobs` was selected, that a bounded period and technician filter were used, how many records were returned, and how many grounding facts were produced. It does **not** persist the user's raw question, the technician name, returned order numbers, or the model's raw response.

This distinction is intentional: the assessment can demonstrate controlled retrieval without creating a second store of operational content.

## Operational Insight and cache visibility

An Operational Insight can legitimately create an AI run with **zero provider calls** when a previously validated insight for the exact metrics version is returned from cache. The execution trace records `cached: true` so a reviewer can distinguish a cache hit from missing instrumentation.

When a provider is called, the trace additionally records provider/model/status/latency and available token usage.

## Workflow Supervisor visibility

Workflow flags are deterministic application records. AI is optional explanation only.

The trace therefore emphasizes:

- deterministic rule code and severity;
- whether an explanation was available or unavailable;
- whether the request was replayed/idempotent;
- provider metadata only when a model call occurred.

A successful provider response does not itself approve or reject work. Manager review remains the decision boundary.

## Document Understanding visibility

Document extraction is treated as human-in-the-loop data entry.

The persisted trace records only safe extraction metadata:

- MIME type;
- extraction status and attempt count;
- confidence category for each supported field;
- safe failure code when applicable;
- `humanConfirmationRequired: true`.

It does not persist extracted customer names, addresses, phone numbers, amounts, service details, dates, raw document text, or image/base64 data.

## Persistent-data boundary

Central observations use existing `audit_logs` storage with event type `AI_OBSERVATION`.

The persisted observation includes:

- trace ID and timestamp;
- AI task and actor role;
- run status and duration;
- task-specific safe execution summary;
- provider/model/endpoint/status/latency;
- token counts when the provider returns them;
- safe error code;
- explicit safety flags.

The following are **not persisted** by AI observability:

- API keys or Authorization values;
- raw prompts or conversation messages;
- raw provider response bodies;
- returned order/customer records;
- extracted document field values;
- uploaded document bytes or image/base64 data.

Observations are retained for seven days and the diagnostics API returns at most the latest 100 records.

## Access boundary

No `SYSTEM_ADMIN` role is introduced for the assessment. `diagnostics:view` is an application permission granted to the Admin and Manager demo roles so a reviewer can inspect traces after exercising either side of the AI workflow. Technician sessions cannot access diagnostics.

This is assessment/reviewer tooling, not a claim that every production Operations Admin or Manager should receive engineering observability access. A production deployment would normally move this permission behind a dedicated engineering/support identity and a purpose-built telemetry backend.

## Failure interpretation

The observation status is not based on HTTP status alone.

Some AI workflows intentionally return a valid application response that contains a safe AI failure state. SejukOps marks these as failed observations as well, for example:

- Workflow Explanation with `UNAVAILABLE`;
- Document Understanding with extraction status `FAILED`;
- provider connection test failure.

This prevents a `200` application response from being mistaken for a successful AI outcome.

## Scope boundary

The diagnostics page is intentionally focused on AI integration evidence rather than general application request logging. Normal order, upload, review, notification, and reschedule traceability continues to use the application's operational records and audit events.

This keeps the assessment UI aligned with the actual AI question: how the model is connected to controlled system data and where application logic remains authoritative.
