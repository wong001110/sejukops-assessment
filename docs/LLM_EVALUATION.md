# SejukOps LLM Evaluation Strategy

## 1. Purpose

This document defines how SejukOps evaluates models used by the Manager AI Operations Assistant and related text-based AI features.

The product must not treat a public leaderboard score as proof that a model works correctly inside SejukOps. Public benchmarks are used for **candidate-model qualification and methodology reference**; product acceptance uses a **SejukOps-specific deterministic evaluation set** built around the actual tools, date rules, database fixtures, and limitations of this system.

## 2. Public Benchmarks Worth Reusing or Studying

### Berkeley Function Calling Leaderboard (BFCL)

Primary use for SejukOps: **tool/function-calling qualification**.

Relevant categories include:

- single-turn function selection
- multiple / parallel function calling where applicable
- multi-turn function calling
- missing-function / missing-parameter behaviour
- relevance / irrelevance and hallucination-related cases

BFCL is the most directly relevant public benchmark for checking whether a candidate model can reliably select and format tool calls before we route SejukOps Operations AI traffic to it.

Reference:

- https://gorilla.cs.berkeley.edu/leaderboard
- https://github.com/ShishirPatil/gorilla/tree/main/berkeley-function-call-leaderboard

### ToolSandbox

Primary use for SejukOps: **evaluation-methodology reference for stateful conversational tool use**.

Useful ideas to borrow:

- state dependencies
- multi-turn interaction
- insufficient-information cases
- canonicalisation / normalisation issues
- evaluation of intermediate and final milestones rather than only final prose

The public ToolSandbox scenarios are not SejukOps operations scenarios, so it should not replace the project-specific eval dataset.

Reference:

- https://github.com/apple/ToolSandbox

### tau3-bench

Primary use for SejukOps: **methodology reference for domain-specific conversational agents with tools and policy constraints**.

The current tau-bench framework provides domains with policies, tools, tasks, simulated users, and outcome-based evaluation. This is conceptually close to how SejukOps should evaluate a Manager assistant against an operational policy and controlled tool layer.

Its public domains are not SejukOps field-service operations, so the project should reuse the ideas rather than claim those public tasks test SejukOps correctness.

Reference:

- https://github.com/sierra-research/tau2-bench

## 3. What We Do Not Need

SejukOps does not expose arbitrary text-to-SQL generation. The model selects approved application tools whose server implementation performs deterministic database queries.

Therefore generic text-to-SQL benchmarks are not a primary acceptance benchmark for the Operations Assistant.

Likewise, generic QA/chat benchmarks do not test the critical SejukOps risks: correct tool selection, correct parameters/date ranges, no unsupported database access, and grounded answers from tool results.

## 4. Evaluation Layers

### Layer A — Candidate Model Qualification

Optional and relatively infrequent.

Use a public tool-use benchmark such as a relevant BFCL subset, or an equivalent function-calling harness, when:

- introducing a new model/provider
- changing the default/reference Operations model
- deciding between multiple candidate models
- changing native tool-calling vs structured/prompt-based routing strategy

A strong public score is useful evidence but is not sufficient for product acceptance.

### Layer B — SejukOps Domain Evaluation

Required for Operations AI acceptance.

Run the configured model against a fixed SejukOps database fixture and project-owned test cases.

Each case should specify the expected operational outcome, not merely compare prose strings.

Conceptual case shape:

```json
{
  "id": "OPS-EVAL-001",
  "fixture": "standard-week-01",
  "conversation": [
    { "role": "user", "content": "What jobs did Ali complete last week?" }
  ],
  "expected": {
    "tool": "getJobs",
    "arguments": {
      "technician": "Ali",
      "status": "JOB_DONE",
      "period": "last_week"
    },
    "facts": {
      "jobCount": 3,
      "orderNumbers": ["ORD-2026-0012", "ORD-2026-0017", "ORD-2026-0020"]
    }
  },
  "forbidden": {
    "arbitrarySql": true
  }
}
```

The real implementation may store canonical start/end timestamps rather than symbolic period names; the evaluator should compare normalised values.

### Layer C — Agent/UI E2E

After the domain eval passes, test the Manager UI as a real user flow:

```text
Manager opens AI Assistant
→ asks question
→ model chooses controlled tool
→ server executes query
→ structured result returned
→ answer rendered
→ source operational facts match fixture/database
```

This catches orchestration/UI errors that a model-only eval cannot.

## 5. Initial SejukOps Eval Categories

### A. Direct lookup

Examples:

- What jobs did Ali complete last week?
- Show repair jobs completed today.
- What is the status of ORD-2026-0012?

Evaluate tool and filter arguments.

### B. Aggregation

Examples:

- How many jobs were completed today?
- What was the total completed amount this week?
- Which technician completed the most jobs this week?

Authoritative numbers come from deterministic tool output.

### C. Workload

Examples:

- Who has the highest workload this week?
- How many active jobs does Bala have?

### D. Date / period interpretation

Test:

- today
- this week
- last week
- this month

Date boundaries must be normalised server-side with the application's configured timezone rather than invented by the model.

### E. Multi-turn follow-up

Example:

```text
User: How many jobs did Ali complete this week?
Assistant: ...
User: What about Bala?
```

The second turn should preserve the relevant period and metric context.

### F. No data

Example:

- What jobs did Ali complete on a fixture date where Ali completed none?

Expected behaviour: explicit no-result response, not fabricated order IDs.

### G. Irrelevant / unsupported request

Examples:

- What is the weather tomorrow?
- Delete all service records.
- Show me the entire raw database.

Expected behaviour: no inappropriate operational tool call and a clear scope/permission limitation.

### H. Missing or ambiguous information

Where the tool contract genuinely requires information that cannot be inferred safely, the model should request clarification or return a supported limitation instead of inventing parameters.

### I. Tool failure

Inject controlled errors/timeouts.

Expected behaviour: explain that operational data could not be retrieved; do not fabricate an answer.

### J. Prompt-injection / boundary attempts

Examples should verify that user text cannot bypass:

- approved tool list
- role/data scope
- no arbitrary SQL rule
- bounded result policy

Server authorization remains the real security boundary; model behaviour is an additional quality check, not the enforcement mechanism.

## 6. Metrics

Prefer deterministic metrics whenever possible.

### Tool selection accuracy

```text
correct tool / total applicable cases
```

### Argument accuracy

Compare schema-normalised parameters such as:

- technician
- status
- service type
- start/end dates

### Grounded fact accuracy

Compare claims in the final answer against the tool result / fixture.

Critical facts include:

- counts
- amounts
- technician names
- order numbers
- statuses
- date ranges

### Unsupported-request handling

Measure whether the model avoids inappropriate tool calls and returns the expected limitation.

### Hallucination rate

Count answers that introduce operational facts not present in tool output.

### Consistency

Run important cases more than once when evaluating a provider/model release. Report repeated-run success rather than relying on one lucky trajectory.

### Latency and cost

Capture per case / aggregate:

- request latency
- tool-call rounds
- input/output tokens where provider data is available
- estimated API cost where pricing metadata is available

These metrics help compare models for Task-based Routing.

## 7. Scoring Philosophy

Do not use LLM-as-judge for facts that can be checked deterministically.

Preferred evaluation order:

```text
Tool correctness
→ Argument correctness
→ Tool result / DB-state correctness
→ Grounded factual answer correctness
→ Optional qualitative review for wording/clarity
```

A polished answer with the wrong tool result is a failure.

A semantically equivalent answer should not fail merely because wording differs.

## 8. Dataset Size for the Assessment

Start with approximately **40–60 domain cases**, weighted toward the supported Manager questions rather than broad generic chat.

Suggested initial balance:

```text
10 direct lookup
10 aggregation / ranking
6 date-normalisation
5 multi-turn follow-up
5 no-data
5 unsupported / irrelevant
4 tool failure / boundary cases
5 adversarial / prompt-boundary cases
```

The exact count may change as supported intents stabilise.

## 9. Test Scheduling

Do not run the full paid-model eval after every prompt or UI edit.

### Targeted AI smoke

Run a small representative subset after changes to:

- prompt/system instructions
- one tool schema
- response formatting

### Full SejukOps domain eval

Run when:

- the Operations tool layer reaches its feature gate
- tool contracts change materially
- routing/default model changes
- model/provider version changes materially
- final release/submission candidate is prepared

### Public benchmark qualification

Run only when model-selection evidence is useful. It is not part of every normal application regression.

## 10. Environment Handling

Real provider evaluation may be `PENDING_ENV` when no compatible API key is configured.

This must not block:

- deterministic tool unit tests
- tool-contract tests
- fixture/database tests
- mock-model orchestration tests
- AI Assistant UI implementation

Once the required provider key is supplied, the Main Agent should schedule only the previously blocked model-dependent verification groups.

## 11. Product Acceptance Rule

A candidate model is acceptable for SejukOps Operations AI only when it passes the project's required domain-evaluation threshold and critical boundary cases.

Public BFCL / ToolSandbox / tau3-bench results may inform selection, but **SejukOps-specific evaluation remains the source of truth for product fitness**.