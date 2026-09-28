import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { ActorContext } from "@/lib/auth/actor-policy";

import { listWorkspaceOrders, WorkspaceOrderAccessError } from "./listing";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const otherWorkspaceId = "22222222-2222-4222-8222-222222222222";

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
  const eq = vi.fn().mockReturnValue({ order });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  return { client: { from } as unknown as SupabaseClient, from, eq, limit };
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
      const { client, from, eq, limit } = readClient();
      await expect(listWorkspaceOrders(actor(role), client, workspaceId))
        .resolves.toEqual([{ id: "order-1" }]);
      expect(from).toHaveBeenCalledWith("workspace_orders");
      expect(eq).toHaveBeenCalledWith("workspace_id", workspaceId);
      expect(limit).toHaveBeenCalledWith(50);
    },
  );
});
