import "server-only";

import { ToolLoopAgent, stepCountIs, tool, type LanguageModel } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { hasActorPermission, type ActorContext } from "@/lib/auth/actor-policy";
import { createSafeSDKChatModel } from "@/lib/ai/providers/safe-sdk-provider";
import type { AIProviderConnectionConfig } from "@/lib/ai/providers/types";
import { readRecentWorkspaceOrders, type RecentOrder } from "@/lib/capabilities/recent-orders";
import { resolveAIProviderForActorTask } from "@/lib/services/ai-config/service";
import { WorkspaceOrderAccessError } from "@/lib/services/workspace-orders/listing";

const inputSchema = z.object({
  workspaceId: z.string().uuid(),
  question: z.string().trim().min(1).max(1_000),
}).strict();

export class WorkspaceOrdersAgentError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorkspaceOrdersAgentError";
  }
}

type Dependencies = Readonly<{
  resolveProvider?: () => Promise<AIProviderConnectionConfig>;
  createModel?: (provider: AIProviderConnectionConfig) => LanguageModel;
  readOrders?: typeof readRecentWorkspaceOrders;
}>;

/** One real provider tool call over the same actor-scoped capability used by the GUI. */
export async function runWorkspaceOrdersAgent(
  actor: ActorContext,
  supabase: SupabaseClient,
  rawInput: z.input<typeof inputSchema>,
  options: { abortSignal?: AbortSignal } = {},
  dependencies: Dependencies = {},
): Promise<{
  workspaceId: string;
  orders: RecentOrder[];
  answer: string;
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
    instructions: "Use the available read-only order tool once to answer the user's question. The tool's workspace is fixed by the authenticated server context. Never claim to change data, and never invent orders or fields absent from the result.",
    tools: {
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
    prepareStep: ({ stepNumber }) => ({ toolChoice: stepNumber === 0 ? "required" : "none" }),
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
    throw new WorkspaceOrdersAgentError("Order agent failed", { cause: error });
  }
  options.abortSignal?.throwIfAborted();
  if (toolAttempts !== 1 || !evidence || result.steps.length > 2) {
    throw new WorkspaceOrdersAgentError("Provider did not complete one bounded order tool call");
  }
  // The model response is not accepted as evidence. A later UI adapter can
  // display these fixed rows or compose a checked presentation from them.
  return {
    ...evidence,
    answer: evidence.orders.length === 0
      ? "No recent orders were found in this workspace."
      : `Found ${evidence.orders.length} recent order${evidence.orders.length === 1 ? "" : "s"} in this workspace.`,
    providerSteps: result.steps.length,
    usage: {
      inputTokens: result.totalUsage.inputTokens,
      outputTokens: result.totalUsage.outputTokens,
    },
  };
}
