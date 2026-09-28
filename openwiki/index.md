---
okf_version: "0.1"
title: Sejuk Ops Repository Knowledge
description: Navigation that distinguishes the agent-native target from the assessment implementation.
---

# Sejuk Ops Repository Knowledge

OpenWiki is a derived developer/agent navigation layer, not the product RAG Knowledge Base, an execution harness, or an application dependency.

## Start with current direction

- [AGENTS.md](../AGENTS.md) — assignment and development rules.
- [PROJECT_STATE.md](../PROJECT_STATE.md) — the only live state ledger; currently documentation-only, implementation not started.
- [Target specification](../docs/SYSTEM_SPEC.md) and [phase plan](../docs/plans/agent-native-rebuild.md).
- [Development protocol](../docs/DEVELOPMENT_PROTOCOL.md) and [documentation map](../docs/README.md).

The new target replaces assessment constraints; it does not turn planned Auth, workspace isolation, RAG, agent execution, or MCP into existing features.

## Existing implementation navigation (assessment baseline)

- [System overview](architecture/system-overview.md).
- [Data and authorization](architecture/data-and-authorization.md).
- [Operations lifecycle](workflows/operations-lifecycle.md).
- [AI capabilities](workflows/ai-capabilities.md).
- [Verification and delivery](engineering/verification-and-delivery.md).
- [OpenWiki instructions](INSTRUCTIONS.md).

These pages describe the existing assessment and may retain superseded constraints, old checklist references, and older development instructions. Use them to locate code; verify facts before reusing them. For new direction/methodology/current state, the active documents above take precedence, including over older OpenWiki instructions. Do not copy historical release or human-UAT success into new acceptance.

## Maintenance

Refresh relevant derived pages after meaningful implementation/architecture changes, not every minor edit. Mark intent versus implemented behavior, link actual source/evidence, preserve security boundaries, and avoid secret/private data. Do not duplicate phase state here or add Agent Continuity machinery to the repo.
