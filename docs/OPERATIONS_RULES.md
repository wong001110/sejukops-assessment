# SejukOps Operational Rules

This document is authoritative for branch modelling, scheduling/rescheduling, service evidence upload, completion idempotency, and the assessment treatment of the Accounts role.

## 1. Branch Model

The fictional company operates multiple branches, so branch ownership should exist in the data model even though the assessment does not require a full Branch Management UI.

### Core table

```text
branches
- id UUID PK
- code TEXT UNIQUE
- name TEXT
- address TEXT nullable
- active BOOLEAN
- created_at TIMESTAMP
- updated_at TIMESTAMP
```

### Relationships

```text
technicians.branch_id -> branches.id
orders.branch_id      -> branches.id
```

A Technician belongs to one primary branch for the assessment. The model can evolve later if cross-branch team membership becomes a real requirement.

Admin and Manager use organisation-wide scope in the assessment demo. Technician actions remain constrained by assignment, not merely by matching branch.

### What branch support does not imply

The assessment does not need:

- branch CRUD screens
- complex branch-level RBAC
- separate deployments per branch
- a branch selector on every screen

The purpose is to avoid losing an important business dimension in the schema and to keep future branch-level reporting/querying possible.

## 2. Scheduling Model

Orders should keep their active schedule separately from lifecycle status.

Suggested fields:

```text
orders.scheduled_at TIMESTAMP nullable
```

Scheduling does not introduce `RESCHEDULED` as a permanent order status. The main lifecycle remains:

```text
NEW -> ASSIGNED -> IN_PROGRESS -> JOB_DONE -> REVIEWED -> CLOSED
```

## 3. Reschedule Permissions

### Admin

May directly reschedule an order.

### Manager

May directly reschedule an order.

### Technician

May not directly change `scheduled_at`.

A Technician may submit a reschedule request with a required reason.

## 4. Reschedule Request Model

```text
order_reschedule_requests
- id UUID PK
- order_id UUID FK
- requested_by UUID FK -> profiles.id
- requested_schedule TIMESTAMP nullable
- reason TEXT NOT NULL
- status TEXT # PENDING | APPROVED | REJECTED | CANCELLED
- resolved_by UUID FK nullable
- resolution_note TEXT nullable
- created_at TIMESTAMP
- resolved_at TIMESTAMP nullable
```

A Technician request should notify the relevant Admin/Manager review surface in-app.

When Admin/Manager approves a request, or directly changes the schedule without a request, the actual schedule change is recorded in `order_reschedules`.

## 5. Reschedule Event Model

```text
order_reschedules
- id UUID PK
- order_id UUID FK
- previous_schedule TIMESTAMP nullable
- new_schedule TIMESTAMP
- reason TEXT nullable
- source TEXT # DIRECT_ADMIN | DIRECT_MANAGER | TECHNICIAN_REQUEST
- source_request_id UUID nullable
- created_by UUID FK -> profiles.id
- same_day BOOLEAN
- created_at TIMESTAMP
```

`same_day` is calculated in the application/business timezone from the previous and new schedule dates.

### Counting rule

Every executed schedule change is recorded and counts as a reschedule event, including a time change that stays on the same calendar day.

This preserves the raw operational event. Future analytics can exclude same-day changes by filtering `same_day = false` without losing history.

### Notifications

- Technician request -> notify Admin/Manager in-app.
- Admin/Manager executes a reschedule -> notify the assigned Technician in-app.
- Customer reschedule messaging is not required for the assessment and is not part of the WhatsApp completion-notification module.

## 6. Service Evidence Storage

Use **Supabase Storage** for Technician service evidence as requested by the assessment stack guidance.

Use a private bucket such as:

```text
service-evidence
```

Suggested object path:

```text
{orderId}/{attachmentId}-{sanitisedFilename}
```

Application metadata remains in PostgreSQL; storage object listing is not treated as application state.

## 7. Upload Limits

Assessment requirement: maximum **6 evidence files per service report**.

Recommended project contract:

### Images

Accepted MIME types:

```text
image/jpeg
image/png
image/webp
```

Recommended per-file maximum:

```text
12 MB
```

### Video

Accepted MIME types:

```text
video/mp4
video/quicktime
video/webm
```

Recommended per-file maximum:

```text
75 MB
```

### PDF

Accepted MIME type:

```text
application/pdf
```

Recommended per-file maximum:

```text
15 MB
```

### Total per service report

Recommended maximum combined upload size:

```text
120 MB
```

These are SejukOps assessment defaults and can be tuned later if actual field evidence requires different limits.

## 8. Upload Behaviour

The client should validate file count, MIME type, and obvious size violations before upload, but the server/storage path must enforce the authoritative policy as well.

Expected behaviour:

```text
select files
-> validate count/type/size
-> upload valid files to Supabase Storage
-> persist attachment metadata
-> show individual success/failure state
```

Partial failure must not discard successful uploads. Failed items remain retryable.

Do not transcode video in the assessment implementation.

Optional client-side image optimisation is allowed if it does not degrade evidence readability, but it is not required for assessment completion.

## 9. Attachment Access

Evidence is operational/customer data and should not be a public bucket by default.

Access should be limited to the application paths/roles that are allowed to inspect the relevant order:

- assigned Technician while performing the job
- Admin
- Manager

Use authenticated/private access or server-generated signed access appropriate to the chosen Supabase implementation.

## 10. Orphan Handling

If the storage upload succeeds but metadata persistence fails, attempt best-effort cleanup of the newly uploaded object.

If immediate cleanup cannot be guaranteed, orphan objects should be identifiable through naming/metadata and may be removed later by a maintenance cleanup path.

For the assessment, a full scheduled cleanup service is optional; the code must at least avoid silently treating storage listing as authoritative state.

## 11. Job Completion Idempotency

The Technician mobile workflow must tolerate accidental double submission, retry after a slow network response, or repeated client requests.

### Client-side protection

- disable the completion action after the first accepted submit attempt
- show an explicit pending state
- do not rely on client protection as the only safety boundary

### Server-side protection

Completion must use a database transaction / atomic state guard.

Conceptually:

```text
BEGIN

verify assigned technician
verify current status = IN_PROGRESS
create/update the unique service report
calculate authoritative final amount
transition IN_PROGRESS -> JOB_DONE only if current state still matches
write completion audit event

COMMIT
```

`service_reports.order_id` should remain unique.

A repeated completion request after the first successful commit must not create a second service report or repeat the lifecycle transition.

### Side effects

Secondary side effects such as WhatsApp preparation and workflow-flag generation must also be duplicate-safe.

Use an upsert/unique business key or equivalent guard so a retry cannot create multiple completion notifications for the same completion event.

WhatsApp preparation failure remains non-transactional relative to the core valid completion: a completed job must stay `JOB_DONE` even if the customer deep-link cannot be prepared immediately.

## 12. Accounts Role Decision

The assessment mentions Manager/Accounts notification as an optional completion bonus but only defines Admin, Technician, and Manager as the example role set.

SejukOps does **not** add a separate Accounts role for the assessment.

The completion-notification requirement is represented by:

```text
JOB_DONE
-> Manager in-app review queue
```

The authorization model remains extensible so an Accounts role can be introduced later without redefining the existing lifecycle.
