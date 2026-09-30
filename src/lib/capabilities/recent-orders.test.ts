import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { ActorContext } from "@/lib/auth/actor-policy";
import { WorkspaceOrderAccessError } from "@/lib/services/workspace-orders/listing";

import {
  readRecentWorkspaceOrders,
  readWorkspaceOrderById,
  RecentOrdersInputError,
  WorkspaceOrderByIdInputError,
} from "./recent-orders";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const otherWorkspaceId = "22222222-2222-4222-8222-222222222222";
const orderId = "77777777-7777-4777-8777-777777777777";

const actor: ActorContext = {
  authUserId: "33333333-3333-4333-8333-333333333333",
  profileId: "44444444-4444-4444-8444-444444444444",
  isAnonymous: false,
  platformRole: "USER",
  membership: { workspaceId, kind: "OWNER", role: "MANAGER" },
};

function order(id: string) {
  return {
    id,
    workspace_id: workspaceId,
    order_no: "SO-1",
    branch_id: "55555555-5555-4555-8555-555555555555",
    customer_id: "66666666-6666-4666-8666-666666666666",
    assigned_technician_id: null,
    problem_description: "Air conditioner does not cool",
    service_type: "Repair",
    status: "NEW",
    scheduled_at: null,
    created_at: "2026-09-28T00:00:00Z",
    updated_at: "2026-09-28T00:00:00Z",
    secret_internal_field: "must not escape",
  };
}

function readClient(rows = [order("77777777-7777-4777-8777-777777777777")]) {
  const limit = vi.fn().mockResolvedValue({ data: rows, error: null });
  const orderBy = vi.fn().mockReturnValue({ limit });
  const maybeSingle = vi.fn().mockResolvedValue({ data: rows[0] ?? null, error: null });
  const query = { eq: vi.fn(), order: orderBy, maybeSingle };
  query.eq.mockReturnValue(query);
  const from = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(query) });
  return { client: { from } as unknown as SupabaseClient, from, limit, eq: query.eq, maybeSingle };
}

describe("recent workspace orders capability", () => {
  it("returns a bounded fixed projection through the scoped order service", async () => {
    const first = order("77777777-7777-4777-8777-777777777777");
    const second = order("88888888-8888-4888-8888-888888888888");
    const { client, from, limit, eq } = readClient([first, second]);
    const result = await readRecentWorkspaceOrders(actor, client, { workspaceId, limit: 1 });

    expect(result.workspaceId).toBe(workspaceId);
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0]).toMatchObject({ id: first.id, status: "NEW" });
    expect(result.orders[0]).not.toHaveProperty("secret_internal_field");
    expect(from).toHaveBeenCalledWith("workspace_orders");
    expect(eq).toHaveBeenCalledWith("workspace_id", workspaceId);
    expect(limit).toHaveBeenCalledWith(50);
  });

  it.each([{ limit: 0 }, { limit: 51 }, { limit: 1.5 }, { limit: Number.NaN }])(
    "rejects invalid bounds before querying: %j",
    async ({ limit }) => {
      const { client, from } = readClient();
      await expect(readRecentWorkspaceOrders(actor, client, { workspaceId, limit }))
        .rejects.toBeInstanceOf(RecentOrdersInputError);
      expect(from).not.toHaveBeenCalled();
    },
  );

  it("rejects malformed workspace IDs before querying", async () => {
    const { client, from } = readClient();
    await expect(readRecentWorkspaceOrders(actor, client, { workspaceId: "not-a-uuid" }))
      .rejects.toBeInstanceOf(RecentOrdersInputError);
    expect(from).not.toHaveBeenCalled();
  });

  it("defaults to at most 20 returned orders", async () => {
    const rows = Array.from({ length: 25 }, (_, index) => ({
      ...order("77777777-7777-4777-8777-777777777777"),
      order_no: `SO-${index + 1}`,
    }));
    const { client, limit } = readClient(rows);
    const result = await readRecentWorkspaceOrders(actor, client, { workspaceId });
    expect(result.orders).toHaveLength(20);
    expect(limit).toHaveBeenCalledWith(50);
  });

  it("rejects a workspace substitution before querying", async () => {
    const { client, from } = readClient();
    await expect(readRecentWorkspaceOrders(actor, client, { workspaceId: otherWorkspaceId }))
      .rejects.toBeInstanceOf(WorkspaceOrderAccessError);
    expect(from).not.toHaveBeenCalled();
  });

  it("does not grant a platform Super Admin business access without membership", async () => {
    const { client, from } = readClient();
    await expect(readRecentWorkspaceOrders(
      { ...actor, platformRole: "SUPER_ADMIN", membership: undefined },
      client,
      { workspaceId },
    )).rejects.toBeInstanceOf(WorkspaceOrderAccessError);
    expect(from).not.toHaveBeenCalled();
  });

  it("fails closed when the backing query fails", async () => {
    const { client, limit } = readClient();
    limit.mockResolvedValue({ data: null, error: { message: "database unavailable" } });
    await expect(readRecentWorkspaceOrders(actor, client, { workspaceId }))
      .rejects.toThrow("Workspace orders could not be read");
  });
});

describe("workspace order by ID capability", () => {
  it("returns a fixed projection for an exact order without reading the recent list", async () => {
    const row = order(orderId);
    const { client, eq, limit, maybeSingle } = readClient([row]);
    const result = await readWorkspaceOrderById(actor, client, { workspaceId, orderId });
    expect(result).toMatchObject({ workspaceId, order: { id: orderId, status: "NEW" } });
    expect(result.order).not.toHaveProperty("secret_internal_field");
    expect(eq).toHaveBeenCalledWith("workspace_id", workspaceId);
    expect(eq).toHaveBeenCalledWith("id", orderId);
    expect(maybeSingle).toHaveBeenCalledOnce();
    expect(limit).not.toHaveBeenCalled();
  });

  it("returns null for an absent actor-visible order", async () => {
    const { client } = readClient([]);
    await expect(readWorkspaceOrderById(actor, client, { workspaceId, orderId }))
      .resolves.toEqual({ workspaceId, order: null });
  });

  it.each([
    { workspaceId: "not-a-uuid", orderId },
    { workspaceId, orderId: "not-a-uuid" },
    { workspaceId, orderId, extra: true },
  ])("rejects malformed lookup input before querying: %j", async (request) => {
    const { client, from } = readClient();
    await expect(readWorkspaceOrderById(actor, client, request))
      .rejects.toBeInstanceOf(WorkspaceOrderByIdInputError);
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects a cross-workspace request before querying", async () => {
    const { client, from } = readClient();
    await expect(readWorkspaceOrderById(actor, client, { workspaceId: otherWorkspaceId, orderId }))
      .rejects.toBeInstanceOf(WorkspaceOrderAccessError);
    expect(from).not.toHaveBeenCalled();
  });

  it("fails closed on a database error", async () => {
    const { client, maybeSingle } = readClient();
    maybeSingle.mockResolvedValue({ data: null, error: { message: "database unavailable" } });
    await expect(readWorkspaceOrderById(actor, client, { workspaceId, orderId }))
      .rejects.toThrow("Workspace order could not be read");
  });
});
