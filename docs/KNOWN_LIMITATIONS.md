# Known Limitations

This document records assessment and release caveats. It does not replace the authoritative checklist or verification log.

## Evidence still required for final submission

- The Phase 9 items in [the implementation checklist](IMPLEMENTATION_CHECKLIST.md) remain the source of truth for release status.
- Human UAT is `NOT_RUN` until a human executes and reports the scenarios in the [Human UAT script](testing/TEST_MATRIX.md#human-uat-script). Agent tests cannot substitute for this evidence.
- The full release scenarios, including cross-role flow, rescheduling, AI configuration/Operations AI, document import, production build/deploy smoke, secret-exposure review, and deterministic seed review, are defined in [`VG-RELEASE`](testing/TEST_MATRIX.md#12-release-full-assessment-flow).
- A public Vercel target exists at `https://sejukops-assessment.vercel.app`, but final submission still requires verifying that the production alias points to the final approved `main` commit and re-running the relevant deployment smoke checks.

## Environment-dependent behavior

- A real Supabase project and the required public configuration are needed to verify live database and private-storage paths. Applying migrations and seed data is a deliberate operator action; local development does not apply them automatically.
- The assessment database was migrated through the Supabase SQL Editor. Before adopting CLI-managed `supabase db push`, repair the remote migration ledger for versions `202608100001` through `202608100014` and `202608110015`; otherwise the files and the remote ledger will disagree even though the schema is present.
- Persisted AI BYOK profiles require `AI_CONFIG_ENCRYPTION_KEY`. A missing key must leave encrypted credential persistence `PENDING_ENV`; plaintext fallback is not permitted.
- Real provider connection, Operations AI, Workflow Supervisor explanation, and vision/scanned-document extraction require a compatible configured provider and its secret. The reference DeepSeek/MiMo credentials are optional deployment fallbacks, not a guarantee that those providers were exercised.
- The OpenRouter credential used during development was exposed to local browser-automation output and must be rotated before non-development use. Update both the local environment and any encrypted saved profile after rotation; no credential value is committed here.
- WhatsApp handling is a deep-link/opening action with observable application state. It does not prove an external message was delivered or read.

## Release and dependency boundary

- Vercel is configured as the public hosting target. A deployment being reachable does not by itself prove that it contains the final approved `main` commit; verify commit alignment and smoke the production routes before submission.
- Production dependencies are pinned through `pnpm` overrides for patched PostCSS and Sharp versions. Re-run `pnpm audit --prod` and the full build whenever those overrides or Next.js are upgraded.

See [Environment Requirements](ENVIRONMENT_REQUIREMENTS.md) for variable definitions, sensitivity, and precise re-verification requirements.

## Assessment-oriented design choices

- Authentication is a mock role switcher for assessment demonstration, not production identity/authentication.
- The deterministic seed is intended for reproducible assessment scenarios and golden facts; use a disposable project rather than operational data.
- Operations AI is deliberately limited to allow-listed tools and does not provide arbitrary SQL or unrestricted database access.
- Document Understanding is a human-in-the-loop workflow: extraction produces a draft and only explicit confirmation may create an operational record.
- `openwiki/` is a repository documentation layer only. It adds no runtime LangChain, OpenWiki, OpenRouter, RAG, or external-model dependency.

## How to close a limitation

Provide only the needed environment value through local/deployment configuration, run the smallest affected verification group(s), and record the actual result in [`docs/testing/VERIFICATION_LOG.md`](testing/VERIFICATION_LOG.md). Broaden to `VG-RELEASE` only for the release candidate. Do not edit a `PENDING_ENV`, Agent E2E, or Human UAT status to `PASS` without the corresponding evidence.