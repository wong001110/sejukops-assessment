import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const service = readFileSync(
  resolve("src/lib/services/workflow-supervisor/service.ts"),
  "utf8",
);
const route = readFileSync(
  resolve("src/app/api/manager/workflow-flags/[flagId]/explanation/route.ts"),
  "utf8",
);
const managerReview = readFileSync(
  resolve("src/lib/services/manager-review/service.ts"),
  "utf8",
);

describe("Workflow Supervisor server boundaries", () => {
  it("requires a Manager application permission plus database actor RPC", () => {
    expect(service).toContain('createAuthorizedDataContext("review:view")');
    expect(service).toContain('context.identity.role !== "MANAGER"');
    expect(service).toContain('"manager_begin_workflow_flag_explanation"');
  });

  it("requires an idempotency key and exposes POST only", () => {
    expect(route).toContain("workflowExplanationRequestSchema");
    expect(route).toContain("export async function POST");
    expect(route).not.toContain("export async function GET");
    expect(service).toContain("p_request_key: request.requestKey");
  });

  it("keeps current-revision Manager queue counts and rich deterministic detail", () => {
    expect(managerReview).toContain("completion_revision");
    expect(managerReview).toContain("deterministic_summary");
    expect(managerReview).toContain(
      "Number(row.completion_revision) === Number(report.completion_revision)",
    );
  });

  it("uses one selected task route and never changes operational decisions", () => {
    expect(service).toContain('("WORKFLOW_EXPLANATION")');
    expect(service).toContain("dependencies.complete ?? requestAIProviderCompletion");
    expect(service).not.toContain("update public.orders");
    expect(service).not.toContain("APPROVE");
    expect(service).not.toContain("REFUND");
  });
});
