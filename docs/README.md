# Documentation Map

## Active rebuild direction

| Document | Authority |
| --- | --- |
| [AGENTS.md](../AGENTS.md) | Agent rules and assignment boundary. |
| [PROJECT_STATE.md](../PROJECT_STATE.md) | Only live execution state; authorization, phase progress, evidence limits, next handoff. |
| [SYSTEM_SPEC.md](SYSTEM_SPEC.md) | Target product, architecture, data/security boundaries, stack direction. |
| [Rebuild plan](plans/agent-native-rebuild.md) | Phase scope/dependencies and acceptance IDs; not a second status ledger. |
| [DEVELOPMENT_PROTOCOL.md](DEVELOPMENT_PROTOCOL.md) | AI-Native Development Practice. |
| [GIT_WORKFLOW.md](GIT_WORKFLOW.md) | PR/commit/merge discipline. |

**Target is not implementation.** Source code still represents the assessment baseline until later explicitly authorized work changes it. This PR only changes documentation.

## Assessment references retained for inspection

Other existing specifications, AI configuration/runtime/observability notes, UI stack notes, operational rules, environment/seed descriptions, evaluation documents, and `docs/testing/` records describe the old application unless a later rebuild phase explicitly refreshes them. Inspect them with corresponding source to reuse useful behavior; do not treat old mock-auth, no-RAG, single-tool, Manager-only assistant, Admin-provider-settings, or release-status statements as target requirements.

The previous versions of replaced entry-point documents remain in [baseline commit `8fe1a52`](https://github.com/wong001110/sejukops-assessment/tree/8fe1a52378f1aa2976cab4b6d6b4b9497ab983b3). No historical tests/UAT are claimed for the rebuild. [IMPLEMENTATION_CHECKLIST.md](IMPLEMENTATION_CHECKLIST.md) now directs all live status to the project-state file.

OpenWiki is derived navigation. It is neither the runtime Knowledge Base nor a higher authority than the current request/specification. Refresh affected pages when implementation changes reality, rather than rewriting every historical document in this planning PR.
