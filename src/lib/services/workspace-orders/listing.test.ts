import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { ActorContext } from "@/lib/auth/actor-policy";

import { getWorkspaceOrderById, listWorkspaceOrders, WorkspaceOrderAccessError } from "./listing";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const otherWorkspaceId = "22222222-2222-4222-8222-222222222222";
const orderId = "77777777-7777-4777-8777-777777777777";

function actor(role: "ADMIN" | "MANAGER" | "TECHNICIAN", selectedId = workspaceId): ActorContext {
  return {
    authUserId: "33333333-3333-4333-8333-333333333333",
    profileId: "44444444-4444-4444-8444-444444444444",
    isAnonymous: false,
    platformRole: "USER",
    membership: { workspaceId: selectedId, kind: "OWNER", role },
  };
}

function readClient() {
  const limit = vi.fn().mockResolvedValue({ data: [{ id: "order-1" }], error: null });
  const order = vi.fn().mockReturnValue({ limit });
  const orderQuery = {
    eq: vi.fn(),
    order,
    maybeSingle: vi.fn().mockResolvedValue({ data: { id: orderId }, error: null }),
  };
  orderQuery.eq.mockReturnValue(orderQuery);
  const technicianQuery = {
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { id: "tech-1" }, error: null }),
  };
  technicianQuery.eq.mockReturnValue(technicianQuery);
  const from = vi.fn((table: string) => ({
    select: vi.fn().mockReturnValue(table === "workspace_technicians" ? technicianQuery : orderQuery),
  }));
  return {
    client: { from } as unknown as SupabaseClient,
    from,
    orderEq: orderQuery.eq,
    technicianEq: technicianQuery.eq,
    technicianLookup: technicianQuery.maybeSingle,
    orderLookup: orderQuery.maybeSingle,
    limit,
  };
}

describe("workspace order listing", () => {
  it("rejects a workspace substitution before any database access", async () => {
    const { client, from } = readClient();
    await expect(listWorkspaceOrders(actor("ADMIN"), client, otherWorkspaceId))
      .rejects.toBeInstanceOf(WorkspaceOrderAccessError);
    expect(from).not.toHaveBeenCalled();
  });

  it("does not treat platform Super Admin as an implicit business membership", async () => {
    const { client, from } = readClient();
    const platformActor: ActorContext = {
      authUserId: actor("ADMIN").authUserId,
      profileId: actor("ADMIN").profileId,
      platformRole: "SUPER_ADMIN",
      isAnonymous: false,
    };
    await expect(listWorkspaceOrders(platformActor, client, workspaceId))
      .rejects.toBeInstanceOf(WorkspaceOrderAccessError);
    expect(from).not.toHaveBeenCalled();
  });

  it.each(["ADMIN", "MANAGER", "TECHNICIAN"] as const)(
    "limits a %s read to the selected workspace",
    async (role) => {
      const { client, from, orderEq, limit } = readClient();
      await expect(listWorkspaceOrders(actor(role), client, workspaceId))
        .resolves.toEqual([{ id: "order-1" }]);
      expect(from).toHaveBeenCalledWith("workspace_orders");
      expect(orderEq).toHaveBeenCalledWith("workspace_id", workspaceId);
      if (role === "TECHNICIAN") {
        expect(orderEq).toHaveBeenCalledWith("assigned_technician_id", "tech-1");
      } else {
        expect(orderEq).not.toHaveBeenCalledWith("assigned_technician_id", expect.anything());
      }
      expect(limit).toHaveBeenCalledWith(50);
    },
  );

  it("does not query orders when a technician has no active mapping", async () => {
    const { client, from, technicianLookup } = readClient();
    technicianLookup.mockResolvedValue({ data: null, error: null });
    await expect(listWorkspaceOrders(actor("TECHNICIAN"), client, workspaceId))
      .resolves.toEqual([]);
    expect(from).not.toHaveBeenCalledWith("workspace_orders");
  });
});

describe("workspace order lookup by ID", () => {
  it("reads the exact order without the recent-50 bound", async () => {
    const { client, orderEq, orderLookup, limit } = readClient();
    await expect(getWorkspaceOrderById(actor("MANAGER"), client, workspaceId, orderId))
      .resolves.toEqual({ id: orderId });
    expect(orderEq).toHaveBeenCalledWith("workspace_id", workspaceId);
    expect(orderEq).toHaveBeenCalledWith("id", orderId);
    expect(orderLookup).toHaveBeenCalledOnce();
    expect(limit).not.toHaveBeenCalled();
  });

  it("returns null when the scoped order is absent", async () => {
    const { client, orderLookup } = readClient();
    orderLookup.mockResolvedValue({ data: null, error: null });
    await expect(getWorkspaceOrderById(actor("ADMIN"), client, workspaceId, orderId))
      .resolves.toBeNull();
  });

  it("rejects workspace substitution before any database access", async () => {
    const { client, from } = readClient();
    await expect(getWorkspaceOrderById(actor("ADMIN"), client, otherWorkspaceId, orderId))
      .rejects.toBeInstanceOf(WorkspaceOrderAccessError);
    expect(from).not.toHaveBeenCalled();
  });

  it("requires a business membership even for a platform Super Admin", async () => {
    const { client, from } = readClient();
    await expect(getWorkspaceOrderById(
      { ...actor("ADMIN"), platformRole: "SUPER_ADMIN", membership: undefined },
      client,
      workspaceId,
      orderId,
    )).rejects.toBeInstanceOf(WorkspaceOrderAccessError);
    expect(from).not.toHaveBeenCalled();
  });

  it("filters a Technician lookup by active assignment", async () => {
    const { client, orderEq, technicianEq } = readClient();
    await getWorkspaceOrderById(actor("TECHNICIAN"), client, workspaceId, orderId);
    expect(technicianEq).toHaveBeenCalledWith("workspace_id", workspaceId);
    expect(technicianEq).toHaveBeenCalledWith("profile_id", actor("TECHNICIAN").profileId);
    expect(technicianEq).toHaveBeenCalledWith("active", true);
    expect(orderEq).toHaveBeenCalledWith("assigned_technician_id", "tech-1");
  });

  it("does not query orders without an active Technician mapping", async () => {
    const { client, from, technicianLookup } = readClient();
    technicianLookup.mockResolvedValue({ data: null, error: null });
    await expect(getWorkspaceOrderById(actor("TECHNICIAN"), client, workspaceId, orderId))
      .resolves.toBeNull();
    expect(from).not.toHaveBeenCalledWith("workspace_orders");
  });

  it("fails closed on database errors", async () => {
    const { client, orderLookup } = readClient();
    orderLookup.mockResolvedValue({ data: null, error: { message: "database unavailable" } });
    await expect(getWorkspaceOrderById(actor("MANAGER"), client, workspaceId, orderId))
      .rejects.toThrow("Workspace order could not be read");
  });
});
