# Staff accounts and Owner perspectives

Accepted extension: 2026-10-01. This document defines intended behavior; implementation and evidence are recorded only in [PROJECT_STATE.md](../PROJECT_STATE.md).

## Formal staff access

Owner creates named Admin, Manager and Technician accounts from the private Owner workspace. Each staff account initially has one workspace and one business role. Technician accounts map to an active branch in that workspace. Staff are ordinary platform users and cannot manage provider credentials, staff identities, diagnostics or Demo reset. Guest access and the existing Owner identity remain separate.

Staff sign in with their own email and password. No invitation or reset email is sent. Creation or explicit reset generates a separate temporary password, delivered once through the authenticated Owner interface. Passwords are excluded from imports, persisted application records, audit, logs, recordings and exports. Lost delivery requires an explicit reset; retrying an import does not silently reset an existing account.

The temporary password allows onboarding only. Before a confirmed password change, business UI, API, direct database reads and RPCs deny access. A direct Auth password update cannot clear the application onboarding requirement. Completion verifies the current password, changes it through Auth, and advances the server-controlled onboarding revision. Failure leaves business access denied and supports retry with the current password.

Disabling, changing role/branch or resetting a password advances a session cutoff. Existing business sessions remain denied even after re-enable; sign-in creates a fresh session. Every consequential command checks current profile, membership, readiness and session authority inside its transaction. Concurrent administrative revocation and business execution use a defined transaction ordering.

Technician branch changes are allowed only when there is no assigned order history bound to the existing mapping. Otherwise the account UI returns a stable conflict and preserves that branch; historical orders are not silently moved.

The password-completion proof binds the private Auth password version after changing it and before signing in with the desired new password. A fresh proof session, current revision and single-use claim must all match. Derived password fingerprints are private equality sentinels; they are never sent to the browser or used as passwords.

## Owner perspective inspection

Owner can inspect Admin, Manager and Technician views within Owner data. Inspection is read-only and visibly labeled, with an explicit return to the normal Owner view. Technician inspection selects a current, active employee and shows that employee's assigned jobs. Admin/Manager inspection follows their business read capabilities.

The actual authenticated identity remains Owner. The server validates perspective and employee selection on every request; no employee password or impersonated session is issued. Bounded preview reads enforce scope in the database. Preview blocks manual changes, proposals/approvals/execution, intake confirmation, knowledge publication and mutation-capable AI calls. Audit records actual Owner and the effective employee context. Platform administration retains its independent Owner authorization.

Preview is held against the signed Auth session for at most one hour. Invalid, expired or removed employee selection remains restrictive until explicit exit. Knowledge preview exposes published, current-generation READY content. Signed non-null Owner session proofs are checked for liveness; deleting a session cannot restore write access when its preview row cascades away. Legacy service calls with a null Owner session proof remain compatible; this is not complete revocation of arbitrary legacy Owner JWTs without session claims.

## Excel onboarding

The `.xlsx` template has `name`, `email`, `role`, `branchCode` columns. Technician branch code is required; Admin/Manager branch code is blank. Password and extra columns, formulas, macros, external links and unsafe archives are rejected. The initial bound is 100 account rows and 1 MiB compressed input, with separate expanded-content bounds.

The flow is upload, row validation/preview, explicit confirmation, then per-row results. Confirmation processes bounded batches. Stopping a running import stops subsequent batches; completed accounts remain and their results stay visible. Retry is explicit and resumes only the same persisted operation. Existing accounts and duplicate emails are conflicts, never overwritten.

Invalid previews cannot be confirmed or create Auth identities. Valid drafts expire after 30 minutes unless confirmed, then remain resumable for 24 hours. Each confirmation leases at most ten rows for two minutes. A lost/expired response is reconciled with the same per-row operation; unavailable one-time passwords require an explicit reset and are not recovered from the ledger.

Auth and application SQL cannot share a transaction. Reserve a durable operation and deterministic target identity before Auth creation, reconcile uncertain responses against that identity and its server-owned provisioning marker, then atomically finalize profile, membership and Technician mapping. Unfinished provisioning denies business access. Concurrent requests and retries cannot create a second account or adopt an unrelated existing identity.

## Acceptance

| ID | Required evidence |
| --- | --- |
| STAFF-01 | Formal Admin/Manager/Technician login, Owner-managed creation/update/disable/reset, first-password onboarding, no email, isolated platform/workspace capabilities. |
| STAFF-02 | Direct DB/API/RPC onboarding denial; old-session denial after role/branch/disable/reset and re-enable; current-state command checks and negative ordinary-user escalation tests. |
| PREVIEW-01 | Actual Owner identity retained; role-appropriate DB-scoped reads, selected Technician assignment scope, forged/cross-workspace target denial and all preview mutation routes denied. |
| IMPORT-01 | Template and actual UI upload/preview/confirm/results/retry; invalid/formula/duplicate rows, bounded archives, double confirmation, partial failure and uncertain Auth reconciliation without overwrite or duplicate creation. |
| STAFF-UX-01 | Actual components first tested with synthetic API data for loading, empty, slow, errors, retry/cancel, double submit, stale responses and narrow layouts; live Test E2E follows those checks. |

Relevant existing gates remain AUTH-01, ISO-01, ADMIN-01, ACT-01, UX-01 and SAFE-01. Necessary targeted mutation and independent review evidence is separate from Mock, live integration, browser and human UAT. MCP, model red-team comparisons, production deployment and PR merge are outside this extension.
