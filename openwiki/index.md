---
okf_version: "0.1"
title: SejukOps Repository Knowledge
description: Navigation entry point for durable, coding-agent-oriented SejukOps knowledge.
---

# SejukOps Repository Knowledge

This directory is a living knowledge layer for developers and coding agents. It applies the OpenWiki documentation concept using repository-native Markdown only. SejukOps does not depend on LangChain or OpenWiki at runtime, and this knowledge layer does not require an external model provider.

## Start Here

- [System overview](architecture/system-overview.md) — application shape, roles, modules, and important source locations
- [Data and authorization boundaries](architecture/data-and-authorization.md) — trust boundaries, branch semantics, storage, RLS, and privileged services
- [Operations lifecycle](workflows/operations-lifecycle.md) — order, scheduling, completion, review, notification, and dashboard flows
- [AI capabilities](workflows/ai-capabilities.md) — BYOK configuration, controlled Operations AI, Workflow Supervisor, and Document Understanding
- [Verification and delivery](engineering/verification-and-delivery.md) — testing levels, evidence, phase PRs, and update discipline
- [Repository instructions](INSTRUCTIONS.md) — scope, authority hierarchy, and maintenance rules

## Authority and Freshness

These pages are derived navigation aids. When a statement conflicts with another source, use this order:

1. accepted product and system specifications under `docs/`
2. verified source code and tests
3. this knowledge layer

Progress claims must be checked against [`docs/IMPLEMENTATION_CHECKLIST.md`](../docs/IMPLEMENTATION_CHECKLIST.md), while test and E2E evidence must be checked against [`docs/testing/VERIFICATION_LOG.md`](../docs/testing/VERIFICATION_LOG.md). Branch work must not be described as accepted `main` behavior before its PR is accepted and squash-merged.

## Maintenance Contract

Update this knowledge layer after a phase, major feature, architecture change, or important source relocation. Prefer a small focused page change over regenerating unrelated documentation. Every factual page should:

- link to authoritative specifications and important implementation entry points
- distinguish design intent from verified implementation state
- preserve security, authorization, idempotency, and failure boundaries
- avoid secrets, signed URLs, local environment values, and human-UAT claims
- remain readable without any special documentation tool

