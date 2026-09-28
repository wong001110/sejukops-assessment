# Documentation Authority

## Active rebuild documents

| Document | Responsibility |
| --- | --- |
| [Product direction](PRODUCT_DIRECTION.md) | Accepted product outcomes, scope, and exclusions. |
| [Architecture](ARCHITECTURE.md) | Target boundaries, shared capabilities, security, and stack direction. |
| [Implementation plan](IMPLEMENTATION_PLAN.md) | Adaptive phases and stable acceptance IDs. |
| [Project state](../PROJECT_STATE.md) | The only mutable rebuild progress/evidence summary. |
| [Agent rules](../AGENTS.md) | Bootstrap, current authorization, and hard boundaries. |
| [Development protocol](DEVELOPMENT_PROTOCOL.md) | AI-Native Development Practice. |
| [Git workflow](GIT_WORKFLOW.md) | Branch, PR, verification, and merge rules. |

The target architecture is not a claim about the existing application. Phased rebuild development is now authorized and P1 is in progress; actual evidence and remaining work are in [PROJECT_STATE.md](../PROJECT_STATE.md). Production deployment remains separate.

## Assessment-era references

Other pre-existing documents, including `SYSTEM_SPEC.md`, `OPERATIONS_RULES.md`, `AI_CONFIGURATION.md`, `AI_RUNTIME_BEHAVIOR.md`, `KNOWN_LIMITATIONS.md`, and the existing files under `testing/`, describe the assessment baseline. They remain useful for understanding source, old invariants, and historical evidence, but **do not override the active rebuild documents or authorize implementation**. `IMPLEMENTATION_CHECKLIST.md` now redirects rebuild progress to `PROJECT_STATE.md` and links to its historical baseline.

Old requirements such as one-tool-only Operations AI, mock role cookies, assessment submission gates, or a fixed implementation-agent topology are not mandates for the rebuild. Historical `VERIFIED` / UAT results must not be copied into the new phase state.

The complete baseline can be inspected at [commit 8fe1a523](https://github.com/wong001110/sejukops-assessment/tree/8fe1a52378f1aa2976cab4b6d6b4b9497ab983b3). During authorized implementation, migrate useful documentation into the active model and remove or label superseded runtime documentation in the same feature PR. Do not maintain competing active progress trackers.

OpenWiki remains a derived code-navigation aid; its existing detail pages describe the baseline until refreshed with verified implementation evidence. It is not the product's RAG knowledge base.
