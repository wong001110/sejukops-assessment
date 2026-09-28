# Sejuk Ops — Git and PR Workflow

## Current boundary

The current request authorizes a new documentation-only direction PR. It does not authorize feature implementation, dependency/configuration changes, database reset, merge, or deployment. Creating or merging planning documents must not automatically start the roadmap.

## Branches and commits

Start from the inspected current base and use a branch that describes the scope, such as `docs/ai-native-rebuild-direction` or a later `agent/phase-1-foundation`.

Do not write normal feature work directly to `main`. Batch related edits into meaningful commits and one coherent documentation/phase/major-feature PR. Do not create a commit/PR for every small change or merely to mirror sub-agent count.

Keep code, required tests, relevant docs, and state evidence together. Avoid unrelated refactors or framework upgrades in a feature PR. For this direction PR the diff must contain documentation only.

## PR description

State scope and explicit non-goals, relevant decisions/acceptance IDs, changed behavior versus design-only text, verification actually performed, checks not run and why, known limitations, and required external follow-up.

Distinguish baseline assessment results from newly verified behavior. A draft/ready status is not a substitute for evidence. Significant future UI changes need actual browser evidence when required by the phase.

## Review, merge, and deployment

Main Agent decides development acceptance based on the required evidence, not an implementation agent's completion message. User authorization determines whether merge or deployment may occur.

Leave the current direction PR open for review. Do not enable auto-merge or explicitly initiate a deployment. Existing third-party PR integrations may perform their configured checks/previews; do not represent those as an authorized production release.

When merge is separately authorized, use **squash merge**, then start later phases from updated `main`, not an already squashed branch. Destructive database operations require the correct scoped environment and the applicable execution permission; the clean-data direction is not a command to run them from this PR.

## Progress authority

Update [PROJECT_STATE.md](../PROJECT_STATE.md), not a second active checklist. The assessment-era `docs/IMPLEMENTATION_CHECKLIST.md` and historical verification files remain baseline references. Use [the adaptive plan](IMPLEMENTATION_PLAN.md) for rebuild acceptance criteria and [the development protocol](DEVELOPMENT_PROTOCOL.md) for evidence rules.
