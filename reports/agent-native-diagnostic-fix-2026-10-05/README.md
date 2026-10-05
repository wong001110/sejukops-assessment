# Agent Native failure diagnostics and selected-order repair — 2026-10-05

## Changes and evidence

The native route now captures its request-local provider exchanges through the existing observation context, then persists only fixed metadata: failure stage, HTTP status, approved failure category, finish reason and bounded usage. No prompts, source rows, model/provider payloads, error text, endpoints, credentials or provider debug bodies are added to persistent observations or public errors. Terminal responses still close before best-effort metadata persistence.

Real diagnostics identified HTTP200/stop responses rejected because the model ignored required tool choice, rather than a Guest allowance rejection. This is now recorded as TOOL_CHOICE_IGNORED and shown through a fixed public explanation. Other fixed messages distinguish credential rejection, provider account access, rate limiting, request settings, service errors and connection failure.

The first required-tool turn uses text response format; final output still uses the SDK JSON parser, strict view schema and source/citation binding. A user-selected single-order inspection performs a fresh read through the same actor-scoped capability and actual activity events before model interpretation. This avoids depending on the model to rediscover a concrete selected record. It uses the same six-tool counter, cancellation/deadline and scope/generation checks. Selection/history never grants approval, tool arguments or identity authority. An absent row cannot support fabricated output, and a foreign row stops before generation.

## Verification and limits

- Final targeted run:126 tests PASS across runtime60, route31, observation record6, safe metadata18, observation context2 and SDK transport9. After final prompt/test type clarification the affected97 tests passed again; production build includes those clarifications and passes its TypeScript/lint gates. Scoped ESLint PASS. No full-suite rerun was needed for this bounded slice.
- Actual rendered Mock1536×864 safe provider-rejection message, no accepted canvas and available retry:PASS. Initial Playwright interception timed out because MSW handled the request; the corrected check uses an explicit MSW scenario and the actual message helper.
- Two distinct virtual source mutations KILLED:unsafe native stage persistence and removal of final scope failure-stage assignment. Physical source was unchanged by mutation execution.
- Independent GPT6.1Sol review:PROCEED for privacy, request adaptation and selected-record capability guards; latest scoped123 tests PASS including capability checks. Review found final revalidation was labeled COMPLETE too early; fixed and proven by a mutation-rejecting assertion.
- Real configured provider:discovery/read cards COMPLETE in two earlier runs. Selected-order investigation and continuous follow-up both COMPLETE, with one actual server capability read and one provider step per turn. Final source record fields match an independent exact-Test readback. Minimize/reopen retains the conversation; normal Guest exit completes. Raw live screenshots, NDJSON and WebM remain local-only and are excluded from this public report/PR.
- **Free-form model accuracy is not PASS.** The live model summary/interpretation repeated an incorrect scheduled date and claimed some existing fields were missing. The displayed source record schedule/status/description are correct. Prompt discourages date restatement, but no deterministic validation of arbitrary interpretation was added and no post-final-wording accuracy call is claimed. This repair establishes diagnostics and the live read/render/follow-up mechanism; it does not establish complete model factual accuracy or portfolio-ready content.
- Human UAT:NOT_REPORTED. Formal-Admin live proposal/execute, all five live view types, model accuracy, deployment and MCP remain separate.

## Resource boundary

Only confirmed SejukOps Test was used. User-authorized temporary Guest shared limit20→31 was restored to20; actual usage21→30 was retained (nine additional reserved provider calls within ten-call budget). Four test visits exited; exact fresh readback found zero active visits in the run window. Owned browsers and ports3100/3200 closed. No business records, Owner identities/passwords, AI provider settings, migrations/resets, emails, unrelated memento project, merge or deployment changed.

Main decision: **PROCEED** for diagnostic repair and selected-order live request/follow-up execution; **REPAIR** remains for complete free-form model accuracy and full Agent Workspace acceptance.
