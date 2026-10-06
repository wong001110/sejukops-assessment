import type { SupabaseClient } from "@supabase/supabase-js";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { canUseOperationsAi, hasActorPermission, type ActorContext } from "@/lib/auth/actor-policy";
import type { AIProviderConnectionConfig } from "@/lib/ai/providers/types";
import type { RecentOrder } from "@/lib/capabilities/recent-orders";
import type { KnowledgeHit } from "@/lib/services/workspace-knowledge/service";
import { OperationsAskError, operationsKnowledgeCandidates, runOperationsAsk } from "./operations-ask";
import { ProviderAllowanceError } from "./workspace-orders-agent";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const actor: ActorContext = { authUserId: otherId, profileId: otherId, isAnonymous: false, platformRole: "USER", membership: { workspaceId, kind: "OWNER", role: "MANAGER" } };
const provider: AIProviderConnectionConfig = { providerType: "OPENAI_COMPATIBLE", model: "test", apiKey: "test-key", baseUrl: "https://provider.example/v1", capabilities: { text: true, vision: false, toolCalling: true, structuredOutput: true } };
const order: RecentOrder = { id: "33333333-3333-4333-8333-333333333333", workspace_id: workspaceId, order_no: "SO-1", branch_id: otherId, customer_id: otherId, assigned_technician_id: otherId, status: "ASSIGNED", problem_description: "QX-731 filter noise", service_type: "REPAIR", scheduled_at: null, created_at: "2026-10-05T00:00:00Z", updated_at: "2026-10-05T00:00:00Z" };
const hit: KnowledgeHit = { content: "QX-731: disconnect power before cleaning.", trust: "UNTRUSTED_SOURCE", retrieval: "KEYWORD_ONLY", citation: { workspaceId, documentId: otherId, versionId: otherId, title: "Manual", sourceLabel: "Fictional manual", section: "Safety", page: 1, ordinal: 0 } };
const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 5, text: 5, reasoning: undefined } };
const client = {} as SupabaseClient;
function setup(answer: unknown = { orderIds: [order.id], selections: [{ index: 0, excerpt: "disconnect power" }] }, toolInput: unknown = { includeOrders: true, includeKnowledge: true, queryIndex: 0 }) {
  const model = new MockLanguageModelV3({ doGenerate: [
    { content: [{ type: "tool-call" as const, toolCallId: "read1", toolName: "readOperationsEvidence", input: JSON.stringify(toolInput) }], finishReason: { unified: "tool-calls", raw: undefined }, usage, warnings: [] },
    { content: [{ type: "text" as const, text: typeof answer === "string" ? answer : JSON.stringify(answer) }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] },
  ] });
  const deps = { resolveProvider: vi.fn(async () => provider), createModel: () => model,
    readOrders: vi.fn<typeof import("@/lib/capabilities/recent-orders").readRecentWorkspaceOrders>(async () => ({ workspaceId, orders: [order] })),
    readOrder: vi.fn(async () => ({ workspaceId, order })), searchKnowledge: vi.fn<typeof import("@/lib/services/workspace-knowledge/service").searchWorkspaceKnowledge>(async () => [hit]) };
  const options = { revalidateScope: vi.fn(async () => 1), beforeProviderCall: vi.fn(async () => {}) };
  return { model, deps, options, run: (candidate: ActorContext = actor) => runOperationsAsk(candidate, client, { workspaceId, question: "What does QX-731 require?" }, options, deps) };
}

describe("unified Operations read-only evidence", () => {
  it.each([
    ["```json\n{\"orderIds\":[],\"selections\":[]}\n```", "INVALID_JSON"],
    [{ orderIds: [otherId], selections: [] }, "INVALID_SELECTION"],
    [{ orderIds: [], selections: [{ index: 0, excerpt: "Disconnect the power before cleaning" }] }, "INVALID_EXCERPT"],
  ] as const)("classifies rejected final selections using only a fixed safe reason %s", async (answer, reason) => {
    const s = setup(answer);
    await expect(s.run()).rejects.toMatchObject({ code: "UNAVAILABLE", reason });
  });
  it("rejects a changed generation returned by the fresh scope contract before any source read", async () => {
    const s = setup(); s.options.revalidateScope.mockResolvedValueOnce(1).mockResolvedValue(2);
    await expect(s.run()).rejects.toMatchObject({ code: "STALE" });
    expect(s.deps.resolveProvider).not.toHaveBeenCalled(); expect(s.deps.readOrders).not.toHaveBeenCalled();
  });
  it("rejects a generation reset at the completed fallback boundary before the next read", async () => {
    const s = setup(); s.deps.searchKnowledge.mockResolvedValue([]);
    s.options.revalidateScope.mockImplementation(async () => s.deps.searchKnowledge.mock.calls.length === 0 ? 1 : 2);
    await expect(runOperationsAsk(actor, client, { workspaceId, question: "Show my jobs and filter knowledge" }, s.options, s.deps)).rejects.toMatchObject({ code: "STALE" });
    expect(s.deps.searchKnowledge).toHaveBeenCalledTimes(1); expect(s.model.doGenerateCalls).toHaveLength(1);
  });
  it.each([0, NaN, undefined])("rejects an invalid initial fresh-generation contract result %s", async (generation) => {
    const s = setup(); s.options.revalidateScope.mockResolvedValue(generation as number);
    await expect(s.run()).rejects.toMatchObject({ code: "UNAVAILABLE" }); expect(s.deps.resolveProvider).not.toHaveBeenCalled();
  });
  it("retries a mixed full-question zero hit using only literal spans and rechecks the successful filter query", async () => {
    const question = "Show my jobs and filter knowledge";
    const s = setup();
    s.deps.searchKnowledge.mockImplementation(async (_actor, _client, input) => input.query === "filter" ? [hit, hit] : []);
    const result = await runOperationsAsk(actor, client, { workspaceId, question }, s.options, s.deps);
    expect(result).toMatchObject({ status: "EVIDENCE_FOUND", orders: [order], excerpts: [{ text: "disconnect power", citation: hit.citation }], providerSteps: 2 });
    const queries = s.deps.searchKnowledge.mock.calls.map((call) => call[2].query);
    expect(queries[0]).toBe(question); expect(queries.at(-1)).toBe("filter");
    expect(queries.filter((query) => query === "filter")).toHaveLength(2);
    expect(queries.every((query) => question.includes(query))).toBe(true);
    expect(s.options.beforeProviderCall).toHaveBeenCalledTimes(2);
    expect(s.model.doGenerateCalls).toHaveLength(2);
  });
  it("bounds missing knowledge fallback to eight literal queries and discloses partial evidence", async () => {
    const s = setup({ orderIds: [order.id], selections: [] }); s.deps.searchKnowledge.mockResolvedValue([]);
    const question = "Show orders and knowledge for QX-731 with unusual late technical guidance";
    const result = await runOperationsAsk(actor, client, { workspaceId, question }, s.options, s.deps);
    expect(result.answer).toContain("No published excerpt was verified"); expect(result.excerpts).toEqual([]);
    expect(s.deps.searchKnowledge.mock.calls.length).toBeLessThanOrEqual(8);
    expect(s.deps.searchKnowledge.mock.calls.every((call) => question.includes(call[2].query))).toBe(true);
  });
  it("stops a fallback after fresh access denial without another read or provider step", async () => {
    const s = setup(); s.deps.searchKnowledge.mockResolvedValue([]);
    s.options.revalidateScope.mockImplementation(async () => { if (s.deps.searchKnowledge.mock.calls.length === 1) throw new OperationsAskError("FORBIDDEN"); return 1; });
    await expect(runOperationsAsk(actor, client, { workspaceId, question: "Show my jobs and filter knowledge" }, s.options, s.deps)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(s.deps.searchKnowledge).toHaveBeenCalledTimes(1); expect(s.model.doGenerateCalls).toHaveLength(1);
  });
  it("cancels a pending fallback read without a later source or model call", async () => {
    const s = setup(); const controller = new AbortController();
    let finish!: (hits: KnowledgeHit[]) => void;
    s.deps.searchKnowledge.mockResolvedValueOnce([]).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = runOperationsAsk(actor, client, { workspaceId, question: "Show my jobs and filter knowledge" }, { ...s.options, abortSignal: controller.signal }, s.deps);
    await vi.waitFor(() => expect(s.deps.searchKnowledge).toHaveBeenCalledTimes(2)); controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" }); finish([]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(s.deps.searchKnowledge).toHaveBeenCalledTimes(2); expect(s.model.doGenerateCalls).toHaveLength(1);
  });
  it.each(["Which orders need attention, or how should a filter be cleaned?", "Which jobs need attention, or how should a filter be cleaned?"])("retains the late knowledge keyword in the actual placeholder: %s", async (question) => {
    const candidates = operationsKnowledgeCandidates(question);
    expect(candidates).toContain("filter"); expect(candidates.length).toBeLessThanOrEqual(8);
    expect(candidates.every((candidate) => question.includes(candidate))).toBe(true);
    const s = setup({ orderIds: [], selections: [] }, { includeOrders: true, includeKnowledge: true, queryIndex: candidates.indexOf("filter") });
    await runOperationsAsk(actor, client, { workspaceId, question }, s.options, s.deps);
    expect(s.deps.searchKnowledge).toHaveBeenCalledWith(actor, client, { workspaceId, query: "filter", limit: 8 });
  });
  it("answers one question using both actual order records and exact rechecked citations", async () => {
    const s = setup(); const result = await s.run();
    expect(result).toMatchObject({ status: "EVIDENCE_FOUND", orders: [order], excerpts: [{ text: "disconnect power", citation: hit.citation }], providerSteps: 2 });
    expect(s.deps.searchKnowledge).toHaveBeenCalledTimes(2);
    expect(s.deps.searchKnowledge).toHaveBeenCalledWith(actor, client, { workspaceId, query: "QX-731", limit: 8 });
    expect(s.deps.readOrders).toHaveBeenCalledWith(actor, client, { workspaceId, limit: 20 });
    expect(s.options.beforeProviderCall).toHaveBeenCalledTimes(2);
    expect(result.answer).not.toContain("QX-731 requires");
  });
  it.each(["ADMIN", "MANAGER", "TECHNICIAN"] as const)("supports scoped reads for %s without new broad permissions", async (role) => {
    const s = setup(); const candidate = { ...actor, membership: { ...actor.membership!, role } };
    await s.run(candidate); expect(s.deps.readOrders.mock.calls[0][0]).toBe(candidate);
    if (role === "TECHNICIAN") { expect(canUseOperationsAi(candidate)).toBe(true); expect(hasActorPermission(candidate, "ai:use")).toBe(false); }
  });
  it.each([ { ...actor, businessReady: false }, { ...actor, preview: { readOnly: true as const, effectiveEmployeeProfileId: actor.profileId } },
    { ...actor, membership: { ...actor.membership!, workspaceId: otherId } }, { ...actor, membership: undefined },
    { ...actor, isAnonymous: true } ])("denies invalid initial scope before provider resolution %o", async (candidate) => {
    const s = setup(); await expect(s.run(candidate)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(s.deps.resolveProvider).not.toHaveBeenCalled();
  });
  it("distinguishes empty results and uncertain selection from provider failure", async () => {
    const s = setup({ orderIds: [], selections: [] }); s.deps.readOrders.mockResolvedValue({ workspaceId, orders: [] }); s.deps.searchKnowledge.mockResolvedValue([]);
    expect(await s.run()).toMatchObject({ status: "INSUFFICIENT", orders: [], excerpts: [] });
  });
  it.each([
    { includeOrders: true, includeKnowledge: false, workspaceId: otherId }, { includeOrders: true, includeKnowledge: false, actorId: otherId },
    { includeOrders: true, includeKnowledge: false, orderId: otherId }, { includeOrders: true, includeKnowledge: false, limit: 500 },
    { includeOrders: false, includeKnowledge: true, query: "private secret" }, { includeOrders: false, includeKnowledge: true, queryIndex: 99 },
    { includeOrders: false, includeKnowledge: false },
  ])("rejects widened or invalid tool arguments %o", async (input) => {
    const s = setup({ orderIds: [], selections: [] }, input); await expect(s.run()).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(s.deps.readOrders).not.toHaveBeenCalled(); expect(s.deps.searchKnowledge).not.toHaveBeenCalled(); expect(s.model.doGenerateCalls).toHaveLength(1);
  });
  it.each([{ orderIds: [otherId], selections: [] }, { orderIds: [], selections: [{ index: 0, excerpt: "invented recommendation" }] },
    { orderIds: [order.id, order.id], selections: [] }, "Pretend this is a verified answer"]) ("never displays invented selection or prose %o", async (selection) => {
    const s = setup(selection); await expect(s.run()).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
  it("rejects citation replacement and changed current order fields", async () => {
    const citation = setup(); citation.deps.searchKnowledge.mockResolvedValueOnce([hit]).mockResolvedValueOnce([{ ...hit, citation: { ...hit.citation, versionId: order.id } }]);
    await expect(citation.run()).rejects.toMatchObject({ code: "STALE" });
    const changed = setup(); changed.deps.readOrder.mockResolvedValue({ workspaceId, order: { ...order, status: "COMPLETED" } });
    await expect(changed.run()).rejects.toMatchObject({ code: "STALE" });
  });
  it("denies scope changes before a second provider call", async () => {
    const s = setup(); s.options.revalidateScope.mockImplementation(async () => { if (s.options.beforeProviderCall.mock.calls.length === 2) throw new OperationsAskError("FORBIDDEN"); return 1; });
    await expect(s.run()).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(s.model.doGenerateCalls).toHaveLength(1);
  });
  it("retains Guest exhaustion and does not make a provider call", async () => {
    const s = setup(); s.options.beforeProviderCall.mockRejectedValue(new ProviderAllowanceError("EXHAUSTED"));
    await expect(s.run()).rejects.toMatchObject({ code: "EXHAUSTED" }); expect(s.model.doGenerateCalls).toHaveLength(0);
  });
  it("aborts during an in-flight read and suppresses later provider steps", async () => {
    const s = setup(); const controller = new AbortController();
    let finish!: (value: { workspaceId: string; orders: RecentOrder[] }) => void;
    s.deps.readOrders.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const pending = runOperationsAsk(actor, client, { workspaceId, question: "QX-731?" }, { ...s.options, abortSignal: controller.signal }, s.deps);
    await vi.waitFor(() => expect(s.deps.readOrders).toHaveBeenCalled()); controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" }); finish({ workspaceId, orders: [order] });
    await new Promise((resolve) => setTimeout(resolve, 10)); expect(s.model.doGenerateCalls).toHaveLength(1);
  });
  it("uses the real assignment-filtered service for Technician and returns no other jobs", async () => {
    const s = setup({ orderIds: [order.id], selections: [] }, { includeOrders: true, includeKnowledge: false });
    const equals: unknown[][] = [];
    const scopedClient = { from: (table: string) => {
      const query = { select: () => query, eq: (...args: unknown[]) => { equals.push(args); return query; }, order: () => query, limit: async () => ({ data: [order], error: null }), maybeSingle: async () => ({ data: table === "workspace_technicians" ? { id: otherId } : order, error: null }) };
      return query;
    } } as unknown as SupabaseClient;
    const deps: Parameters<typeof runOperationsAsk>[4] = { ...s.deps, readOrders: undefined, readOrder: undefined };
    const technician: ActorContext = { ...actor, membership: { workspaceId, kind: "OWNER", role: "TECHNICIAN" } };
    expect((await runOperationsAsk(technician, scopedClient, { workspaceId, question: "My jobs?" }, s.options, deps)).orders).toEqual([order]);
    expect(equals.filter(([key]) => key === "assigned_technician_id")).toEqual([["assigned_technician_id", otherId], ["assigned_technician_id", otherId]]);
  });
});
