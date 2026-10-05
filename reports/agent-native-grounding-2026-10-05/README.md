# Native source narrative repair — 2026-10-05

Main decision: **PROCEED** for the observed date, missing-technician/branch and false-operation narrative defects. This supersedes the prior narrative-accuracy REPAIR checkpoint for these defects. It is not full model reasoning, all live view types, Human UAT or production acceptance.

## Changed behavior

Model layout prose is not an authority for displayed facts. All public title, summary, item observation, missing-information and follow-up strings now come from server presentation of the validated displayed records. MYT schedule, status and assignment presence use source fields. Only null schedule/assignment fields become missing-field entries; no technician identity, availability or branch deficiency is inferred. Fixed follow-ups request reads. The selected-order prompt projection now includes actual branch and assigned-technician identifiers.

The model still chooses the validated view, scoped record references and exact source excerpts. Source/citation revalidation, tool budgets, cancellation, quota, generation checks, saved PENDING proposal hydration and explicit confirmation remain. Unchecked free-form recommendations are deliberately no longer displayed; no extra formatter/model call was added. UI labels say Source observations.

## Evidence

- 109 affected automated checks PASS: runtime67, route31, stream11. Includes malicious fluent prose across all five actual view types, empty read, actual knowledge excerpt and saved PENDING proposal. Existing malformed-source-only, scope, citation and approval tests remain passing.
- Four rendered Mock checks PASS at1536×864 using actual components and deterministic MSW responses: comparison, assigned-order follow-up, unassigned/unscheduled order and knowledge citation.
- Three virtual source mutations KILLED: forwarding model summary, forwarding model missing fields, forwarding model interpretation. Each exact mutation loaded once and failed behavioral assertions; physical source unchanged.
- TypeScript, scoped ESLint, production build and diff checks PASS.
- Independent GPT6.1Sol read-only source review: PROCEED after correcting knowledge-view and empty/proposal test gaps. Reviewer made no live calls or edits; Main ran all checks.
- Real configured-provider Guest selected-order query and continuous follow-up both COMPLETE. Independent Test readback matched source status/schedule/assignment/branch/version. Both narratives display 30 Sept 2026,4:02 pm MYT and assigned technician, with no false missing fields. Minimize/reopen retains conversation, return to Orders and normal Guest exit succeed.
- Initial restricted-network service attempt failed at Guest entry before any model request; retained as failure, not omitted. Authorized-network service completed the same flow. Raw screenshots, WebM and response records stay local-only.

## Resource boundary and limits

Only confirmed SejukOps Test was used. Shared limit20→34→20, actual usage30→32 preserved; two model reservations within the four-call bound. Fresh readback finds zero active recent visits. Owned headless browsers and servers were closed. No Owner credential, business record, provider configuration, migration, reset, email, memento, merge or deployment change.

The fix guarantees the presentation provenance of these facts, not the correctness of every source document, model-selected subset or diagnostic recommendation. All-five-view paid acceptance and formal Admin live proposal/execute were not rerun for this slice. Human UAT NOT_REPORTED.
