import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import {
  canApplyConversationResult,
  canStartConversationRequest,
  newConversationTurn,
  retryConversationTurn,
} from "@/components/manager/ai-operations/conversation-state";

const workspace = readFileSync(
  resolve("src/components/manager/ai-operations/ai-operations-workspace.tsx"),
  "utf8",
);
const presentation = readFileSync(
  resolve("src/components/manager/ai-operations/operations-result-presentation.tsx"),
  "utf8",
);
const presentationStyles = readFileSync(
  resolve("src/styles/ui-ai-operations.css"),
  "utf8",
);
const insightStyles = readFileSync(
  resolve("src/styles/ui-operational-insight.css"),
  "utf8",
);
const state = readFileSync(
  resolve("src/components/manager/ai-operations/conversation-state.ts"),
  "utf8",
);
const api = readFileSync(
  resolve("src/components/manager/ai-operations/api.ts"),
  "utf8",
);
const insight = readFileSync(
  resolve("src/components/manager/ai-operations/operational-insight.tsx"),
  "utf8",
);
const dashboard = readFileSync(
  resolve("src/components/manager/dashboard-workspace.tsx"),
  "utf8",
);
const shell = readFileSync(resolve("src/components/desktop-shell.tsx"), "utf8");

describe("Manager AI Operations UI", () => {
  it("uses the shared contracts and approved Manager API routes", () => {
    expect(api).toContain('from "@/domain/ai-operations/contracts"');
    expect(api).toContain('"/api/manager/ai-operations"');
    expect(api).toContain('"/api/manager/operational-insight"');
    expect(api).toContain("aiOperationsResponseSchema.parse(body)");
    expect(api).toContain("operationalInsightResponseSchema.parse(body)");
  });

  it("keeps a versioned session-only, clearable conversation context and supported-scope guidance", () => {
    expect(workspace).toContain(
      '"sejukops:manager-ai-operations-conversation:v2"',
    );
    expect(workspace).toContain("window.sessionStorage.setItem");
    expect(workspace).toContain("window.sessionStorage.removeItem");
    expect(workspace).toContain("setContext(null)");
    expect(workspace).toContain("Supported operations questions");
    expect(workspace).toContain("turns.length === 0");
    expect(workspace).toContain("Outside the supported operations scope");
    expect(workspace).toContain("August 2026");
    expect(workspace).toContain("operationalPeriodLabel(args.period)");
    expect(presentation).toContain("operationalPeriodLabel(period)");
  });

  it("uses real chat alignment and deterministic data renderers instead of a fact dump", () => {
    expect(workspace).toContain('className="ai-message-row ai-message-row-manager"');
    expect(workspace).toContain('className="ai-message-row ai-message-row-assistant"');
    expect(workspace).toContain("<OperationsResultPresentation");
    expect(workspace).toContain("Verified from current operational data");
    expect(workspace).not.toContain("facts.map((fact)");
    expect(presentation).toContain('presentation.kind === "JOBS"');
    expect(presentation).toContain('presentation.kind === "TECHNICIAN_PERFORMANCE"');
    expect(presentation).toContain('presentation.kind === "OPERATIONAL_SUMMARY"');
    expect(presentation).toContain("<WorkloadResult");
    expect(presentation).toContain('title: "Order"');
    expect(presentation).toContain('title: "Completed amount"');
    expect(presentationStyles).toContain(".ai-message-row-manager");
    expect(presentationStyles).toContain("justify-content: flex-end");
    expect(presentationStyles).toContain(".ai-structured-result");
  });

  it("renders loading, grounded, no-data, error, and manual retry states without fabricating success", () => {
    expect(state).toContain('status: "loading"');
    expect(workspace).toContain("<Skeleton active");
    expect(workspace).toContain("Grounded answer");
    expect(workspace).toContain("No matching operational data");
    expect(workspace).toContain("AI answer unavailable");
    expect(workspace).toContain("Retry");
    expect(workspace).toContain("Clarify this operations request");
    expect(api).toContain("aiRecoveryCopy");
  });

  it("keeps operational insight separate from deterministic KPIs and presents it as decision support", () => {
    expect(shell).toContain('key: "/manager/ai-operations"');
    expect(shell).toContain('label: "AI Operations"');
    expect(dashboard).toContain("<OperationalInsight dashboard={dashboard} />");
    expect(insight).toContain('["manager-operational-insight", period, metricsVersion]');
    expect(insight).toContain('className="dashboard-ai-teaser"');
    expect(insight).not.toContain("FloatButton");
    expect(insight).toContain("width={1040}");
    expect(insight).toContain("Executive summary");
    expect(insight).toContain("What changed");
    expect(insight).toContain("Suggested follow-up");
    expect(insight).toContain("<InsightMetrics dashboard={dashboard} />");
    expect(insight).toContain("enabled: open");
    expect(insight).toContain("AI insight unavailable");
    expect(insight).toContain("The deterministic KPI dashboard remains available");
  });

  it("shows only cited grounding facts instead of dumping every dashboard field", () => {
    expect(insight).toContain("const citedKeys = new Set(citations)");
    expect(insight).toContain("facts.filter((fact) => citedKeys.has(fact.key))");
    expect(insight).toContain("Grounded evidence");
    expect(insight).toContain("cited dashboard facts");
    expect(insightStyles).toContain("grid-template-columns: repeat(4");
    expect(insightStyles).toContain("grid-template-columns: repeat(2");
    expect(insightStyles).toContain("max-height: min(720px");
  });

  it("does not let a reset request repopulate a new conversation, and retries the same turn with its original context", () => {
    const originalContext = {
      intent: "OPERATIONAL_SUMMARY" as const,
      period: "this_week" as const,
      technicianName: "Ali",
    };
    const turn = newConversationTurn("turn-1", "How many jobs?", originalContext);
    const retried = retryConversationTurn({
      ...turn,
      status: "error",
      error: {
        code: "AI_PROVIDER_UNAVAILABLE",
        message: "Retry",
        retryable: true,
        action: "RETRY",
      },
    });
    expect(retried.id).toBe("turn-1");
    expect(retried.requestContext).toEqual(originalContext);
    expect(retried.status).toBe("loading");
    expect(retried.error).toBeUndefined();
    expect(canApplyConversationResult(3, 4, true)).toBe(false);
    expect(canApplyConversationResult(4, 4, false)).toBe(false);
    expect(canApplyConversationResult(4, 4, true)).toBe(true);
    expect(canStartConversationRequest("turn-1", "turn-2")).toBe(false);
    expect(canStartConversationRequest("turn-1", "turn-1")).toBe(true);
    expect(canStartConversationRequest(null, "turn-2")).toBe(true);
  });
});
