# Operations dashboards — scoped implementation evidence

Implemented Admin, Manager and Technician dashboards with Today / This Week /
This Month periods in Malaysia time. Current queues cover complete actor-visible
order reads, independent of the recent table. Completion/reschedule analytics use
the existing private activity audit timestamps through one narrowly scoped read
RPC. Period comparisons use equal elapsed time. Technician views and actual
employee previews are limited to their current assignments. The Main Agent owns
integration, AI Insight, browser/live acceptance and state updates.

## Agent checks performed

- `pnpm.cmd test src/domain/operations-dashboard/aggregate.test.ts src/lib/services/workspace-orders/dashboard.test.ts src/app/workspaces/[workspaceId]/operations-overview.test.tsx`: **30 / 30 PASS**, rerun after restoring both source mutants.
- `pnpm.cmd typecheck`: **PASS**.
- Direct `node node_modules/eslint/bin/eslint.js` over the owning domain, service,
  overview, page and dashboard route: **PASS**. `pnpm.cmd exec eslint` failed local
  binary resolution; the direct installed ESLint invocation succeeded.
- `git diff --check`: **PASS**, only existing LF-to-CRLF informational warnings.
- Disposable **localhost PostgreSQL 17**: current pinned fresh schema and new
  dashboard migration installed; transaction-based synthetic SQL assertions
  **PASS**, final harness exit **0** and owned cluster stopped/removed. Coverage:
  Admin / Manager / Technician / actual employee preview, completion and schedule
  audit counts, MYT trend sum, previous period, workspace substitution, orphan and
  wrong generation audits, stale generation, invalid period, private audit grants,
  Guest proof and wrong token, revoked Guest visit, onboarding, anonymous subject,
  denied anonymous and service-role execution. No hosted database used by agent.
- Initial SQL fixture attempts failed on the real assignment-required check and
  enum union typing; fixtures were repaired without changing product constraints.

## Bounded source mutation checks

| Mutation | Targeted failing evidence | Result |
| --- | --- | --- |
| `TECHNICIAN_RETURN_SCOPE_REMOVED` | Wrongly scoped Technician returned-row case rejects another technician assignment | **KILLED**, Vitest exit 1 |
| `FINAL_GENERATION_GUARD_REMOVED` | Reset between dashboard reads must reject changed dataset generation | **KILLED**, Vitest exit 1 |

Both changes were applied to actual source one at a time, source restored in a
`finally` block, and the passing 30-case baseline rerun. These checks establish the
adapter's defensive checks; they do not claim SQL mutation or paid-provider proof.
[Machine-readable results](mutations.json).

## Data interpretation and limits

- Current status includes imported/seeded states without audit events; dated
  completion/reschedule analytics include only recorded audit events. `updated_at`
  is never used as a completion date.
- Service distribution and cohort completion rate refer to orders **created** in
  the selected period. Current queues include older orders. Financial amount and
  average job value are unavailable because charges are absent from this core.
- Complete current-order reads use stable ID order, exact-count verification,
  duplicate/scope checks and dataset-generation revalidation. A read exceeding
  50,000 visible orders fails explicitly instead of returning partial totals.
  Same-count field changes can interleave across pages; the ordinary small Demo
  fits one page. Audit aggregates are one SQL statement snapshot.
- Technician labels come from only technicians attached to actor-visible orders;
  counts do not establish skills or availability.
- This agent did not execute hosted SQL, call a provider, start a web service,
  conduct browser or human UAT, commit, push or deploy. Main acceptance remains
  separate from this implementation handoff.

Relevant official pagination reference:
[Supabase JavaScript range](https://supabase.com/docs/reference/javascript/range).
