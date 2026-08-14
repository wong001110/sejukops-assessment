# Known Limitations

This document records the current assessment caveats and intentional non-goals for the final submission build.

Final release evidence is recorded separately in:

- [`testing/FINAL_HUMAN_UAT.md`](testing/FINAL_HUMAN_UAT.md)
- [`testing/FINAL_RELEASE_VERIFICATION.md`](testing/FINAL_RELEASE_VERIFICATION.md)

Historical phase documents may contain `NOT_RUN`, `PENDING_ENV`, or `HUMAN_UAT_PENDING` entries that were accurate when those phases were recorded. They should not be interpreted as the current final-release state.

## Final release evidence boundary

The integrated human workflow UAT was reported **PASS** on 2026-08-14.

The approved release was promoted to `main` and deployed to the public Vercel target:

`https://sejukops-assessment.vercel.app`

Production deployment reached **READY**. Final smoke verification confirmed the landing page responds successfully and protected Admin access without a demo session is redirected as expected. A final Vercel runtime-error audit found no runtime errors in the checked release window.

## Authentication

Authentication is intentionally a mock role switcher because the assessment explicitly permits mock login / role switching.

This is not production authentication or identity management. A production implementation should replace it with real authentication and RBAC while preserving the existing business-service permission and data-scope boundaries.

## WhatsApp boundary

The WhatsApp implementation demonstrates:

- generation of the customer feedback deep link
- application-side READY state
- application-side OPENED state when the action is opened

It does **not** claim that WhatsApp externally delivered, displayed, or read the message.

## Payment and supporting-document boundary

Payment capture is optional. When payment is recorded, Payment Amount and Payment Method form one structured payment record and must be supplied together.

A Receipt / Supporting Document is independent from payment. It can be attached without a payment record and is intended for Manager human review.

The system does not OCR the supporting document or attempt to prove that its amount/method matches structured payment fields.

## Operations AI boundary

Operations AI is deliberately limited to approved controlled tools. It does not provide arbitrary SQL or unrestricted database access.

The planner remains bounded to at most one approved tool call per user request. Existing tools may accept bounded multi-value filters where appropriate; this increases parameter expressiveness without creating a general autonomous multi-tool loop.

Unsupported requests return a controlled unsupported/clarification path rather than inventing executable tools.

## Provider-dependent AI behavior

Provider-backed features require a compatible configured provider and valid credential.

This includes:

- Operations AI planning
- optional Workflow Supervisor explanation
- Operational Insight interpretation
- Document Understanding extraction, especially image/scanned-document routes requiring vision capability

Provider failure does not silently fall back to an unconfigured paid provider.

## Document Understanding

Document Understanding is human-in-the-loop. Extraction produces a schema-validated editable draft; explicit Admin confirmation is required before an operational order is created.

A provider failure, invalid model response, timeout, or capability mismatch must leave operational records untouched.

## Workflow Supervisor and Operational Insight

Workflow Supervisor anomaly detection is deterministic where possible. AI explanation does not replace the deterministic rule.

Operational Insight receives deterministic KPI facts and is decision support only. Neither feature is allowed to autonomously perform Manager actions or own lifecycle transitions.

## No runtime RAG / vector knowledge base

The assessment build intentionally does not contain a runtime RAG/vector knowledge base.

Current operational questions concern structured transactional data, for which controlled queries are simpler and easier to constrain. A future internal document corpus containing SOPs, policies, manuals, safety procedures, or training material would justify a separate citation-grounded retrieval path.

## Supabase migration ledger maintenance

The live Supabase schema is working and the final assessment workflows were exercised against it.

However, early migrations were applied through the Supabase SQL Editor before migration-history tracking was introduced. The remote `supabase_migrations.schema_migrations` ledger therefore does not reconstruct every historical repository migration even though the schema is present.

Recent tool-applied migrations are tracked, including the AI Operations multi-filter and supporting-document migrations.

Before adopting a strict future `supabase db push` workflow against this existing project, reconcile/repair the remote migration ledger first. This is deployment-maintenance debt, not a blocker for the current verified assessment demo.

## Development credential rotation

A development OpenRouter credential was previously exposed to local browser-automation output. No credential value is committed to the repository, but that development credential must not be reused for non-development purposes unless it has been rotated.

Current saved provider profiles remain server-side/encrypted; this document does not expose credential values.

## Deterministic assessment data

The seed data is designed for reproducible assessment scenarios and golden facts. It should be used against a disposable assessment project rather than operational data that must be retained.

## Dependency / hosting boundary

Vercel is the public hosting target. A future dependency or framework upgrade should re-run the full build/regression/security checks rather than assuming the current release evidence remains valid.

The final submission build is intentionally treated as a bounded assessment release, not as a claim of production-readiness for a real field-service company.
