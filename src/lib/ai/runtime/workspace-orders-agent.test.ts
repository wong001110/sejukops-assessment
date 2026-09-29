import type { SupabaseClient } from "@supabase/supabase-js";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it, vi } from "vitest";

import type { ActorContext } from "@/lib/auth/actor-policy";
import type { AIProviderConnectionConfig } from "@/lib/ai/providers/types";
import type { RecentOrder } from "@/lib/capabilities/recent-orders";
import { WorkspaceOrderAccessError } from "@/lib/services/workspace-orders/listing";

import { ProviderAllowanceError, runWorkspaceOrdersAgent, WorkspaceOrdersAgentError } from "./workspace-orders-agent";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const actor: ActorContext = {
  authUserId: "22222222-2222-4222-8222-222222222222",
  profileId: "33333333-3333-4333-8333-333333333333",
  isAnonymous: false,
  platformRole: "USER",
  membership: { workspaceId, kind: "OWNER", role: "MANAGER" },
};
const provider: AIProviderConnectionConfig = {
  providerType: "OPENAI_COMPATIBLE",
  baseUrl: "https://provider.example/v1",
  model: "test-model",
  apiKey: "test-key",
  capabilities: { text: true, vision: false, toolCalling: true, structuredOutput: true },
};
const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};
const client = {} as SupabaseClient;

function modelWithOneTool() {
  return new MockLanguageModelV3({
    doGenerate: [
      {
        content: [{ type: "tool-call", toolCallId: "call-1", toolName: "recentOrders", input: "{}" }],
        finishReason: { unified: "tool-calls", raw: undefined }, usage, warnings: [],
      },
      {
        content: [{ type: "text", text: "A fabricated order was completed." }],
        finishReason: { unified: "stop", raw: undefined }, usage, warnings: [],
      },
    ],
  });
}

function modelWithSelection(orderIds: string[], toolName = "recentOrders") {
  return new MockLanguageModelV3({
    doGenerate: [
      {
        content: [{ type: "tool-call", toolCallId: "call-1", toolName, input: "{}" }],
        finishReason: { unified: "tool-calls", raw: undefined }, usage, warnings: [],
      },
      {
        content: [{ type: "text", text: JSON.stringify({ orderIds }) }],
        finishReason: { unified: "stop", raw: undefined }, usage, warnings: [],
      },
    ],
  });
}

function order(id: string, orderNo: string): RecentOrder {
  return { id, workspace_id: workspaceId, order_no: orderNo,
    branch_id: "44444444-4444-4444-8444-444444444444",
    customer_id: "55555555-5555-4555-8555-555555555555",
    assigned_technician_id: null, problem_description: "Cooling issue", service_type: "Repair",
    status: "NEW", scheduled_at: null, created_at: "2026-09-29T00:00:00Z",
    updated_at: "2026-09-29T00:00:00Z" };
}

describe("bounded workspace order agent", () => {
  it("executes exactly one actor-scoped tool and returns only deterministic evidence", async () => {
    const model = modelWithOneTool();
    const readOrders = vi.fn(async () => ({ workspaceId, orders: [] }));
    const beforeProviderCall = vi.fn(async () => {});
    const result = await runWorkspaceOrdersAgent(
      actor, client, { workspaceId, question: "Show recent orders" }, { beforeProviderCall },
      { resolveProvider: async () => provider, createModel: () => model, readOrders },
    );
    expect(readOrders).toHaveBeenCalledOnce();
    expect(readOrders).toHaveBeenCalledWith(actor, client, { workspaceId, limit: 20 });
    expect(result).toMatchObject({ workspaceId, orders: [], providerSteps: 2,
      activity: [{ type: "RECENT_ORDERS_READ", orderCount: 0 }] });
    expect(result.answer).toBe("No recent orders were found in this workspace.");
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(beforeProviderCall).toHaveBeenCalledTimes(2);
    expect(model.doGenerateCalls[1].toolChoice).toEqual({ type: "none" });
  });

  it("blocks the second outbound model step when its allowance is exhausted", async () => {
    const model = modelWithOneTool();
    let calls = 0;
    await expect(runWorkspaceOrdersAgent(
      actor, client, { workspaceId, question: "Show recent orders" },
      { beforeProviderCall: async () => {
        calls += 1;
        if (calls === 2) throw new ProviderAllowanceError("EXHAUSTED", "2026-09-30T00:00:00+08:00");
      } },
      { resolveProvider: async () => provider, createModel: () => model,
        readOrders: async () => ({ workspaceId, orders: [] }) },
    )).rejects.toMatchObject({ code: "EXHAUSTED" });
    expect(calls).toBe(2);
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("uses provider-selected IDs only when both are present in the scoped evidence", async () => {
    const first = order("66666666-6666-4666-8666-666666666666", "SO-1");
    const second = order("77777777-7777-4777-8777-777777777777", "SO-2");
    const readOrders = vi.fn(async () => ({ workspaceId, orders: [first, second] }));
    const dependencies = { resolveProvider: async () => provider, readOrders };
    const firstResult = await runWorkspaceOrdersAgent(actor, client,
      { workspaceId, question: "Which order is SO-1?" }, {},
      { ...dependencies, createModel: () => modelWithSelection([first.id]) });
    const secondResult = await runWorkspaceOrdersAgent(actor, client,
      { workspaceId, question: "Which order is SO-2?" }, {},
      { ...dependencies, createModel: () => modelWithSelection([second.id]) });
    expect(firstResult.orders.map((item) => item.id)).toEqual([first.id]);
    expect(secondResult.orders.map((item) => item.id)).toEqual([second.id]);
    expect(firstResult.answer).toContain("potentially relevant");
    expect(readOrders).toHaveBeenCalledTimes(2);

    const invented = await runWorkspaceOrdersAgent(actor, client,
      { workspaceId, question: "Show an invented order" }, {},
      { ...dependencies, createModel: () => modelWithSelection(["88888888-8888-4888-8888-888888888888"]) });
    expect(invented.orders.map((item) => item.id)).toEqual([first.id, second.id]);
    expect(invented.answer).toContain("could not verify");

    const duplicate = await runWorkspaceOrdersAgent(actor, client,
      { workspaceId, question: "Show SO-1 twice" }, {},
      { ...dependencies, createModel: () => modelWithSelection([first.id, first.id]) });
    expect(duplicate.orders.map((item) => item.id)).toEqual([first.id, second.id]);
    expect(duplicate.answer).toContain("could not verify");
  });

  it("reads a selected order by exact ID even when it is outside the recent list", async () => {
    const selected = order("99999999-9999-4999-8999-999999999999", "OLDER-21");
    const readOrders = vi.fn();
    const readOrderById = vi.fn(async () => ({ workspaceId, order: selected }));
    const result = await runWorkspaceOrdersAgent(actor, client,
      { workspaceId, question: "Review this order", focusOrderId: selected.id }, {},
      { resolveProvider: async () => provider, createModel: () => modelWithSelection([], "orderById"),
        readOrders, readOrderById });
    expect(readOrderById).toHaveBeenCalledWith(actor, client,
      { workspaceId, orderId: selected.id });
    expect(readOrders).not.toHaveBeenCalled();
    expect(result.orders).toEqual([selected]);
    expect(result.activity).toEqual([{ type: "ORDER_READ", orderCount: 1 }]);
    expect(result.answer).toContain("OLDER-21");
  });

  it("does not return a completed activity event when cancelled after the tool read", async () => {
    const controller = new AbortController();
    const readOrders = vi.fn(async () => ({ workspaceId, orders: [] }));
    let steps = 0;
    await expect(runWorkspaceOrdersAgent(
      actor, client, { workspaceId, question: "Show recent orders" },
      { abortSignal: controller.signal, beforeProviderCall: async () => {
        steps += 1;
        if (steps === 2) controller.abort(new Error("cancelled"));
      } },
      { resolveProvider: async () => provider, createModel: modelWithOneTool, readOrders },
    )).rejects.toThrow("cancelled");
    expect(readOrders).toHaveBeenCalledOnce();
  });

  it("denies workspace substitution before provider resolution", async () => {
    const resolveProvider = vi.fn(async () => provider);
    await expect(runWorkspaceOrdersAgent(
      actor, client,
      { workspaceId: "44444444-4444-4444-8444-444444444444", question: "Show orders" },
      {}, { resolveProvider },
    )).rejects.toBeInstanceOf(WorkspaceOrderAccessError);
    expect(resolveProvider).not.toHaveBeenCalled();
  });

  it("denies a Technician without AI permission before provider resolution", async () => {
    const resolveProvider = vi.fn(async () => provider);
    await expect(runWorkspaceOrdersAgent(
      { ...actor, membership: { workspaceId, kind: "OWNER", role: "TECHNICIAN" } },
      client, { workspaceId, question: "Show orders" }, {}, { resolveProvider },
    )).rejects.toBeInstanceOf(WorkspaceOrderAccessError);
    expect(resolveProvider).not.toHaveBeenCalled();
  });

  it("fails closed when the provider does not call the approved tool", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: {
        content: [{ type: "text", text: "I know the answer without data." }],
        finishReason: { unified: "stop", raw: undefined }, usage, warnings: [],
      },
    });
    await expect(runWorkspaceOrdersAgent(
      actor, client, { workspaceId, question: "Show orders" }, {},
      { resolveProvider: async () => provider, createModel: () => model },
    )).rejects.toBeInstanceOf(WorkspaceOrdersAgentError);
  });

  it("honors a pre-aborted caller signal before provider resolution", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    const resolveProvider = vi.fn(async () => provider);
    await expect(runWorkspaceOrdersAgent(
      actor, client, { workspaceId, question: "Show orders" },
      { abortSignal: controller.signal }, { resolveProvider },
    )).rejects.toThrow("cancelled");
    expect(resolveProvider).not.toHaveBeenCalled();
  });
});
