import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { ActorContext } from "@/lib/auth/actor-policy";
import { getWorkspaceOrderById, listWorkspaceOrders } from "@/lib/services/workspace-orders/listing";

const requestSchema = z.object({
  workspaceId: z.string().uuid(),
  limit: z.number().int().min(1).max(50).optional(),
}).strict();

const orderByIdRequestSchema = z.object({
  workspaceId: z.string().uuid(),
  orderId: z.string().uuid(),
}).strict();

const orderSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  order_no: z.string(),
  branch_id: z.string().uuid(),
  customer_id: z.string().uuid(),
  assigned_technician_id: z.string().uuid().nullable(),
  problem_description: z.string(),
  service_type: z.string(),
  status: z.string(),
  scheduled_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type RecentOrdersRequest = z.input<typeof requestSchema>;
export type RecentOrder = z.output<typeof orderSchema>;
export type WorkspaceOrderByIdRequest = z.input<typeof orderByIdRequestSchema>;

export class RecentOrdersInputError extends Error {
  constructor() {
    super("Invalid recent orders request");
    this.name = "RecentOrdersInputError";
  }
}

export class WorkspaceOrderByIdInputError extends Error {
  constructor() {
    super("Invalid workspace order lookup request");
    this.name = "WorkspaceOrderByIdInputError";
  }
}

/**
 * Shared read capability for GUI, Assist, internal agent, and future MCP adapters.
 * The caller resolves the actor and supplies that user's Supabase session client;
 * tool arguments only select a workspace and a result bound.
 */
export async function readRecentWorkspaceOrders(
  actor: ActorContext,
  supabase: SupabaseClient,
  request: RecentOrdersRequest,
): Promise<{ workspaceId: string; orders: RecentOrder[] }> {
  const parsed = requestSchema.safeParse(request);
  if (!parsed.success) throw new RecentOrdersInputError();

  // The service enforces membership, role, assigned-technician filtering, and
  // the 50-row database bound before this capability shapes the response.
  const rows = await listWorkspaceOrders(actor, supabase, parsed.data.workspaceId);
  const orders = rows.slice(0, parsed.data.limit ?? 20).map((row) => orderSchema.parse(row));
  return { workspaceId: parsed.data.workspaceId, orders };
}

/** Read one actor-visible order by ID, including orders outside the recent list. */
export async function readWorkspaceOrderById(
  actor: ActorContext,
  supabase: SupabaseClient,
  request: WorkspaceOrderByIdRequest,
): Promise<{ workspaceId: string; order: RecentOrder | null }> {
  const parsed = orderByIdRequestSchema.safeParse(request);
  if (!parsed.success) throw new WorkspaceOrderByIdInputError();

  const { workspaceId, orderId } = parsed.data;
  const row = await getWorkspaceOrderById(actor, supabase, workspaceId, orderId);
  return { workspaceId, order: row ? orderSchema.parse(row) : null };
}
