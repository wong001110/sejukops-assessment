# SejukOps Operations AI Evaluation

This directory contains the project-owned deterministic domain evaluation for
the Manager Operations Assistant. It is the product-fitness gate described in
`docs/LLM_EVALUATION.md`; it does not use prose-string matching or an
LLM-as-judge for operational facts.

## Dataset

`cases.ts` defines 52 fixed cases against the committed assessment fixture:

| Category | Cases |
| --- | ---: |
| Direct lookup | 10 |
| Aggregation, ranking, and workload | 10 |
| Date normalisation | 6 |
| Multi-turn context and isolation | 6 |
| No data | 5 |
| Unsupported or irrelevant | 5 |
| Tool and provider failure | 5 |
| Adversarial and no-arbitrary-SQL boundaries | 5 |

Expected counts, amounts, rankings, order numbers, statuses, and workloads are
referenced from `src/domain/assessment-fixtures.ts` and
`src/domain/manager-dashboard/golden.ts`. The dataset does not maintain another
independent copy of those values.

Each step records the exact approved tool and schema-normalised arguments, or
an explicit no-tool/failure outcome. Fact assertions compare typed fact keys
and values. They never require a particular sentence or tone.

## Running

The normal automated gate is deterministic and provider-free:

```text
pnpm test -- tests/ai-operations/eval-harness.test.ts
```

The harness accepts an executor backed by the real Operations Assistant, but a
real-provider run must be explicitly opted into by the Main Agent after the
provider, model, routing, and credential are known. It must not log provider
credentials, prompts containing secrets, or raw provider error bodies. Paid
full-domain evaluation is not part of the edit-time regression suite.

The report captures elapsed latency and tool-call rounds for every step. Token
counts and estimated cost are captured only when the provider supplies that
metadata; absence remains `null` and is not converted into an invented zero.
Critical cases are repeated within one run to expose inconsistent trajectories.

## Hard gates

Regardless of aggregate accuracy, the run fails when it observes any of the
following:

- an arbitrary/unapproved tool or SQL path;
- operational facts not present in the deterministic result;
- a successful factual answer after a tool/provider failure;
- a tool call for an unsupported request;
- context inherited after an explicit reset/new conversation;
- stale context overriding current tool results.

## Public benchmark qualification

BFCL, ToolSandbox, and tau-style benchmarks are optional candidate-model
qualification inputs. No public benchmark has been downloaded or run for this
assessment, so this repository makes no public benchmark score or pass claim.
Their results would not replace the SejukOps domain gate.
