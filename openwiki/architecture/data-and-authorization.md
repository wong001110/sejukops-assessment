---
type: architecture
title: Data and Authorization Boundaries
description: Security, data-scope, privileged-service, storage, and audit boundaries for SejukOps.
tags:
  - authorization
  - database
  - storage
  - security
updated: 2026-08-11
---

# Data and Authorization Boundaries

## Trust Model

The assessment uses a demo session to select an identity, but a cookie role is not sufficient authority for privileged data access. Server services that use the service-role client must resolve the corresponding database profile and require the profile to be active and to have the expected role before reading private records, minting signed URLs, or mutating data.

Database mutation RPCs independently recheck actor, role, assignment, lifecycle state, and idempotency constraints. The browser never receives the Supabase service-role key or plaintext AI credentials.

Key locations:

- `src/lib/auth/server.ts`
- `src/lib/auth/permissions.ts`
- `src/lib/supabase/privileged-server.ts`
- service entry points under `src/lib/services/`
- security-definer functions and grants under `supabase/migrations/`

## Role and Data Scope

| Role | Operational scope | Important restrictions |
|---|---|---|
| Admin | Organisation-wide order administration and AI configuration | Must be an active Admin profile; configuration secrets are server-only |
| Technician | Current jobs assigned to the active Technician record | Cannot directly reschedule; cannot access another Technician's jobs or evidence |
| Manager | Organisation-wide review, scheduling, dashboard, and controlled AI operations | Must be an active Manager profile; AI tools are allow-listed and bounded |

Branches are operational dimensions for orders, schedules, technicians, filtering, and reporting. They are not currently a separate branch-RBAC system. See [`docs/OPERATIONS_RULES.md`](../../docs/OPERATIONS_RULES.md).

## Database and RLS

- RLS is enabled on protected tables.
- Browser/normal authenticated access is intentionally narrower than privileged server orchestration.
- Sensitive mutations use explicit service-role-only RPC grants rather than generic table writes.
- Transactional functions enforce lifecycle transitions and duplicate-side-effect protection.
- Audit events preserve business state changes and actor context.
- Applied migrations are forward-only; do not edit a migration already applied to the shared project.

The SQL Editor deployment history and the Supabase migration ledger are separate concerns. Before a future CLI `db push`, repair the migration ledger to reflect SQL Editor-applied versions.

## Private Storage

The `service-evidence` bucket is private. Application state is recorded in database staging/canonical tables; a Storage listing is not the source of truth.

The upload pattern is:

1. authorize and reserve a bounded upload in the database
2. mint a short-lived signed upload authorization
3. upload directly from the browser to private Storage
4. confirm the actual object metadata server-side
5. mark the database record uploaded or a truthful failure/orphan state
6. bind canonical evidence/receipt records inside the completion transaction

Evidence, payment receipts, and document-import sources use distinct domain records even when they share the private bucket. See `src/lib/services/technician-completion/` and `src/lib/services/document-understanding/`.

## Idempotency

Mutation request keys are part of the domain boundary, not only a UI double-click guard. Transactional ledgers/advisory locks preserve exact replay outcomes and reject reuse with a different target or payload. Client code retains a request key across ambiguous failures and rotates it only after a terminal outcome or a genuinely new operation.

## Verification Pointers

- Authorization tests: `tests/foundation/`, `tests/technician/`, `tests/ai-config/`, `tests/document-understanding/`
- Migration boundary tests: feature-specific `*-migration.test.ts` files
- Live evidence: [`docs/testing/VERIFICATION_LOG.md`](../../docs/testing/VERIFICATION_LOG.md)
