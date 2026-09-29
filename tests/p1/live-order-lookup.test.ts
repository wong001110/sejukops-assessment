import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { deriveGuestPrincipalPassword, GUEST_PRINCIPAL_EMAILS } from "@/lib/auth/guest-principal";
import { resolveActorFromAuthenticatedClient } from "@/lib/auth/server-actor";
import { readWorkspaceOrderById } from "@/lib/capabilities/recent-orders";
import { WorkspaceOrderAccessError } from "@/lib/services/workspace-orders/listing";

const TEST_HOST = "qobhjvrrpajoyvlgrkbx.supabase.co";
const runLive = process.env.RUN_LIVE_ORDER_LOOKUP === "1";

describe.skipIf(!runLive)("confirmed Test order lookup with a real Demo Technician JWT", () => {
  it("reads its assigned order and denies an unassigned order and Owner workspace", async () => {
    process.loadEnvFile(".env");
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || new URL(url).hostname !== TEST_HOST || !anonKey || !serviceKey) {
      throw new Error("Live lookup requires exact confirmed Test project credentials");
    }
    const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
    const service = createClient(url, serviceKey, options);
    const { data: workspaces, error: workspaceError } = await service.from("workspaces")
      .select("id,kind").in("kind", ["DEMO", "OWNER"]).eq("active", true);
    if (workspaceError || workspaces?.length !== 2) throw new Error("Test workspace inventory changed");
    const demoId = workspaces.find((item) => item.kind === "DEMO")?.id;
    const ownerId = workspaces.find((item) => item.kind === "OWNER")?.id;
    if (!demoId || !ownerId) throw new Error("Test workspace inventory changed");
    const { data: technician, error: technicianError } = await service.from("workspace_technicians")
      .select("id").eq("workspace_id", demoId).eq("active", true).maybeSingle();
    if (technicianError || !technician) throw new Error("Demo Technician fixture unavailable");
    const { data: orders, error: orderError } = await service.from("workspace_orders")
      .select("id,assigned_technician_id").eq("workspace_id", demoId).limit(50);
    if (orderError || !orders) throw new Error("Demo order fixture unavailable");
    const assigned = orders.find((item) => item.assigned_technician_id === technician.id);
    const unassigned = orders.find((item) => item.assigned_technician_id !== technician.id);
    if (!assigned || !unassigned) throw new Error("Positive and negative Demo order fixtures are required");

    const client = createClient(url, anonKey, options);
    const password = deriveGuestPrincipalPassword(serviceKey, TEST_HOST, "TECHNICIAN");
    const { data: login, error: loginError } = await client.auth.signInWithPassword({
      email: GUEST_PRINCIPAL_EMAILS.TECHNICIAN, password,
    });
    if (loginError || !login.user) throw new Error("Fixed Demo Technician login failed");
    try {
      const actor = await resolveActorFromAuthenticatedClient(client, demoId);
      if (!actor || actor.membership?.role !== "TECHNICIAN") throw new Error("Demo Technician actor resolution failed");
      const positive = await readWorkspaceOrderById(actor, client,
        { workspaceId: demoId, orderId: assigned.id });
      expect(positive.order?.id).toBe(assigned.id);
      const denied = await readWorkspaceOrderById(actor, client,
        { workspaceId: demoId, orderId: unassigned.id });
      expect(denied.order).toBeNull();
      await expect(readWorkspaceOrderById(actor, client,
        { workspaceId: ownerId, orderId: assigned.id })).rejects.toBeInstanceOf(WorkspaceOrderAccessError);
    } finally {
      const { error: signOutError } = await client.auth.signOut();
      if (signOutError) throw new Error("Fixed Demo Technician sign-out failed");
    }
  }, 30_000);
});
