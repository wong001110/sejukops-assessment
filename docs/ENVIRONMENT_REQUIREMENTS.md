# SejukOps Environment Requirements

This file is the committed definition of environment/configuration values that may be required during development, integration, and verification.

**Do not place real secret values in this file.**

Current-machine status belongs in the gitignored file:

```text
.agent/environment-status.local.md
```

The local status file records only `CONFIGURED`, `MISSING`, `INVALID`, `UNKNOWN`, or similar status metadata — never the value itself.

---

## 1. Environment Status Rules

When a value is missing:

- block only the implementation/integration/test path that actually depends on it
- mark dependent work `PENDING_ENV`
- continue unrelated work
- use mocks/contracts for development where meaningful
- record which verification group/test cases must be rerun after the value is supplied

When a human later configures the value, rerun the previously blocked/affected verification groups before escalating to broader regression.

---

## 2. Required / Expected Configuration

### `NEXT_PUBLIC_SUPABASE_URL`

**Definition**  
Public base URL of the Supabase project used by the SejukOps Web App.

**Used by**

- browser/server Supabase client configuration
- order/service/dashboard data access
- file storage access

**Sensitive**  
No. It is public project configuration, but it should still be supplied through environment configuration rather than hard-coded across source files.

**Expected source**  
Supabase project settings.

**If missing**

- real Supabase integration is `PENDING_ENV`
- UI and service contracts may still be developed with mocks
- database/storage integration and related E2E cannot be verified

**Re-verification after configured**

- Supabase connection smoke test
- schema/migration verification
- relevant CRUD/integration groups

---

### `NEXT_PUBLIC_SUPABASE_ANON_KEY`

**Definition**  
Supabase anonymous/public API key used by permitted browser-facing Supabase access.

**Used by**

- browser Supabase client where required
- RLS-governed public/anonymous project access if used

**Sensitive**  
Not treated as a server secret in Supabase's normal client model, but it must not be confused with a service-role key.

**Expected source**  
Supabase project API settings.

**If missing**

- browser Supabase integration is `PENDING_ENV`
- mocked frontend development may continue

**Re-verification after configured**

- client connection test
- role/data-scope integration paths that use the client

---

### `SUPABASE_SERVICE_ROLE_KEY`

**Definition**  
Privileged Supabase server credential that bypasses normal RLS restrictions.

**Status for this assessment**  
**Conditional.** Do not introduce it unless implementation genuinely requires privileged server-side operations.

**Used by**

- server-only administrative operations, if such operations cannot be implemented safely with the normal project authorization design

**Sensitive**  
Yes — highly sensitive.

**Rules**

- server-side only
- never use a `NEXT_PUBLIC_` prefix
- never expose it to browser bundles or logs
- do not use it merely as an easy way to avoid authorization design

**If missing**

- no blocker unless a documented server-only feature explicitly depends on it

---

### `AI_CONFIG_ENCRYPTION_KEY`

**Definition**  
Server-side high-entropy secret used to encrypt/decrypt persisted BYOK provider credentials stored by SejukOps.

**Used by**

- Admin AI Provider Settings
- encrypted `ai_provider_configs` credential storage
- runtime provider-client construction

**Sensitive**  
Yes.

**Expected format**  
A high-entropy application secret. Prefer a 32-byte random value represented in the format expected by the chosen encryption implementation (for example base64). Final exact parsing rules must match the library/crypto implementation selected during development.

**If missing**

- AI Settings UI and schemas may still be developed
- encrypted credential persistence/integration is `PENDING_ENV`
- plaintext fallback storage is **not allowed**

**Re-verification after configured**

- encryption/decryption round-trip test
- save/update/delete provider credential integration test
- verify saved plaintext is not returned to browser/logs

---

## 3. AI provider configuration

AI providers are configured exclusively through encrypted Admin-managed provider profiles. There are no deployment-level provider credential fallbacks. Runtime AI resolution with a blank route, missing profile, or inactive profile reports `AI_NOT_CONFIGURED`.

Only encrypted saved Admin provider profiles are supported; deployment environment credentials are not read by the runtime.

### `AI_CONFIG_ADMIN_PASSWORD`

**Definition**  
Server-only password that unlocks otherwise read-only Demo Admin AI configuration actions.

**Sensitive**  
Yes. Use a unique password of at least 12 characters. Never expose it in browser code, source, screenshots, or logs.

### `AI_CONFIG_SESSION_SECRET`

**Definition**  
Server-only non-empty random string used to derive the signing key for the short-lived AI configuration unlock cookie. Base64 is optional; no specific encoding is required.

**Sensitive**  
Yes. Rotate it to invalidate all existing unlock sessions.

---

## 4. Optional Application URL

### `NEXT_PUBLIC_APP_URL`

**Definition**  
Canonical public application URL when a feature needs an absolute URL outside request context.

**Status for this assessment**  
Optional until a concrete feature requires it.

**Sensitive**  
No.

**If missing**

- use request-derived origin where appropriate
- do not block unrelated development

---

## 5. Local Environment Status Template

Agents should create/update the following **uncommitted** file:

```text
.agent/environment-status.local.md
```

Suggested content:

```text
# Local Environment Status

Updated: <timestamp>

NEXT_PUBLIC_SUPABASE_URL       CONFIGURED | MISSING | UNKNOWN
NEXT_PUBLIC_SUPABASE_ANON_KEY  CONFIGURED | MISSING | UNKNOWN
SUPABASE_SERVICE_ROLE_KEY      NOT_REQUIRED | CONFIGURED | MISSING | UNKNOWN
AI_CONFIG_ENCRYPTION_KEY       CONFIGURED | MISSING | UNKNOWN
NEXT_PUBLIC_APP_URL            CONFIGURED | MISSING | NOT_REQUIRED

## Pending re-verification
- <verification group / test id>: waiting for <variable name>
```

Do not include key prefixes, partial secrets, full secrets, access tokens, or copied credential screenshots.

---

## 6. Human Handoff Rule

When the Main Agent needs a human to configure a missing value, the handoff must state:

1. exact variable name
2. plain-language definition
3. why it is needed
4. where the human obtains/configures it
5. whether it is sensitive
6. which work is blocked
7. which work continues independently
8. which verification groups will be rerun after configuration

This allows development to proceed without losing track of deferred real-integration verification.
