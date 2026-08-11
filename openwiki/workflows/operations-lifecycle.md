---
type: workflow
title: Operations Lifecycle
description: Order, scheduling, Technician completion, Manager review, notification, and dashboard flow.
tags:
  - orders
  - scheduling
  - completion
  - review
updated: 2026-08-11
---

# Operations Lifecycle

## Authoritative Order States

```mermaid
stateDiagram-v2
    [*] --> NEW
    NEW --> ASSIGNED
    ASSIGNED --> IN_PROGRESS
    IN_PROGRESS --> JOB_DONE
    JOB_DONE --> REVIEWED
    REVIEWED --> CLOSED
    JOB_DONE --> IN_PROGRESS: clarification requested
```

Transitions are constrained in PostgreSQL and mirrored by browser-safe contracts. Never add a UI-only state or bypass a transactional transition merely to simplify a screen.

## Admin Submission and Scheduling

Admin creates or reuses a customer by normalized phone, creates an order, optionally assigns an active Technician from the selected branch, and records audit history atomically. Direct rescheduling creates an executed reschedule event; it does not rewrite history. Technician requests create pending requests for Admin/Manager resolution and do not directly alter the schedule.

Malaysia time (`Asia/Kuala_Lumpur`) is authoritative for operational dates, period boundaries, and same-day reschedule classification. Shared helpers live in `src/lib/time/malaysia.ts`.

## Technician Job Flow

```mermaid
flowchart TD
    L["Assigned jobs list"] --> D["Job detail"]
    D --> S["Start job"]
    S --> E["Reserve, upload, and confirm evidence"]
    E --> C["Submit completion transaction"]
    C --> R["JOB_DONE and service report"]
    R --> N["Prepare customer notification"]
    R --> F["Generate deterministic workflow flags"]
    R --> Q["Manager review queue"]
```

Completion calculates the authoritative final amount from the quote snapshot plus extra charges. Evidence and an optional payment receipt are bound atomically. Exact completion replay must not duplicate reports, payments, attachments, audits, notifications, or flags.

## Clarification and Revision

A Manager clarification returns the order to `IN_PROGRESS`, keeps prior review/payment/evidence history, notifies the assigned Technician with the clarification note, and permits a new completion revision. Workflow flags and completion notifications are revision-aware so historical records remain truthful while current queues use the latest revision.

## WhatsApp Boundary

SejukOps prepares an encoded WhatsApp deep link rather than sending a background message. Only a user-initiated POST may mark a prepared notification `OPENED` and redirect/open the `wa.me` URL. A state-changing GET is not permitted. Core job completion remains committed even when notification preparation fails.

## Dashboard Effects

Manager KPIs are computed server-side for fixed Malaysia-time periods. Client query keys include the selected period, and known cross-role mutations invalidate only the Manager dashboard family. AI Operational Insight is secondary: KPI data remains visible when insight generation fails.

## Primary Sources

- [`docs/SYSTEM_SPEC.md`](../../docs/SYSTEM_SPEC.md)
- [`docs/OPERATIONS_RULES.md`](../../docs/OPERATIONS_RULES.md)
- [`docs/DASHBOARD_AND_NOTIFICATION_SPEC.md`](../../docs/DASHBOARD_AND_NOTIFICATION_SPEC.md)
- `src/lib/services/admin-orders/service.ts`
- `src/lib/services/technician-jobs/service.ts`
- `src/lib/services/technician-completion/service.ts`
- `src/lib/services/manager-review/service.ts`
- `src/lib/services/manager-dashboard/service.ts`
