# Sejuk Ops — Git and Pull Requests

Current authorization: [PROJECT_STATE.md](../PROJECT_STATE.md). The direction-update task permits a documentation branch/PR only. It does not permit implementation, merge, data reset, or deployment.

## Branches and commits

Start from verified current `main` unless the user names another base. Do not overwrite unrelated work or force-push shared history. Use a descriptive scope, such as `docs/agent-native-direction-20260928` or a later `agent/phase-1-foundation`.

Group related work into coherent commits. Do not commit every small edit or open one PR per helper/sub-agent. The Main Agent selects phase/major-feature review boundaries; large phases can split when independently reviewable.

## Pull request contents

State the authorized scope, relevant specification and acceptance IDs, changed areas, explicit non-goals, checks actually run, checks not run, blockers, and remaining risk. Distinguish target design from delivered behavior. Do not include credentials, private records, raw traces, or signed URLs.

A documentation PR is complete when its documents and links are reviewed and the diff is documentation-only. It needs no invented app-test evidence. Substantial implementation PRs may begin as drafts; readiness depends on evidence, not on an agent saying done.

## Integration

No direct implementation commits to `main`. Eventual authorized integration uses **Squash and Merge** after the required gates. Permission to create a PR is not permission to merge it; permission to merge is not permission to deploy or reset data. This direction PR remains open.

After a squash merge, start later work from updated `main`, not the old feature branch. Do not delete branches or alter repo settings as part of this documentation request.

## State and historical evidence

Update only `PROJECT_STATE.md` for live phase status and handoff. Specs/plans define requirements, and focused logs/PRs contain evidence. The old assessment checklist, verification log, and release records remain historical references and cannot mark the rebuild verified.
