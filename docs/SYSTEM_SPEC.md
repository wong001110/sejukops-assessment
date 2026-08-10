# SejukOps System Specification

## 1. Purpose

SejukOps is a responsive internal operations platform for a fictional air-conditioning service company with multiple branches and field technician teams.

The system is designed around one operational lifecycle:

**Order → Assignment → Service Execution → Completion → Notification → Review → Closure → Reporting / AI Insights**

The assessment implementation aims to cover every requested module while keeping them integrated around the same data model and workflow.

---

## 2. Product Principles

1. **One connected workflow** — modules operate on shared orders, service reports, users, and events.
2. **One Web application** — Admin, Technician, and Manager are role-specific routes in the same Next.js deployment.
3. **Mobile-first field UX** — technicians use a responsive Web App optimised for phones.
4. **Desktop-first operations UX** — Admin and Manager interfaces favour efficient forms, tables, reviews, and dashboards.
5. **Deterministic rules first** — explicit business rules stay in application logic; AI is used for interpretation, extraction, summarisation, and decision support.
6. **Controlled AI data access** — the model never receives unrestricted database access and never executes arbitrary SQL.
7. **No unnecessary RAG** — the assessment uses structured operational queries, not a vector knowledge base.
8. **Provider-agnostic AI** — AI features depend on capabilities, not hard-coded vendors.
9. **Human review for consequential AI output** — document extraction and workflow recommendations remain reviewable.
10. **Traceability** — important state changes and business actions are logged.
11. **Simple assessment auth, realistic boundaries** — use mock role switching while keeping authorization logic explicit.

---

## 3. Actors

### Admin

- Create orders
- Enter customer and service details
- Set quoted price
- Assign technician
- Add admin notes
- View order status
- Import supported documents for structured extraction
- Configure AI providers, keys, models, and routing

### Technician

- View assigned jobs
- Start an assigned job
- Record completed work
- Add extra charges
- Upload service evidence
- Review final amount
- Mark job as completed
- Optionally record payment information

### Manager

- Review completed jobs
- Inspect evidence and amount variance
- Resolve workflow flags
- Approve or request clarification
- Close reviewed jobs
- View KPI dashboard
- Use the AI Operations Assistant
- View operational AI insights

The conversational AI assistant is a **Manager feature**. Admin uses AI only where required for configuration and document processing. Technician does not receive a general AI chat assistant.

---

## 4. Role Model & Authorization

### 4.1 Fixed assessment roles

- `ADMIN`
- `TECHNICIAN`
- `MANAGER`

The demo uses a mock role switcher rather than full authentication.

Dynamic Create Role / Role Management UI is deliberately out of scope because the current business requirements define a small, stable role set. The implementation should still separate permissions from UI visibility so a production version can evolve toward configurable RBAC later.

### 4.2 Permission concepts

```text
order:create
order:view
order:assign
order:update
job:view_assigned
job:start_assigned
job:complete_assigned
evidence:upload
payment:record
review:view
review:approve
review:request_clarification
order:close
dashboard:view
ai:query
ai:view_insights
ai:configure
ai:document_extract
```

### 4.3 Data scope

Role checks alone are insufficient.

- Admin operates on permitted operational records.
- Technician may only start or complete jobs assigned to that technician.
- Manager may view and review broader operational records.
- AI provider configuration is Admin-only.

Route protection and server-side operation checks must enforce these boundaries; hiding a navigation item is not sufficient authorization.

---

## 5. Application & Portal Structure

SejukOps is **one repository, one Next.js application, one deployment, and one Supabase project**.

```text
/
├── admin/
│   ├── dashboard
│   ├── orders
│   ├── orders/new
│   ├── orders/[id]
│   ├── documents/import
│   └── settings/ai
│
├── technician/
│   ├── jobs
│   ├── jobs/[id]
│   └── history
│
└── manager/
    ├── dashboard
    ├── reviews
    ├── reviews/[id]
    ├── ai
    └── insights
```

```mermaid
flowchart TB
    APP[Single SejukOps Web App] --> ROLE{Current Role}
    ROLE --> A[/admin\nDesktop-first]
    ROLE --> T[/technician\nMobile-first]
    ROLE --> M[/manager\nDesktop-first]

    A --> SERVER[Shared Next.js Server Layer]
    T --> SERVER
    M --> SERVER
    SERVER --> DB[(Shared Supabase Data)]
```

All portals share types, validation, server services, design tokens, data model, and authorization primitives, while keeping role-specific layouts and navigation.

---

## 6. UX Strategy

### 6.1 Admin — desktop-first

- Sidebar navigation
- Header with current role/user
- Searchable orders table
- Status filters
- Structured order form
- Order summary after submission
- AI settings page
- Document import/review workflow

### 6.2 Technician — mobile-first responsive Web App

The Technician Portal is not a native mobile app and is not a separately deployed website.

Design goals:

- Large tap targets
- Minimal navigation depth
- Important customer/job context visible before action
- Avoid dense tables
- Linear completion form
- Camera/file upload accessible from phone
- Sticky primary action where useful
- Bottom navigation on narrow screens

Suggested navigation:

```text
Jobs | History | Profile
```

```mermaid
flowchart LR
    A[Open My Jobs] --> B[Select assigned job]
    B --> C[Review customer / problem]
    C --> D[Start Job]
    D --> E[Enter work done]
    E --> F[Add extra charges]
    F --> G[Upload evidence]
    G --> H[Review final amount]
    H --> I[Complete Job]
```

### 6.3 Manager — desktop-first

- KPI cards
- Weekly trend charts
- Technician leaderboard/performance table
- Completed jobs queue
- Workflow/AI flags
- Review detail page
- AI Operations Assistant
- Operational insight cards

---

## 7. Order Lifecycle

### States

```text
NEW
ASSIGNED
IN_PROGRESS
JOB_DONE
REVIEWED
CLOSED
```

```mermaid
stateDiagram-v2
    [*] --> NEW
    NEW --> ASSIGNED: Admin assigns technician
    ASSIGNED --> IN_PROGRESS: Assigned technician starts
    IN_PROGRESS --> JOB_DONE: Assigned technician completes
    JOB_DONE --> REVIEWED: Manager approves
    REVIEWED --> CLOSED: Review finalised
    JOB_DONE --> IN_PROGRESS: Manager requests clarification / rework
    CLOSED --> [*]
```

| Transition | Actor |
|---|---|
| NEW → ASSIGNED | Admin |
| ASSIGNED → IN_PROGRESS | Assigned Technician |
| IN_PROGRESS → JOB_DONE | Assigned Technician |
| JOB_DONE → REVIEWED | Manager |
| REVIEWED → CLOSED | Manager / system workflow |
| JOB_DONE → IN_PROGRESS | Manager requests clarification |

---

## 8. Module 1 — Admin Order Submission

### Fields

- Order No — auto-generated
- Customer Name
- Phone
- Address
- Problem Description
- Service Type
- Quoted Price
- Assigned Technician
- Admin Notes

### Behaviour

1. Admin opens New Order.
2. System generates/reserves a human-readable order number such as `ORD-2026-0001` while using UUID internally.
3. Admin enters order information and selects technician.
4. Server validates input.
5. Order is stored and becomes `ASSIGNED` when a technician is selected.
6. Audit log records creation and assignment.
7. UI shows a submission summary.

---

## 9. Module 2 — Technician Service Job

### Job list

Show order number, customer, service type, address summary, and status. Prioritise `ASSIGNED` and `IN_PROGRESS` work.

### Job detail

Read-only context before starting:

- Order ID
- Customer
- Phone
- Address
- Problem description
- Service type
- Quoted price
- Admin notes where appropriate

### Completion fields

- Work Done
- Extra Charges
- Up to 6 photos/video/PDF files
- Final Amount — auto-calculated
- Remarks
- Technician Name — derived from current mock user
- Timestamp — server generated

Optional payment fields:

- Payment Amount
- Payment Method
- Receipt Photo

### Final amount rule

```text
final_amount = quoted_price + extra_charges
```

The server calculates or verifies the value and must not trust a client-provided total.

### Completion transaction

```mermaid
flowchart TB
    A[Technician submits completion] --> B[Validate assigned technician]
    B --> C[Validate current state]
    C --> D[Save service report]
    D --> E[Persist evidence metadata]
    E --> F[Calculate / verify final amount]
    F --> G[Set status = JOB_DONE]
    G --> H[Write audit event]
    G --> I[Generate notification]
    G --> J[Run workflow checks]
    G --> K[Make job available for manager review]
```

---

## 10. Module 3 — WhatsApp Notification Trigger

### Trigger

When order status changes to `JOB_DONE`.

### Assessment implementation

- Generate a WhatsApp deep-link with a pre-filled message.
- Store notification generation/sent metadata where useful.
- Full WhatsApp Business infrastructure is not required.

Suggested message:

```text
Hi {customerName},

Job {orderNo} has been completed by Technician {technicianName} at {completedAt}.
Please check the service and leave feedback.

Thank you!
```

Notification failure must not roll back the completed job.

---

## 11. Manager Review

Manager Review closes the lifecycle defined by the assessment.

Review screen should show:

- Order/customer summary
- Quoted price
- Extra charges
- Final amount
- Work done
- Remarks
- Uploaded evidence
- Payment information if recorded
- Audit history
- Workflow/AI flags

Actions:

- Approve
- Request clarification/rework

```text
Approve: JOB_DONE → REVIEWED → CLOSED
Clarification: JOB_DONE → IN_PROGRESS
```

Every transition is captured in the audit trail.

---

## 12. KPI Dashboard

Minimum useful scope is weekly metrics.

Core metrics:

- Jobs Completed
- Total Amount
- Postponed/Rescheduled jobs
- Average Job Value
- Jobs by Technician
- Jobs by Service Type

Technician performance table:

- Technician
- Jobs Completed
- Total Amount
- Average Job Value
- Reschedule Count

Dashboard values come from deterministic database aggregations. The LLM may interpret metrics but is never the source of truth for numeric values.

---

## 13. AI Scope & Data Access

The assessment does **not** require a knowledge base, RAG pipeline, embeddings, or vector database. SejukOps therefore does not add them solely for technology breadth.

The three AI/data paths are deliberately separate:

```mermaid
flowchart TB
    REQ[AI Feature Request] --> TYPE{Task Type}

    TYPE -->|Operations Question| TOOL[Controlled Backend Tool]
    TOOL --> DB[(Supabase Structured Data)]
    DB --> LLM[Configured LLM]
    LLM --> ANSWER[Manager Answer]

    TYPE -->|Workflow Supervision| RULE[Deterministic Rule Engine]
    RULE --> EXPLAIN[Optional LLM Explanation]
    EXPLAIN --> FLAG[Manager Flag / Recommendation]

    TYPE -->|Document Understanding| DOC[Uploaded Document]
    DOC --> INPUT[Text extraction or multimodal input]
    INPUT --> MODEL[Configured Document Model]
    MODEL --> JSON[Validated Structured JSON]
    JSON --> REVIEW[Human Review]
```

No model receives unrestricted database access and no model executes arbitrary SQL.

---

## 14. AI Operations Query Window

### Goal

Allow Managers to ask operational questions in natural language while preserving controlled access to system data.

Supported examples:

- What jobs did Ali complete last week?
- Which technician completed the most jobs this week?
- How many jobs were completed today?
- What was the total completed amount this week?
- Which technician has the highest workload this week?

### Controlled architecture

```mermaid
flowchart LR
    U[Manager question] --> I[LLM intent / tool selection]
    I --> T{Approved tool}
    T -->|getJobs| Q1[Validated parameters]
    T -->|getTechnicianStats| Q2[Validated parameters]
    T -->|getOperationalSummary| Q3[Validated parameters]
    T -->|getWorkload| Q4[Validated parameters]
    Q1 --> DB[(Supabase)]
    Q2 --> DB
    Q3 --> DB
    Q4 --> DB
    DB --> S[Structured JSON]
    S --> F[LLM formats answer]
    F --> U
```

Example tool contracts:

```ts
getJobs({
  technicianId?: string,
  status?: OrderStatus,
  serviceType?: string,
  startDate?: string,
  endDate?: string
})

getTechnicianStats({
  technicianId?: string,
  startDate: string,
  endDate: string
})

getOperationalSummary({
  startDate: string,
  endDate: string
})

getWorkload({
  startDate: string,
  endDate: string
})
```

Guardrails:

- No arbitrary SQL
- No direct table browsing by the model
- Schema-validated tool input
- Server-normalised date ranges
- Bounded query result size
- Clear unsupported/no-results behaviour
- Final numeric values sourced from backend queries

---

## 15. Advanced AI — Workflow Supervisor

Use deterministic rules for clear operational conditions, and use an LLM only when explanation/recommendation adds value.

```mermaid
flowchart LR
    J[Completed Job] --> R[Rule Engine]
    R -->|No issue| N[No flag]
    R -->|Issue detected| F[Create workflow flag]
    F --> L[Optional LLM explanation]
    L --> M[Manager review queue]
```

Initial rules:

- Final amount significantly higher than quoted price
- `JOB_DONE` with no service evidence
- Unusual extra-charge ratio/threshold

The LLM may provide plain-language explanation, context summary, and suggested review action. It must not automatically approve, reject, refund, charge, or discipline staff.

---

## 16. Advanced AI — Document Understanding

### Goal

Extract structured operational data from uploaded documents:

- Customer name
- Service type
- Service details
- Amount
- Date

### Processing strategy

Document Understanding is a **workflow feature**, not a general chatbot.

- Text-native PDF/document: extract text, then send the relevant content to the configured extraction model.
- Image/scanned document: use a compatible vision/multimodal model.
- A separate OCR service is not required unless later implementation needs justify it.

```mermaid
flowchart LR
    D[Upload document] --> T{Readable text available?}
    T -->|Yes| E[Extract text]
    T -->|No / image| V[Vision-capable model input]
    E --> L[Configured extraction model]
    V --> L
    L --> J[Validated JSON]
    J --> H[Human review]
    H -->|Confirm| O[Create / update order]
    H -->|Edit| H
```

Example output schema:

```ts
type ExtractedServiceDocument = {
  customerName: string | null;
  serviceType: string | null;
  serviceDetails: string | null;
  amount: number | null;
  date: string | null;
};
```

Invalid or missing fields remain explicit rather than guessed. Extracted values are drafts and are never silently written into live operational records without confirmation.

---

## 17. Advanced AI — Operational Insight

Operational metrics are calculated deterministically and then optionally interpreted by the configured model.

```mermaid
flowchart LR
    DB[(Operational Data)] --> A[Deterministic Aggregations]
    A --> M[Metrics / Comparison]
    M --> L[LLM Interpretation]
    L --> I[Operational Insight]
    I --> H[Human Manager Decision]
```

Possible insights:

- Technician workload imbalance
- High reschedule rate
- Large amount-variance trend
- Service-type volume changes
- Completion volume significantly above/below team average

AI insight is decision support, not an automatic management decision.

---

## 18. AI Provider Configuration & BYOK

SejukOps uses a **provider-agnostic server-side adapter layer**. DeepSeek V4 Flash and MiMo 2.5 are the intended reference setup, but neither is a hard dependency.

### 18.1 Admin settings

Admin can configure one or more AI provider/model profiles:

```text
Provider display name
Provider / adapter type
Base URL (when applicable)
API Key
Model name
Capabilities
- Text
- Vision
- Tool calling
- Structured output
```

The system should also support a custom/OpenAI-compatible style provider entry where the adapter contract permits it.

### 18.2 Routing modes

Two user-selectable routing strategies are supported.

#### Single Model

One configured model handles every AI feature it is compatible with.

Use case: a user already has one capable model/API key and prefers simple configuration.

#### Task-based Routing

Different model profiles are assigned to different AI workloads.

Use case: lower cost, stronger capability matching, or provider preference.

```mermaid
flowchart TB
    SETTINGS[AI Settings] --> MODE{Routing Mode}

    MODE -->|Single Model| ONE[Default Model Profile]
    ONE --> Q[Operations Query]
    ONE --> W[Workflow Explanation]
    ONE --> I[Operational Insight]
    ONE --> D[Document Understanding if compatible]

    MODE -->|Task-based Routing| ROUTER[AI Task Router]
    ROUTER --> QP[Operations Model]
    ROUTER --> WP[Workflow / Insight Model]
    ROUTER --> DP[Document Model]
```

Reference configuration:

```text
Operations Query       → DeepSeek V4 Flash
Workflow Explanation   → DeepSeek V4 Flash
Operational Insight    → DeepSeek V4 Flash
Document Understanding → MiMo 2.5
```

A reviewer can replace these with another compatible combination.

### 18.3 Capability validation

Routing is capability-aware rather than vendor-aware.

Examples:

- Operations Query must support the structured/tool interaction required by the implementation.
- Image/scanned-document processing requires vision/multimodal capability.
- Structured extraction should use schema/structured output when available.

If Single Model is selected but that model cannot support an enabled feature, the UI should explain the incompatibility and offer another model or Task-based Routing.

### 18.4 API key security

Provider calls are always made server-side.

- Admin enters API keys in AI Settings.
- Saved keys are encrypted before persistent storage.
- The application keeps the encryption secret server-side.
- Plaintext keys are not returned to the browser after save.
- Logs must never contain provider keys.
- Environment variables can act as a deployment-level fallback.
- Technician and Manager cannot modify provider credentials.

For assessment scope, AI settings are organisation-level rather than per-user because authentication is mocked and the fictional system represents one company.

See [`AI_CONFIGURATION.md`](AI_CONFIGURATION.md) for the detailed configuration contract.

---

## 19. Audit Trail

Suggested events:

```text
ORDER_CREATED
TECHNICIAN_ASSIGNED
JOB_STARTED
SERVICE_REPORT_UPDATED
EVIDENCE_UPLOADED
PAYMENT_RECORDED
JOB_COMPLETED
NOTIFICATION_GENERATED
REVIEW_REQUESTED
REVIEW_APPROVED
JOB_CLOSED
WORKFLOW_FLAG_CREATED
WORKFLOW_FLAG_RESOLVED
AI_PROVIDER_CONFIG_UPDATED
AI_ROUTING_UPDATED
```

Audit record:

```text
id
order_id nullable
actor_profile_id nullable
event_type
metadata_json
created_at
```

Audit records are append-oriented and are not edited by normal application flows.

---

## 20. Suggested Data Model

### Core business tables

```text
profiles
technicians
customers
orders
service_reports
service_attachments
payments
job_reviews
notifications
ai_flags
audit_logs
```

Key shapes:

```text
orders
- id UUID PK
- order_no TEXT UNIQUE
- customer_id UUID FK
- assigned_technician_id UUID FK nullable
- problem_description TEXT
- service_type TEXT
- quoted_price NUMERIC
- status TEXT
- admin_notes TEXT nullable
- created_by UUID FK
- created_at TIMESTAMP
- updated_at TIMESTAMP

service_reports
- id UUID PK
- order_id UUID FK UNIQUE
- technician_id UUID FK
- work_done TEXT
- extra_charges NUMERIC DEFAULT 0
- final_amount NUMERIC
- remarks TEXT nullable
- started_at TIMESTAMP nullable
- completed_at TIMESTAMP nullable
- updated_at TIMESTAMP
```

### AI configuration tables

```text
ai_settings
- id UUID PK
- routing_mode TEXT               # SINGLE_MODEL | TASK_BASED
- default_provider_config_id UUID nullable
- updated_by UUID
- updated_at TIMESTAMP

ai_provider_configs
- id UUID PK
- name TEXT
- provider_type TEXT
- base_url TEXT nullable
- model TEXT
- capabilities JSONB
- encrypted_api_key TEXT nullable
- key_last4 TEXT nullable
- status TEXT
- created_at TIMESTAMP
- updated_at TIMESTAMP

ai_task_routes
- id UUID PK
- task_type TEXT
- provider_config_id UUID FK
- updated_at TIMESTAMP
```

Suggested task types:

```text
OPERATIONS_QUERY
WORKFLOW_EXPLANATION
OPERATIONAL_INSIGHT
DOCUMENT_UNDERSTANDING
```

### Relationship overview

```mermaid
erDiagram
    PROFILES ||--o| TECHNICIANS : profile
    PROFILES ||--o{ ORDERS : creates
    CUSTOMERS ||--o{ ORDERS : owns
    TECHNICIANS ||--o{ ORDERS : assigned
    ORDERS ||--o| SERVICE_REPORTS : report
    SERVICE_REPORTS ||--o{ SERVICE_ATTACHMENTS : attachments
    ORDERS ||--o{ PAYMENTS : payments
    ORDERS ||--o{ JOB_REVIEWS : reviews
    ORDERS ||--o{ NOTIFICATIONS : notifications
    ORDERS ||--o{ AI_FLAGS : flags
    ORDERS ||--o{ AUDIT_LOGS : events
    AI_SETTINGS }o--o| AI_PROVIDER_CONFIGS : default_model
    AI_PROVIDER_CONFIGS ||--o{ AI_TASK_ROUTES : routed_to
```

---

## 21. File Storage

Use Supabase Storage for service evidence, receipts, and uploaded source documents.

Suggested paths:

```text
service-evidence/{orderId}/{fileId}-{filename}
receipts/{orderId}/{fileId}-{filename}
documents/{uploadId}/{filename}
```

Store metadata in PostgreSQL rather than relying on storage listing as application state.

Validate file count, MIME type, size, and ownership/order access.

---

## 22. AI Provider Boundary

Provider-specific SDK/API details must not leak throughout UI or domain services.

```text
AIService
├── queryOperations(...)
├── explainWorkflowFlag(...)
├── extractDocument(...)
└── generateOperationalInsight(...)

AIProviderRegistry
├── resolveDefaultModel(...)
├── resolveTaskModel(taskType)
├── validateCapabilities(...)
└── createProviderClient(...)
```

Example code organisation:

```text
src/server/ai/
├── providers/
│   ├── registry.ts
│   ├── openai-compatible.ts
│   └── provider-types.ts
├── routing/
│   ├── resolve-model.ts
│   └── capabilities.ts
├── operations/
│   └── query.ts
├── workflow/
│   └── explain-flag.ts
├── documents/
│   └── extract-document.ts
└── insights/
    └── generate-insight.ts
```

---

## 23. Error & Edge Case Behaviour

### Orders

- Missing required fields → validation error
- Duplicate generated order number → retry/constraint handling

### Technician actions

- Wrong technician → action blocked
- Job already completed → completion disabled
- Partial upload failure → surface failed files without losing successful uploads

### Notifications

- WhatsApp generation failure → job stays completed; show retry/manual action

### AI Operations Query

- Unsupported request → explain supported query scope
- No matching data → explicit no-results answer
- Tool failure → operational error; never fabricate data

### Document extraction

- Low-quality/missing fields → null/uncertain fields shown for review
- Invalid amount/date → validation error before confirmation
- Image input routed to non-vision model → block and show capability mismatch

### AI provider configuration

- Invalid key/base URL/model → Test Connection failure without exposing credential
- Provider unavailable → task shows provider error rather than silently changing business data
- Missing compatible route → feature disabled with configuration guidance

---

## 24. Technical Stack

### Frontend

- Next.js
- React
- TypeScript
- Tailwind CSS

### Backend / Data

- Next.js Server Actions and/or Route Handlers
- Supabase PostgreSQL
- Supabase Storage

### AI

- Provider-agnostic server-side adapters
- BYOK provider configuration
- Single Model and Task-based Routing
- Structured outputs/schema validation where supported
- Controlled application tools for operational queries
- Reference models: DeepSeek V4 Flash + MiMo 2.5

### Deployment

- Vercel
- Supabase hosted project

### Assessment authentication

- Mock login / role switcher

A separate NestJS backend, native mobile app, RAG/vector system, or full custom role management layer is not required for this assessment.

---

## 25. Implementation Plan

### Phase 1 — Foundation

- Initialise Next.js / TypeScript / Tailwind
- Configure Supabase
- Create schema and migrations
- Seed mock users and technicians
- Implement role switcher
- Add `/admin`, `/technician`, `/manager` route boundaries
- Add shared layouts/design primitives

### Phase 2 — Admin Workflow

- Orders list
- Create order form
- Auto order number
- Technician assignment
- Order detail
- Audit events

### Phase 3 — Technician Workflow

- Mobile-first jobs list
- Job detail
- Start job
- Completion form
- File upload
- Final amount calculation
- Optional payment capture

### Phase 4 — Completion & Review

- `JOB_DONE` transition
- WhatsApp deep-link
- Workflow rules
- Manager completed-job queue
- Review / clarification / closure

### Phase 5 — KPI Dashboard

- Weekly aggregates
- KPI cards
- Technician performance table
- Simple charts

### Phase 6 — AI Configuration

- Provider registry/adapter contracts
- Admin AI Settings UI
- Encrypted BYOK storage
- Single Model mode
- Task-based Routing mode
- Capability validation
- Test Connection flow

### Phase 7 — Core AI

- Supported operations intents
- Controlled query tools
- Structured tool execution
- Manager AI Operations UI
- Error/empty/unsupported states
- Operational insights

### Phase 8 — Advanced AI

- Workflow Supervisor explanations
- Document upload/extraction
- Vision/text input routing
- Human review of extracted fields

### Phase 9 — Quality & Submission

- Responsive QA
- Business validation and error states
- Realistic seed data
- README screenshots/demo notes
- Self-assessment section
- Deployment

---

## 26. Testing Priorities

### Business rules

- Only Admin assigns technicians
- Only assigned Technician starts/completes job
- Final amount computes correctly
- Invalid state transitions are rejected
- Manager review transitions are valid

### Integration

- New order appears in assigned Technician Portal
- Service completion updates Manager review queue
- Completed job updates dashboard metrics
- Completed job triggers notification generation
- AI query values match deterministic queries

### Responsive

- Technician flows on narrow phone-sized viewports
- Admin/Manager flows on desktop widths

### AI

- Tool selection for supported operations questions
- Unsupported/no-data behaviour
- No arbitrary database query path
- Provider capability checks
- Single Model routing
- Task-based routing
- Encrypted key handling
- Document extraction schema validation
- Image input blocked when selected model lacks vision

---

## 27. Assessment Demo Flow

```mermaid
flowchart TD
    A[Open SejukOps] --> B[Switch to Admin]
    B --> C[Configure AI provider(s)]
    C --> D[Choose Single Model or Task-based Routing]
    D --> E[Create Ahmad service order]
    E --> F[Assign order to Ali]
    F --> G[Switch to Technician: Ali]
    G --> H[Open assigned job]
    H --> I[Start job]
    I --> J[Enter work + extra charges]
    J --> K[Upload evidence]
    K --> L[Complete job]
    L --> M[See WhatsApp action / notification]
    M --> N[Switch to Manager]
    N --> O[Review workflow flags]
    O --> P[Review and close job]
    P --> Q[Open KPI dashboard]
    Q --> R[Ask AI about Ali / completed jobs]
    R --> S[Switch to Admin]
    S --> T[Upload sample document]
    T --> U[Review extracted structured fields]
```

The end-to-end path should be prioritised over disconnected features.

---

## 28. Explicit Non-Goals

Unless later product requirements justify them:

- Full production authentication
- User-created custom roles
- Complex tenant/organisation management
- Native iOS/Android Technician apps
- Separate deployments for each portal
- Full WhatsApp Business infrastructure
- RAG/vector knowledge base
- Autonomous AI decisions that change operational records without review
- Separate NestJS backend solely for architectural appearance

These are valid future extensions but are not required to demonstrate the assessment's engineering goals.
