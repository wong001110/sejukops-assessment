import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { canApplyConversationResult, canStartConversationRequest, newConversationTurn, retryConversationTurn } from "@/components/manager/ai-operations/conversation-state";

const workspace = readFileSync(resolve("src/components/manager/ai-operations/ai-operations-workspace.tsx"), "utf8");
const state = readFileSync(resolve("src/components/manager/ai-operations/conversation-state.ts"), "utf8");
const api = readFileSync(resolve("src/components/manager/ai-operations/api.ts"), "utf8");
const insight = readFileSync(resolve("src/components/manager/ai-operations/operational-insight.tsx"), "utf8");
const dashboard = readFileSync(resolve("src/components/manager/dashboard-workspace.tsx"), "utf8");
const shell = readFileSync(resolve("src/components/desktop-shell.tsx"), "utf8");

describe("Manager AI Operations UI", () => {
  it("uses the shared contracts and approved Manager API routes", () => {
    expect(api).toContain('from "@/domain/ai-operations/contracts"');
    expect(api).toContain('"/api/manager/ai-operations"');
    expect(api).toContain('"/api/manager/operational-insight"');
    expect(api).toContain("aiOperationsResponseSchema.parse(body)");
    expect(api).toContain("operationalInsightResponseSchema.parse(body)");
  });

  it("keeps a session-only, clearable conversation context and provides supported-scope guidance", () => {
    expect(workspace).toContain('"sejukops:manager-ai-operations-conversation"');
    expect(workspace).toContain("window.sessionStorage.setItem");
    expect(workspace).toContain("window.sessionStorage.removeItem");
    expect(workspace).toContain("setContext(null)");
    expect(workspace).toContain("Supported operations questions");
    expect(workspace).toContain('turns.length === 0 ? <SupportedQuestionWelcome');
    expect(workspace).not.toContain('<Alert className="ai-supported-scope"');
    expect(workspace).toContain("Outside the supported operations scope");
  });

  it("renders loading, grounded, no-data, error, and manual retry states without fabricating success", () => {
    expect(state).toContain('status: "loading"');
    expect(workspace).toContain("<Skeleton active");
    expect(workspace).toContain("Grounded operational answer");
    expect(workspace).toContain("No matching operational data");
    expect(workspace).toContain("AI answer unavailable");
    expect(workspace).toContain(">Retry</Button>");
    expect(workspace).toContain("Grounding from approved operational data");
    expect(workspace).toContain("Clarify this operations request");
    expect(api).toContain("aiRecoveryCopy");
  });

  it("adds a discoverable Manager route and keeps operational insight separate from deterministic KPIs", () => {
    expect(shell).toContain('key: "/manager/ai-operations"');
    expect(shell).toContain('label: "AI Operations"');
    expect(dashboard).toContain("<OperationalInsight dashboard={dashboard} />");
    expect(insight).toContain('["manager-operational-insight", period, metricsVersion]');
    expect(insight).toContain('className="dashboard-ai-teaser"');
    expect(insight).not.toContain("FloatButton");
    expect(insight).toContain('title={<Space size={8}><BulbOutlined /> AI decision support');
    expect(insight).toContain("enabled: open");
    expect(insight).toContain("formatFactLabel(fact.label)");
    expect(insight).toContain("AI insight unavailable");
    expect(insight).toContain("The deterministic KPI dashboard remains available");
  });

  it("does not let a reset request repopulate a new conversation, and retries the same turn with its original context", () => {
    const originalContext = { intent: "OPERATIONAL_SUMMARY" as const, period: "this_week" as const, technicianName: "Ali" };
    const turn = newConversationTurn("turn-1", "How many jobs?", originalContext);
    const retried = retryConversationTurn({ ...turn, status: "error", error: { code: "AI_PROVIDER_UNAVAILABLE", message: "Retry", retryable: true, action: "RETRY" } });
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
