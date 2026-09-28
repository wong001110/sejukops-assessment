import type { SupabaseClient } from "@supabase/supabase-js";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it, vi } from "vitest";

import type { ActorContext } from "@/lib/auth/actor-policy";
import type { AIProviderConnectionConfig } from "@/lib/ai/providers/types";
import { WorkspaceOrderAccessError } from "@/lib/services/workspace-orders/listing";

import { runWorkspaceOrdersAgent, WorkspaceOrdersAgentError } from "./workspace-orders-agent";

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

describe("bounded workspace order agent", () => {
  it("executes exactly one actor-scoped tool and returns only deterministic evidence", async () => {
    const model = modelWithOneTool();
    const readOrders = vi.fn(async () => ({ workspaceId, orders: [] }));
    const result = await runWorkspaceOrdersAgent(
      actor, client, { workspaceId, question: "Show recent orders" }, {},
      { resolveProvider: async () => provider, createModel: () => model, readOrders },
    );
    expect(readOrders).toHaveBeenCalledOnce();
    expect(readOrders).toHaveBeenCalledWith(actor, client, { workspaceId, limit: 20 });
    expect(result).toMatchObject({ workspaceId, orders: [], providerSteps: 2 });
    expect(result.answer).toBe("No recent orders were found in this workspace.");
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(model.doGenerateCalls[1].toolChoice).toEqual({ type: "none" });
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
