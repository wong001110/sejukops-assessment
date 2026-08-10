# SejukOps Git & Pull Request Workflow

## 1. Purpose

SejukOps development uses pull requests as the integration and acceptance boundary for each **development phase or major feature**.

The intent is to keep `main` readable, reviewable, and aligned with the project's multi-agent acceptance process without creating a separate PR for every tiny implementation task.

## 2. Main Branch Rule

`main` is the accepted integration branch.

Once implementation begins:

- normal feature/phase implementation should not be committed directly to `main`
- each phase or major independently reviewable feature is developed on a branch and merged through a PR
- accepted PRs are merged to `main` using **Squash and Merge**
- normal merge commits are not part of the project workflow

A trivial emergency/repository-administration change may be handled separately only when the Main Agent determines a full feature PR boundary would add no value, but product implementation work should follow the PR workflow.

## 3. PR Granularity

Do **not** create a PR for every sub-task.

Small checklist items belong to the same PR when they form one coherent phase/feature slice.

Good PR boundaries include:

```text
Phase 1 — Foundation
Admin Order Workflow
Technician Mobile Workflow
Reschedule Workflow
Completion + WhatsApp + Manager Review
KPI Dashboard
AI Provider Configuration
AI Operations Assistant
Workflow Supervisor + Document Understanding
Release / Submission Quality
```

The Main Agent may split a large phase into multiple major-feature PRs when that produces safer review/integration boundaries.

Example:

```text
Phase 3 Technician
├── PR: Technician Core Job Flow
└── PR: Technician Evidence + Completion
```

This is preferable to one oversized PR if the two slices have clear dependencies and independent verification gates.

## 4. Branch Naming

Use clear branch names owned by the active Main Agent workflow.

Recommended pattern:

```text
agent/phase-1-foundation
agent/feature-admin-orders
agent/feature-technician-workflow
agent/feature-reschedule
agent/feature-kpi-dashboard
agent/feature-ai-operations
agent/fix-completion-idempotency
```

The exact prefix may adapt to the execution environment, but branch names must identify the phase/feature purpose.

## 5. Main Agent Owns PR Boundaries

The Main Agent decides:

- when a new branch/PR is required
- which checklist items belong to that PR
- which tasks may run in parallel
- which sub-agent outputs are integrated into the branch
- which verification groups are required before acceptance
- whether the PR is ready for squash merge

Sub-agents do not independently expand PR scope or create unrelated product-direction changes.

## 6. Multi-agent Work Inside a PR

A phase/feature PR may contain work from multiple scoped agents.

Conceptually:

```text
Main Agent creates feature branch / PR boundary
        |
        +--> Frontend/UIUX Agent
        +--> Backend/Data Agent
        +--> AI Agent where relevant
        +--> QA Agent
        +--> E2E Agent
        |
        v
Main Agent integrates and accepts
        |
        v
Squash merge -> main
```

If the environment supports isolated worktrees/temporary branches for parallel agents, they may be used internally. Their work must still be integrated into the single intended phase/feature PR before acceptance.

Do not create one public PR per sub-agent merely because multiple agents were involved.

## 7. Draft PR Timing

For a substantial phase/feature, prefer opening a **Draft PR** once the implementation branch has a meaningful initial slice.

The Draft PR provides a visible integration boundary while work continues.

A PR should not be marked ready for merge merely because implementation code exists.

## 8. Required PR Description

Each phase/major-feature PR should document:

```text
Scope
Checklist IDs included
Relevant specifications
Architecture/product decisions affected
Implementation summary
Verification groups required
Tests/checks already run
QA result
Agent E2E result where required
Environment blockers / PENDING_ENV items
Known limitations
Human UAT status when relevant
UI screenshots/recordings for significant UI work where practical
```

Do not include secret values, local API keys, or sensitive environment content in PR text/screenshots.

## 9. Verification Before Merge

Normal sequence:

```text
Implementation tasks
-> targeted L0 checks during work
-> feature/integration verification gate reached
-> required L1/L2/L3 checks
-> independent QA
-> required Agent E2E / real usage
-> Main Agent integration/spec acceptance
-> update checklist + verification log in the PR
-> Ready for review/merge
-> Squash and Merge to main
```

Human UAT remains a separate evidence class.

A normal feature PR may be development-accepted and squash-merged with designated Human UAT still pending when the development protocol permits it. The **final release/submission gate** must satisfy the required Human UAT cases before submission.

## 10. PENDING_ENV and Merge Decisions

A missing external credential does not automatically prevent a feature PR from progressing.

If a real integration path is `PENDING_ENV`:

1. implement and verify all non-dependent behaviour
2. document exactly which real-provider/integration checks remain blocked
3. record the blocker in the checklist/verification log
4. Main Agent decides whether the PR can be development-accepted with `PENDING_ENV`
5. after the human supplies the required ENV, create/use the smallest appropriate follow-up PR to run/fix/re-verify the previously blocked path

Do not silently mark blocked real integration tests as passed.

## 11. Squash Merge Rule

Accepted phase/feature PRs use **Squash and Merge**.

The resulting `main` history should contain one meaningful commit per accepted PR rather than every temporary implementation/sub-agent commit.

Recommended squash commit style:

```text
feat: complete foundation phase
feat(admin): implement order and assignment workflow
feat(technician): implement mobile service workflow
feat(operations): add reschedule workflow
feat(manager): add KPI dashboard
feat(ai): add provider configuration and routing
feat(ai): implement operations assistant
fix(technician): enforce completion idempotency
```

Use a concise commit subject that represents the whole accepted PR.

## 12. Branch Cleanup

After successful squash merge:

- delete the merged feature branch when practical
- continue the next phase/major feature from the updated `main`
- do not keep building future phases on a branch that has already been squash-merged

This avoids divergence between old feature-branch history and the new squashed commit on `main`.

## 13. Checklist and Verification Updates

The phase/feature PR should contain its own progress/evidence updates.

Before squash merge, ensure:

```text
docs/IMPLEMENTATION_CHECKLIST.md

docs/testing/VERIFICATION_LOG.md
```

reflect the development-accepted state accurately.

`VERIFIED` means required development gates passed; do not mark items `VERIFIED` simply because they are being merged.

## 14. OpenWiki Update Timing

When a phase/major feature materially changes codebase knowledge, update OpenWiki **after the feature implementation has stabilised and before the PR is accepted**, so the wiki update can normally ship in the same PR.

Examples:

- new major module
- changed data flow
- changed service boundaries
- changed important source locations
- phase completion

If the OpenWiki environment/tool is unavailable, record the documentation refresh as a follow-up instead of blocking unrelated implementation acceptance unless current agent context would become unsafe without it.

## 15. Fixes After Merge

If an issue is found after squash merge:

- create a focused fix branch/PR when code changes are required
- run the smallest affected verification groups first
- broaden regression only when the fix blast radius warrants it
- squash merge the accepted fix PR to `main`

Do not reopen or continue committing to the already squash-merged feature branch.

## 16. Release PR

The final release/submission phase should have its own PR when it contains meaningful release work such as:

- final regression fixes
- deployment configuration
- screenshots/demo instructions
- README/self-assessment updates
- known limitations
- final Human UAT evidence

This PR is the final integration gate before the assessment submission state is considered complete.
