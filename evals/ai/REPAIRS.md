# AI evaluation repair evidence — 7 October 2026

## Scope and decision

The owner authorized fixing the evaluation findings and asked whether the HTTP503 responses were server interception. Owning branch: `codex/ai-evaluation-suite`, draft PR #41. Main **PROCEED for the scoped repairs and final samples**; Human UAT **NOT_RUN**. No merge, deployment, new account, migration, email, provider/quota change or MCP work.

## What HTTP503 meant

- `INVALID_EXCERPT` is application rejection: the model supplied text that did not occur exactly in the retrieved published source. This guard remains enforced for legacy model-supplied excerpts. Current prompts ask for source indexes; the server derives at most 500 verbatim characters and rechecks the current citation/content before display.
- Two reproduced ordinary Operations failures received provider **HTTP200**, finish `stop`, then failed application/SDK handling. Old diagnostics lost the exception classification, so their exact historical SDK causes cannot be recovered or attributed individually.
- An exact later request, trace `b22f8be4-57b6-4fb3-ac4e-2793b27f76f9`, recorded provider **200 / stop**, SDK **TOOL_CHOICE**, application **TOOL_INCOMPLETE**. The provider supplied no required lookup, and the SDK rejected the response. This is not evidence of a firewall or upstream HTTP503.
- The runtime now distinguishes actual no-lookup responses from unavailable services. Only a marked SDK tool-choice exception with zero attempted reads and no failed source can return fixed `INSUFFICIENT`, empty sources/activity, and the explicit message that no answer was verified. Provider prose is ignored. Current scope is revalidated. Unknown tool calls, source-validation failures, transport/provider errors and access changes remain failures.
- Persistent metadata contains only allowlisted reason/kind/status/finish/token counts. No raw exception, provider payload, prompt, source text, endpoint or credential is copied. Public JSON removes internal diagnostics. Upstream status 0, 4xx, 200-plus-application-rejection and cancellation are covered by Mock privacy/diagnostic tests; not all were reproduced live.

## Date and native-view repairs

WS-022 retains its original oracle. The latest user message produces conservative `NONE`, `EXPLICIT` or `AMBIGUOUS` schedule intent. A model instant must match the explicit instant before proposal persistence. Source/history dates cannot supply it. Ambiguous requests expose no preparation tool; fresh scheduled orders cannot be implicitly cleared. Unsupported/quoted/relative schedules require restatement, and schedule removal is not implemented by this repair.

Independent review reproduced five additional bugs: a negated date, a quoted source date, truncated ISO offset, seconds-bearing offset, and silent existing-schedule clearing. All five subsequently rejected before `proposeAssignment`; eight final independent probes also covered abort, stale generation and empty scoped pre-read. Additional Chinese suffix and quote boundaries have regression tests.

Native selected-order informational requests now perform the existing scoped read before interpretation. Final output carries the full strict view schema through the installed SDK; the adapter honors the already configured structured-output capability. Required tool turns remain text. Source binding, scope/reset checks, JSON-null rejection, approval separation, call limits and source-only fallback remain intact. No provider setting was modified.

## Executed evidence

| Layer | Final evidence | Meaning |
| --- | --- | --- |
| Catalog Mock | 106/106 PASS | Actual runtime/services with original fictional cases |
| Supplemental | 419/419 PASS | SDK transport, date parser, runtime, route/privacy and existing contracts |
| Selected mutations | 4/4 KILLED | Exact excerpt, generation, ambiguous JSON, requested date; passing baseline and unchanged originals |
| Rendered Mock browser | 27/27 PASS | Device 1536×864, tablet 1024×768, mobile 390×844; no external requests/page errors |
| Final real Test | 11 AI HTTP requests; 22/22 checks PASS | Ten evidence/layout/highlight/draft results and one explicit abstention; no harness retry |
| Independent review | Date/native and Operations/diagnostics | GPT 6.1 Sol; Main checked findings, source and executed results |

The final actual live report is [result.json](results/2026-10-07/result.json); the [HTML report](results/2026-10-07/index.html) separates layers. Receipt SHA-256 identifies the executed working tree, while `sourceCommit` is its checkout base, not a claim that pending edits were already committed. The initial red evaluation remains at immutable commit `58b3072`.

Intermediate repair attempts are not promoted to PASS: six one-request diagnostic runs included two ordinary HTTP503 and four successful responses; the first 11-request repair sampling had two native failures (invalid output/source-only and ignored tool choice); the next 11-request sampling had one attack-request tool-choice503. The final 11-request run followed the additional native schema/pre-read and explicit-abstention repairs. Intermediate live harness JSON remains ignored locally; diagnostic request metadata was checked through read-only Test observations. One final passing sample does not measure model error rates.

All repair live calls used retained fictional formal Staff in **Test `qobhjvrrpajoyvlgrkbx`**. Each owned session was locally signed out and its background browser closed; observed latest-20 role-visible order snapshots stayed unchanged. `memento` was not accessed. No Guest live, real proposal confirmation/execution, poisoned-source corpus, arbitrary provider comparison, RLS/concurrency audit, scanned OCR or Human UAT acceptance is claimed.
