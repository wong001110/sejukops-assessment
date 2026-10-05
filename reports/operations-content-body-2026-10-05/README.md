# Operations content/body correction — 2026-10-05

Main decision: **PROCEED** for this scoped visual repair. Human UAT: **NOT_REPORTED**.

## What differed and what changed

The previous restoration reused the old shell and major interactions, but its Orders body still used newer heading/panel containers. The Mock gallery also used a default Ant Design provider instead of the actual project provider and inserted another 24px gutter inside the product content.

- Orders now uses the historical page-stack, heading/divider, status-summary card, separate filter toolbar and zero-padding table card classes.
- Operations card headers/field colours and detached drawers use the retained quiet portal styling.
- Technician cards are no longer nested in an extra enclosing card; toolbar and job-card spacing are explicit.
- The preview now wraps components with the same AppQueryProvider as the real application, including its existing primary colour/font/control sizing, and adds no second content gutter.
- Screenshot captures include a Mock watermark and wait 500ms for transitions before capture.

Historical `9b33b8c^` source and retained CSS supplied the reference. No historical screenshot exists, so this is not a pixel-identical claim. Backend, permissions, model runtime and AI Workspace product styling have no change in this slice. Its new preview reflects the actual application theme rather than the prior default provider.

## Verification actually performed

- Typecheck and scoped ESLint PASS; diff check PASS.
- 22 affected component cases verified: 21 passed the combined run; the technician-choice/pending-assignment test exceeded its default 5-second wall-clock budget. It also exceeded 5 seconds when isolated, then passed in 7.43 seconds with a 15-second CLI test budget. All payload, duplicate-submit, frozen fields and success assertions stayed unchanged; no test configuration or application request timeout was changed.
- Actual-component Mock business flow: **13 checks PASS**, including creation, assignment, Manager scheduling, Technician progress, pending and stale writes, proposal execution and narrow overflow. An initially unqualified dialog locator matched the closing drawer plus opening AI modal; it was scoped to the AI modal's name and the runner passed on retry.
- Capture/browser checks: **19 PASS**, zero runtime errors/off-origin requests; desktop viewport 1536×864. Main visually inspected Admin Orders, its detail drawer and Technician cards.
- Computed styles confirmed historical values: desktop content `27px 30px 44px`; page gap `22px`; heading `29px`/weight`680`/divider`1px`; toolbar padding `15px 16px`; table body padding`0`; existing project primary `rgb(23, 107, 135)`.

Full regression, production rebuild, live database/model calls and mutation testing were not repeated: this changes presentation/preview composition, with no service, authorization, proposal or reset logic change. The affected component/browser flows and typecheck cover the changed JSX; the prior real Test and mutation evidence remains in the preceding restoration report. No new live/Human UAT claim. Owned fixture service and isolated browsers were closed.

[Open the refreshed gallery](index.html), including a collapsible previous-preview comparison. Full-page screenshots may be taller than the viewport. All records are synthetic; Mock roles are props, not authentication proof.
