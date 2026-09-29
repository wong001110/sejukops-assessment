import "server-only";

import { ToolLoopAgent, stepCountIs, tool, type LanguageModel } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { hasActorPermission, type ActorContext } from "@/lib/auth/actor-policy";
import { createSafeSDKChatModel } from "@/lib/ai/providers/safe-sdk-provider";
import type { AIProviderConnectionConfig } from "@/lib/ai/providers/types";
import { readRecentWorkspaceOrders, readWorkspaceOrderById, type RecentOrder } from "@/lib/capabilities/recent-orders";
import { resolveAIProviderForActorTask } from "@/lib/services/ai-config/service";
import { WorkspaceOrderAccessError } from "@/lib/services/workspace-orders/listing";

const inputSchema = z.object({
  workspaceId: z.string().uuid(),
  question: z.string().trim().min(1).max(1_000),
  focusOrderId: z.string().uuid().optional(),
}).strict();

const selectionSchema = z.object({ orderIds: z.array(z.string().uuid()).max(5) }).strict();

function selectEvidence(text: string, orders: RecentOrder[]): RecentOrder[] | null {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return null; }
  const parsed = selectionSchema.safeParse(value);
  if (!parsed.success) return null;
  const selected = new Set(parsed.data.orderIds);
  if (selected.size !== parsed.data.orderIds.length ||
    parsed.data.orderIds.some((id) => !orders.some((order) => order.id === id))) return null;
  return orders.filter((order) => selected.has(order.id));
}

export class WorkspaceOrdersAgentError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorkspaceOrdersAgentError";
  }
}

export class ProviderAllowanceError extends Error {
  constructor(readonly code: "EXHAUSTED" | "UNAVAILABLE", readonly resetAt?: string) {
    super(`Provider allowance ${code.toLowerCase()}`);
    this.name = "ProviderAllowanceError";
  }
}

type Dependencies = Readonly<{
  resolveProvider?: () => Promise<AIProviderConnectionConfig>;
  createModel?: (provider: AIProviderConnectionConfig) => LanguageModel;
  readOrders?: typeof readRecentWorkspaceOrders;
  readOrderById?: typeof readWorkspaceOrderById;
}>;

/** One real provider tool call over the same actor-scoped capability used by the GUI. */
export async function runWorkspaceOrdersAgent(
  actor: ActorContext,
  supabase: SupabaseClient,
  rawInput: z.input<typeof inputSchema>,
  options: { abortSignal?: AbortSignal; beforeProviderCall?: () => Promise<void> } = {},
  dependencies: Dependencies = {},
): Promise<{
  workspaceId: string;
  orders: RecentOrder[];
  answer: string;
  activity: Array<{ type: "RECENT_ORDERS_READ" | "ORDER_READ"; orderCount: number }>;
  providerSteps: number;
  usage: { inputTokens: number | undefined; outputTokens: number | undefined };
}> {
  const input = inputSchema.parse(rawInput);
  if (
    actor.membership?.workspaceId !== input.workspaceId ||
    !hasActorPermission(actor, "ai:use") ||
    !(hasActorPermission(actor, "order:view") || hasActorPermission(actor, "job:view_assigned"))
  ) {
    throw new WorkspaceOrderAccessError();
  }
  options.abortSignal?.throwIfAborted();

  let provider: AIProviderConnectionConfig;
  try {
    provider = await (dependencies.resolveProvider ?? (() => resolveAIProviderForActorTask(actor, "OPERATIONS_QUERY")))();
  } catch (error) {
    throw new WorkspaceOrdersAgentError("Order agent provider unavailable", { cause: error });
  }
  if (!provider.capabilities.toolCalling) {
    throw new WorkspaceOrdersAgentError("Configured model does not support tool calling");
  }
  const model = (dependencies.createModel ?? createSafeSDKChatModel)(provider);

  let toolAttempts = 0;
  let evidence: { workspaceId: string; orders: RecentOrder[] } | undefined;
  const agent = new ToolLoopAgent({
    model,
    instructions: input.focusOrderId
      ? "Call the available exact-order read tool once. Its workspace and order ID are fixed by the authenticated server context. Do not invent or change records."
      : "Call the available recent-orders tool once. Then return only JSON like {\"orderIds\":[\"uuid\"]} with at most five IDs from the tool result that may be relevant to the user's question. Return an empty array when unsure. Never invent IDs or change records.",
    tools: input.focusOrderId ? {
      orderById: tool({
        description: "Read the selected order by its server-validated ID within the authenticated workspace. No arguments or writes are available.",
        inputSchema: z.object({}).strict(),
        execute: async () => {
          toolAttempts += 1;
          if (toolAttempts !== 1) throw new WorkspaceOrdersAgentError("Tool call limit exceeded");
          options.abortSignal?.throwIfAborted();
          const result = await (dependencies.readOrderById ?? readWorkspaceOrderById)(
            actor, supabase, { workspaceId: input.workspaceId, orderId: input.focusOrderId! },
          );
          options.abortSignal?.throwIfAborted();
          evidence = { workspaceId: result.workspaceId, orders: result.order ? [result.order] : [] };
          return result;
        },
      }),
    } : {
      recentOrders: tool({
        description: "Read at most 20 recent orders from the authenticated workspace. No arguments or writes are available.",
        inputSchema: z.object({}).strict(),
        execute: async () => {
          toolAttempts += 1;
          if (toolAttempts !== 1) throw new WorkspaceOrdersAgentError("Tool call limit exceeded");
          options.abortSignal?.throwIfAborted();
          const result = await (dependencies.readOrders ?? readRecentWorkspaceOrders)(
            actor,
            supabase,
            { workspaceId: input.workspaceId, limit: 20 },
          );
          options.abortSignal?.throwIfAborted();
          evidence = result;
          return result;
        },
      }),
    },
    toolChoice: "required",
    prepareStep: async ({ stepNumber }) => {
      options.abortSignal?.throwIfAborted();
      await options.beforeProviderCall?.();
      return { toolChoice: stepNumber === 0 ? "required" : "none" };
    },
    stopWhen: stepCountIs(2),
    maxOutputTokens: 400,
    maxRetries: 0,
  });

  let result: Awaited<ReturnType<typeof agent.generate>>;
  try {
    result = await agent.generate({
      prompt: input.question,
      abortSignal: options.abortSignal,
      timeout: { totalMs: 20_000 },
    });
  } catch (error) {
    if (options.abortSignal?.aborted) throw options.abortSignal.reason;
    if (error instanceof ProviderAllowanceError) throw error;
    throw new WorkspaceOrdersAgentError("Order agent failed", { cause: error });
  }
  options.abortSignal?.throwIfAborted();
  if (toolAttempts !== 1 || !evidence || result.steps.length > 2) {
    throw new WorkspaceOrdersAgentError("Provider did not complete one bounded order tool call");
  }
  // The model may select IDs already returned by the scoped tool. Its prose
  // and any invented/invalid IDs never become the browser's evidence.
  const selectedOrders = input.focusOrderId ? evidence.orders : selectEvidence(result.text, evidence.orders);
  const orders = selectedOrders ?? evidence.orders;
  const answer = input.focusOrderId
    ? orders.length ? `Found order ${orders[0].order_no} in this workspace. Review its details below.`
      : "That order is not visible in this workspace."
    : evidence.orders.length === 0 ? "No recent orders were found in this workspace."
      : selectedOrders === null ? "The assistant could not verify which recent orders fit this question. Review the latest scoped orders below."
      : orders.length ? `Found ${orders.length} potentially relevant recent order${orders.length === 1 ? "" : "s"}. Review the records below.`
        : "No matching order could be verified among the latest 20. Search Orders manually if you need older records.";
  return {
    workspaceId: evidence.workspaceId,
    orders,
    answer,
    activity: [{ type: input.focusOrderId ? "ORDER_READ" : "RECENT_ORDERS_READ", orderCount: evidence.orders.length }],
    providerSteps: result.steps.length,
    usage: {
      inputTokens: result.totalUsage.inputTokens,
      outputTokens: result.totalUsage.outputTokens,
    },
  };
}
