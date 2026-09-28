---
okf_version: "0.1"
title: Sejuk Ops Repository Knowledge
description: Derived source navigation; rebuild direction and implementation state are explicitly separate.
---

# Sejuk Ops Repository Knowledge

OpenWiki is a derived code-navigation layer for developers, not the product's runtime RAG knowledge base and not an agent execution framework.

## Start with the active direction

Read [AGENTS.md](../AGENTS.md), [PROJECT_STATE.md](../PROJECT_STATE.md), and [documentation authority](../docs/README.md). Then use [product direction](../docs/PRODUCT_DIRECTION.md), [target architecture](../docs/ARCHITECTURE.md), and [implementation plan](../docs/IMPLEMENTATION_PLAN.md).

**P1 development is in progress; the rebuild is not implemented yet.** Use [PROJECT_STATE.md](../PROJECT_STATE.md) for current evidence rather than inferring completion from the phase plan.

## Existing source navigation

These detail pages describe the assessment baseline until updated after verified implementation:

- [System overview](architecture/system-overview.md)
- [Data and authorization boundaries](architecture/data-and-authorization.md)
- [Operations lifecycle](workflows/operations-lifecycle.md)
- [AI capabilities](workflows/ai-capabilities.md)
- [Verification and delivery](engineering/verification-and-delivery.md)
- [Legacy knowledge maintenance instructions](INSTRUCTIONS.md)

Old mock-auth, one-tool-only runtime, fixed agent-topology, checklist, and assessment-submission descriptions do not override the new active direction/development protocol. Historical acceptance is not rebuild acceptance.

## Maintenance

Update the relevant derived pages after meaningful implemented changes, not after every small edit. Link factual claims to code and actual evidence; label planned behavior separately. Do not regenerate unrelated wiki pages or introduce a runtime dependency. When instructions conflict, the latest user direction, root AGENTS, active specifications, and actual implementation evidence take precedence over this layer.
