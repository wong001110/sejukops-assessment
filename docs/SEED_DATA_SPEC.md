# SejukOps Deterministic Seed Data Specification

## 1. Purpose

The assessment demo, KPI Dashboard, workflow rules, AI Operations evaluation, integration tests, and Agent/Human UAT should use one intentionally designed deterministic dataset rather than unrelated ad-hoc mock records.

The seed dataset is a **test/demo contract**, not production data.

## 2. Time Strategy

Production/demo code should use the application timezone for date interpretation.

Use:

```text
Asia/Kuala_Lumpur
```

For automated tests and LLM evaluation, freeze the clock to a known fixture time so `today`, `this week`, `last week`, and `this month` have reproducible answers.

Recommended test anchor:

```text
2026-08-14T12:00:00+08:00
```

Seed generation should support an injectable `referenceNow` rather than scattering hard-coded current-date assumptions through fixtures.

For a live demo, the seed script may generate the same relative pattern around the chosen demo reference date so Today/This Week/This Month remain populated.

## 3. Branches

Create five branches to reflect the assessment business context without requiring Branch Management UI.

```text
BR-01  Branch 01
BR-02  Branch 02
BR-03  Branch 03
BR-04  Branch 04
BR-05  Branch 05
```

Display names may later be replaced with more realistic fictional names. Stable codes should remain available for deterministic tests.

BR-05 may intentionally contain no completed jobs in one fixture window to test valid zero-data branch behaviour later.

## 4. Profiles and Technicians

Seed the assessment's named mock technicians:

```text
Ali
John
Bala
Yusoff
```

Also seed:

```text
Admin Demo
Manager Demo
```

Suggested primary branch assignment:

```text
Ali    -> BR-01
John   -> BR-02
Bala   -> BR-03
Yusoff -> BR-04
```

BR-05 remains a useful zero/low-activity branch fixture without inventing an additional named technician that the assessment did not provide.

## 5. Customers

Seed a small reusable customer pool with deterministic IDs/names, including the assessment example customer:

```text
Ahmad
```

Add enough additional fictional customers to avoid every order belonging to the same person. Customer phone numbers must be obviously test/fake values and must never target real people.

## 6. Service Types

Use a controlled seed set such as:

```text
Aircond Cleaning
Repair
Gas Refill
Installation
Inspection
```

These values support the assessment examples while producing useful dashboard distributions.

## 7. Order Distribution Goals

Create approximately 35-50 deterministic orders spanning:

- previous month where useful for comparison
- current month
- last week
- this week
- today

The exact row count is less important than having known answers for every dashboard and AI evaluation category.

The dataset must include orders in each important lifecycle state:

```text
NEW
ASSIGNED
IN_PROGRESS
JOB_DONE
REVIEWED
CLOSED
```

## 8. Golden AI Fixture

Preserve the following last-week fixture because the LLM evaluation documentation already uses it as an example:

```text
Ali completed exactly 3 matching jobs last week:

ORD-2026-0012
ORD-2026-0017
ORD-2026-0020
```

The records must be seeded so the corresponding `getJobs` query returns exactly those order numbers for the frozen evaluation clock.

The implementation should add additional golden facts for:

- jobs completed today
- jobs completed this week
- total completed amount this week
- technician with most completed jobs this week
- active workload by technician
- no-result scenario
- one known order status lookup

These expected values should be derived once from the fixture definition and committed alongside the eval cases/tests.

## 9. Dashboard Fixture Requirements

The deterministic dataset must make these views non-trivial:

### Today

- at least several completed jobs across more than one technician
- multiple completion times so hourly buckets are visible

### This Week

- enough jobs across multiple days to create a useful daily trend
- a clear but not extreme leaderboard winner
- at least three service types
- at least one reschedule event

### This Month

- data across multiple weeks
- enough volume for weekly buckets and previous-period comparison

## 10. Reschedule Fixtures

Include at least:

1. one Admin direct reschedule to a different calendar day
2. one Manager direct reschedule
3. one Technician request approved by Admin/Manager
4. one same-day time change with `same_day = true`
5. one Technician request rejected, which must **not** create an `order_reschedules` event

This lets KPI logic prove that executed same-day changes are still counted while rejected requests are not.

## 11. Workflow Supervisor Fixtures

Seed explicit cases for deterministic flags:

### High amount variance

A completed job where:

```text
final_amount > configured quoted-price variance threshold
```

### Missing evidence

A `JOB_DONE` order with zero service attachments.

### Normal control case

A completed order with normal amount and evidence that must not receive either flag.

## 12. File Evidence Fixtures

For automated tests, use small local fixture files representing allowed categories:

```text
valid-photo.jpg
valid-document.pdf
valid-video.mp4 or a tiny synthetic equivalent
```

Also create invalid fixtures for:

- unsupported MIME/type
- over-limit metadata/size simulation
- seventh-file attempt

Large binary files should not be committed merely to test size rules; tests may simulate metadata/stream limits instead.

## 13. Document Understanding Fixtures

Provide at least:

1. a text-native service/invoice-style document with all expected fields
2. an image/scanned-style document for real multimodal testing when ENV is available
3. a document with one missing field
4. a document with an ambiguous amount/date that should surface `low` or `medium` confidence rather than silent certainty

All fixture documents must contain fictional data.

## 14. Failure Fixtures

The test harness should support deterministic failure injection for:

- Supabase/query failure
- evidence upload partial failure
- WhatsApp deep-link preparation failure
- AI provider timeout
- AI provider authentication error
- AI provider rate limit
- tool execution failure
- invalid model structured output

Failure fixtures make user-facing recovery behaviour testable without depending on external outages.

## 15. Seed Repeatability

The seed process should be idempotent/re-runnable for development.

Preferred approaches include:

- clear/reseed a dedicated assessment/demo dataset
- deterministic stable IDs where useful
- upsert by known fixture identifiers

Do not allow repeated seed execution to silently duplicate golden orders, reschedule events, or service reports.

## 16. Source of Truth

Golden expected values used by KPI tests and AI evaluation must be generated from / kept consistent with this fixture contract.

Avoid maintaining three contradictory copies of the same expected numbers in:

- seed script
- dashboard tests
- LLM eval dataset

Where practical, expose shared fixture constants or a generated golden manifest consumed by both deterministic tests and AI evaluation.
