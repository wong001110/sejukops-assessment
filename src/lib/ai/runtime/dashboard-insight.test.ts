import { describe, expect, it, vi } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActorContext } from "@/lib/auth/actor-policy";
import { aggregateDashboard } from "@/domain/operations-dashboard/aggregate";
import { dashboardHighlightCatalog, selectDashboardHighlights } from "@/domain/operations-dashboard/insight";
import { DashboardInsightAccessError, DashboardInsightStaleError, runDashboardInsight } from "./dashboard-insight";

const workspaceId = "10000000-0000-4000-8000-000000000001";
const actor: ActorContext = { authUserId: "user", profileId: "profile", platformRole: "USER", isAnonymous: false, membership: { workspaceId, kind: "OWNER", role: "TECHNICIAN" } };
const client = {} as SupabaseClient;
const input = { workspaceId, period: "this_week" as const };
const data = aggregateDashboard([], { ...input, role: "TECHNICIAN", generation: 1, now: new Date("2026-10-05T12:00:00Z"),
  activity: { asOf: "2026-10-05T12:00:00Z", generation: 1, completed: 3, rescheduled: 1, previousCompleted: 2, previousRescheduled: 0, trend: [], technicians: [] } });
function setup(text = '{"ids":["completed","schedule"]}') {
  const model = new MockLanguageModelV3({ doGenerate: async () => ({ content: [{ type: "text", text }], finishReason: { unified: "stop", raw: undefined },
    usage: { inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 4, text: 4, reasoning: undefined } }, warnings: [] }) });
  return { model, deps: { readDashboard: vi.fn(async () => data), createModel: () => model, resolveProvider: vi.fn(async () => ({ providerType: "OPENAI_COMPATIBLE" as const, baseUrl: "https://fixture.invalid", apiKey: "fixture-key", model: "fixture", capabilities: { text: true, toolCalling: false, structuredOutput: false, vision: false } })) } };
}
describe("source-backed Dashboard AI Insight", () => {
  it("selects fixed facts in one tool-free call using complete actor-scoped aggregates", async () => {
    const { model, deps } = setup(); const reserve = vi.fn();
    const result = await runDashboardInsight(actor, client, input, { beforeProviderCall: reserve }, deps);
    expect(result.highlights[0].observation).toContain("3 completion events");
    expect(deps.readDashboard).toHaveBeenCalledTimes(2);
    expect(deps.readDashboard).toHaveBeenCalledWith(actor, client, input, null);
    expect(reserve).toHaveBeenCalledOnce(); expect(model.doGenerateCalls).toHaveLength(1);
    expect(model.doGenerateCalls[0].tools).toBeUndefined();
  });
  it.each(["foreign", "preview", "revoked", "missing"])("denies %s before data/provider access", async kind => {
    const denied: ActorContext = kind === "foreign" ? { ...actor, membership: { ...actor.membership!, workspaceId: "other" } }
      : kind === "preview" ? { ...actor, preview: { readOnly: true, effectiveEmployeeProfileId: "employee" } }
      : kind === "revoked" ? { ...actor, businessReady: false } : { ...actor, membership: undefined };
    const { deps } = setup();
    await expect(runDashboardInsight(denied, client, input, {}, deps)).rejects.toBeInstanceOf(DashboardInsightAccessError);
    expect(deps.readDashboard).not.toHaveBeenCalled(); expect(deps.resolveProvider).not.toHaveBeenCalled();
  });
  it.each(['{"ids":["fabricated"]}', '{"ids":["completed","completed"]}', '{"ids":["completed"],"observation":"refund approved"}', 'not JSON'])("rejects unsupported or invented model output %s", async text => {
    const { deps } = setup(text); await expect(runDashboardInsight(actor, client, input, {}, deps)).rejects.toThrow();
  });
  it("rejects changed generation or aggregates before displaying earlier highlights", async () => {
    for (const changed of [{ ...data, generation: 2 }, { ...data, current: { ...data.current, overdue: 1 } }]) {
      const { deps } = setup(); deps.readDashboard.mockResolvedValueOnce(data).mockResolvedValueOnce(changed);
      await expect(runDashboardInsight(actor, client, input, {}, deps)).rejects.toBeInstanceOf(DashboardInsightStaleError);
    }
  });
  it("stops model invocation when allowance or cancellation rejects it", async () => {
    const { model, deps } = setup();
    await expect(runDashboardInsight(actor, client, input, { beforeProviderCall: async () => { throw new Error("exhausted"); } }, deps)).rejects.toThrow("exhausted");
    expect(model.doGenerateCalls).toHaveLength(0);
    const abort = new AbortController(); abort.abort(); deps.readDashboard.mockClear();
    await expect(runDashboardInsight(actor, client, input, { abortSignal: abort.signal }, deps)).rejects.toThrow();
    expect(deps.readDashboard).not.toHaveBeenCalled();
  });
  it("catalog contains no monetary claims or model-authored facts", () => {
    const catalog = dashboardHighlightCatalog(data);
    expect(catalog.length).toBe(6); expect(JSON.stringify(catalog)).not.toMatch(/RM|revenue|payment/);
    expect(selectDashboardHighlights('{"ids":["today"]}', catalog)[0]).toBe(catalog[5]);
  });
  it("cancels a response when deadline expires during the final read", async () => {
    const { deps } = setup(); const controller = new AbortController();
    deps.readDashboard.mockResolvedValueOnce(data).mockImplementationOnce(async () => { controller.abort(new Error("deadline")); return data; });
    await expect(runDashboardInsight(actor, client, input, { abortSignal: controller.signal }, deps)).rejects.toThrow("deadline");
  });
});
