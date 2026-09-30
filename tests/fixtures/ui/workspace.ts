import type { AISettingsSnapshot } from "../../../src/domain/ai-config/contracts";

// All identifiers and records in this module are fictional and local to tests.
export const ids = {
  workspace: "10000000-0000-4000-8000-000000000001",
  branch: "20000000-0000-4000-8000-000000000001",
  customer: "30000000-0000-4000-8000-000000000001",
  technician: "40000000-0000-4000-8000-000000000001",
  order: "50000000-0000-4000-8000-000000000001",
  document: "60000000-0000-4000-8000-000000000001",
  version: "70000000-0000-4000-8000-000000000001",
  provider: "80000000-0000-4000-8000-000000000001",
} as const;
export const timestamp = "2026-09-30T04:00:00.000Z";
export const optionsFixture = {
  generation: 1,
  branches: [{ id: ids.branch, code: "MOCK", name: "Fictional Workshop" }],
  customers: [{ id: ids.customer, name: "Fictional Customer", address: "1 Example Street, Mock Town" }],
};
export const ordersFixture = [
  { id: ids.order, order_no: "MOCK-001", branch_id: ids.branch, customer_id: ids.customer,
    status: "NEW", problem_description: "Fictional unit has weak airflow. Inspect the filter before replacing parts.",
    service_type: "Air conditioning inspection", scheduled_at: null as string | null,
    assigned_technician_id: null as string | null, updated_at: timestamp },
  { id: "50000000-0000-4000-8000-000000000002", order_no: "MOCK-002", branch_id: ids.branch, customer_id: ids.customer,
    status: "ASSIGNED", problem_description: "Fictional preventive maintenance visit. Customer access details remain unknown.",
    service_type: "Maintenance", scheduled_at: "2026-10-01T02:00:00.000Z" as string | null,
    assigned_technician_id: ids.technician as string | null, updated_at: timestamp },
];
export type MockOrder = (typeof ordersFixture)[number];
export const techniciansFixture = [{ id: ids.technician, branch_id: ids.branch,
  profile_id: "90000000-0000-4000-8000-000000000001" }];
export const reviewFixture = {
  documentId: ids.document as string, versionId: ids.version as string,
  title: "Fictional filter inspection guide", sourceLabel: "Mock training material",
  sourceText: "Disconnect power before inspecting the filter. Clean a reusable filter with water and let it dry fully. Confirm airflow after reinstalling. 缺少型号时，请先确认型号。",
  sourceKind: "TEXT" as "TEXT" | "PDF_TEXT",
  indexState: "READY" as "PENDING" | "PROCESSING" | "READY" | "FAILED",
  indexError: null as string | null,
};
export type MockReview = typeof reviewFixture;
export function knowledgeHit(review = reviewFixture) {
  return { content: review.sourceText, citation: { documentId: review.documentId,
    versionId: review.versionId, title: review.title, sourceLabel: review.sourceLabel,
    section: "Filter inspection", page: 1, ordinal: 0 } };
}
const extracted = (value: unknown, issues: string[] = []) => ({ value, confidence: 0.91, issues });
export const intakeFixture = {
  generation: 1, sourceSha256: "a".repeat(64),
  draft: { customerName: extracted("Fictional Customer"), serviceType: extracted("Air conditioning inspection"),
    serviceDetails: extracted("Fictional unit has weak airflow; inspect the filter."),
    amount: extracted(null, ["Amount was not found; confirm with the customer if needed."]),
    date: extracted(null, ["The requested visit date is unknown."]) },
};
export const settingsFixture: AISettingsSnapshot = {
  canManage: true,
  settings: { routingMode: "SINGLE_MODEL", defaultProviderConfigId: ids.provider, updatedAt: timestamp },
  providers: [{ id: ids.provider, name: "Mock operations provider", providerType: "OPENAI_COMPATIBLE",
    baseUrl: "https://api.mock-provider.example/v1", model: "fictional-model",
    capabilities: { text: true, vision: false, toolCalling: true, structuredOutput: true },
    status: "ACTIVE", credential: { configured: true, last4: "MOCK" }, createdAt: timestamp, updatedAt: timestamp }],
  routes: { OPERATIONS_QUERY: null, WORKFLOW_EXPLANATION: null, OPERATIONAL_INSIGHT: null, DOCUMENT_UNDERSTANDING: null },
};
