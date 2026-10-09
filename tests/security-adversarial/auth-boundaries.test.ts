import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

// Prevent the real server client factory (and any credential lookup) from loading.
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: vi.fn() }));

import { resolveActorFromAuthenticatedClient } from "@/lib/auth/server-actor";
import { canUseKnowledgeAi, canUseOperationsAi, hasActorPermission, type ActorContext } from "@/lib/auth/actor-policy";
import { listWorkspaceOrders, getWorkspaceOrderById } from "@/lib/services/workspace-orders/listing";
import { createWorkspaceOrder, assignWorkspaceOrder } from "@/lib/services/workspace-orders/commands";
import { rescheduleManagerOrder } from "@/lib/services/workspace-orders/manager-reschedule";
import { transitionAssignedJob } from "@/lib/services/workspace-orders/technician-transition";
import { approveWorkspaceOrderAssignmentFromWeb, executeWorkspaceOrderAssignmentProposal, proposeWorkspaceOrderAssignment } from "@/lib/services/workspace-orders/assignment-proposals";

// All identities, session proofs and business arguments below are synthetic.
const workspaceId = "11111111-1111-4111-8111-111111111111";
const profileId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const sessionId = "44444444-4444-4444-8444-444444444444";
const revision = "55555555-5555-4555-8555-555555555555";
const employeeId = "66666666-6666-4666-8666-666666666666";
const orderId = "77777777-7777-4777-8777-777777777777";
const timestamp = "2026-10-09T00:00:00Z";
const managed = { isManaged: true, passwordChangeRequired: false, sessionAllowed: true, authRevision: revision, sessionId };
type Role = "ADMIN" | "MANAGER" | "TECHNICIAN";

function actor(role: Role = "ADMIN"): ActorContext {
  return { authUserId: userId, profileId, isAnonymous: false, platformRole: "USER", businessReady: true,
    sessionId, staff: { passwordChangeRequired: false, sessionAllowed: true, authRevision: revision },
    membership: { workspaceId, kind: "OWNER", role } };
}

function resolverClient(options: {
  authError?: unknown; user?: unknown; profile?: unknown; membership?: unknown; workspace?: unknown;
  status?: unknown; statusError?: unknown; preview?: unknown; previewError?: unknown; tableError?: string;
} = {}) {
  const rows: Record<string, unknown> = {
    profiles: options.profile === undefined ? { id: profileId, auth_user_id: userId, platform_role: "USER", active: true } : options.profile,
    workspace_memberships: options.membership === undefined ? { profile_id: profileId, workspace_id: workspaceId, role: "ADMIN", active: true } : options.membership,
    workspaces: options.workspace === undefined ? { id: workspaceId, kind: "OWNER", active: true } : options.workspace,
  };
  const queries = new Map<string, { eq: ReturnType<typeof vi.fn> }>();
  const from = vi.fn((table: string) => {
    const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: rows[table], error: options.tableError === table ? { message: "Synthetic lookup error" } : null }) };
    query.select.mockReturnValue(query); query.eq.mockReturnValue(query); queries.set(table, query); return query;
  });
  const rpc = vi.fn(async (name: string) => {
    if (name === "staff_session_status") return { data: options.status === undefined ? managed : options.status, error: options.statusError ?? null };
    if (name === "owner_preview_status") return { data: options.preview ?? null, error: options.previewError ?? null };
    throw new Error(`Unexpected synthetic RPC: ${name}`);
  });
  const getUser = vi.fn().mockResolvedValue({ data: { user: options.user === undefined ? { id: userId, is_anonymous: false } : options.user }, error: options.authError ?? null });
  return { client: { auth: { getUser }, from, rpc } as unknown as SupabaseClient, from, rpc, getUser, queries };
}

describe("adversarial authenticated actor resolution (Mock, no Auth/RLS execution)", () => {
  it.each(["", "not-a-uuid", `${workspaceId}/../owner`, ` ${workspaceId}`, `${workspaceId}\n`])("rejects malformed selection %j before Auth", async (selection) => {
    const mock = resolverClient(); expect(await resolveActorFromAuthenticatedClient(mock.client, selection)).toBeNull();
    expect(mock.getUser).not.toHaveBeenCalled(); expect(mock.from).not.toHaveBeenCalled(); expect(mock.rpc).not.toHaveBeenCalled();
  });

  it.each([{ user: null }, { authError: { name: "SyntheticExpiredSession" } }])("denies missing/failed verified Auth %j before profile reads", async (options) => {
    const mock = resolverClient(options); expect(await resolveActorFromAuthenticatedClient(mock.client, workspaceId)).toBeNull();
    expect(mock.from).not.toHaveBeenCalled(); expect(mock.rpc).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { id: profileId, auth_user_id: userId, platform_role: "ADMIN", active: true },
    { id: profileId, auth_user_id: employeeId, platform_role: "SUPER_ADMIN", active: true },
    { id: profileId, auth_user_id: userId, platform_role: "SUPER_ADMIN", active: "true" },
    { id: profileId, auth_user_id: userId, platform_role: "SUPER_ADMIN", active: false },
  ])("rejects absent, substituted or non-active profiles %j", async (profile) => {
    const mock = resolverClient({ profile }); expect(await resolveActorFromAuthenticatedClient(mock.client, workspaceId)).toBeNull();
  });

  it("ignores user metadata privilege, role, onboarding and session claims", async () => {
    const mock = resolverClient({ user: { id: userId, is_anonymous: false, user_metadata: { platform_role: "SUPER_ADMIN", role: "ADMIN", sessionAllowed: true, passwordChangeRequired: false, session_id: employeeId } } });
    const resolved = await resolveActorFromAuthenticatedClient(mock.client, workspaceId);
    expect(resolved).toMatchObject({ platformRole: "USER", sessionId, staff: { authRevision: revision }, membership: { role: "ADMIN" } });
    expect(hasActorPermission(resolved!, "ai_config:manage")).toBe(false);
    expect(mock.queries.get("profiles")!.eq).toHaveBeenCalledWith("auth_user_id", userId);
    expect(mock.queries.get("workspace_memberships")!.eq.mock.calls).toEqual([["workspace_id", workspaceId], ["profile_id", profileId]]);
  });

  it.each([null, {}, { ...managed, sessionAllowed: "true" }, { ...managed, passwordChangeRequired: "false" },
    { ...managed, sessionId: null }, { ...managed, authRevision: null }, { ...managed, authRevision: "forged" },
    { ...managed, role: "SUPER_ADMIN" }])("fails closed on malformed server session status %j", async (status) => {
    const mock = resolverClient({ status }); expect(await resolveActorFromAuthenticatedClient(mock.client, workspaceId)).toBeNull();
    expect(mock.from.mock.calls).toEqual([["profiles"]]);
  });

  it.each(["profiles", "workspace_memberships", "workspaces"])("propagates %s lookup failure without an actor", async (tableError) => {
    const mock = resolverClient({ tableError }); await expect(resolveActorFromAuthenticatedClient(mock.client, workspaceId)).rejects.toThrow("lookup failed");
  });

  it("cannot downgrade unavailable staff status to an unmanaged account", async () => {
    const mock = resolverClient({ statusError: { message: "Synthetic RPC unavailable" } });
    await expect(resolveActorFromAuthenticatedClient(mock.client, workspaceId)).rejects.toThrow("Actor session lookup failed");
    expect(mock.from.mock.calls).toEqual([["profiles"]]);
  });

  it.each([{ ...managed, sessionAllowed: false }, { ...managed, passwordChangeRequired: true },
    { ...managed, sessionAllowed: false, passwordChangeRequired: true }])("denies revoked/onboarding membership and platform privilege %j", async (status) => {
    const options = { status, profile: { id: profileId, auth_user_id: userId, platform_role: "SUPER_ADMIN", active: true } };
    expect(await resolveActorFromAuthenticatedClient(resolverClient(options).client, workspaceId)).toBeNull();
    const limited = await resolveActorFromAuthenticatedClient(resolverClient(options).client);
    expect(limited).toMatchObject({ businessReady: false, sessionId });
    for (const permission of ["order:view", "order:create", "ai:use", "ai_config:view", "ai_config:manage", "diagnostics:view"] as const) expect(hasActorPermission(limited!, permission)).toBe(false);
  });

  it.each([
    null,
    { profile_id: employeeId, workspace_id: workspaceId, role: "ADMIN", active: true },
    { profile_id: profileId, workspace_id: employeeId, role: "ADMIN", active: true },
    { profile_id: profileId, workspace_id: workspaceId, role: "SUPER_ADMIN", active: true },
    { profile_id: profileId, workspace_id: workspaceId, role: "ADMIN", active: 1 },
  ])("rejects missing/substituted/invalid membership %j", async (membership) => {
    expect(await resolveActorFromAuthenticatedClient(resolverClient({ membership }).client, workspaceId)).toBeNull();
  });

  it.each([null, { id: workspaceId, kind: "PRIVATE", active: true }, { id: workspaceId, kind: "OWNER", active: "true" }])("rejects missing/inactive/unknown workspace %j", async (workspace) => {
    expect(await resolveActorFromAuthenticatedClient(resolverClient({ workspace }).client, workspaceId)).toBeNull();
  });

  it("re-reads current session status on each resolution and rejects a revoked formerly valid actor", async () => {
    const mock = resolverClient(); const first = await resolveActorFromAuthenticatedClient(mock.client, workspaceId);
    expect(first?.businessReady).toBe(true);
    mock.rpc.mockResolvedValueOnce({ data: { ...managed, sessionAllowed: false }, error: null });
    expect(await resolveActorFromAuthenticatedClient(mock.client, workspaceId)).toBeNull();
    expect(mock.rpc).toHaveBeenCalledTimes(2);
  });
});

describe("adversarial role and resource limits (actual policy and services, mocked clients)", () => {
  it.each(["ADMIN", "MANAGER", "TECHNICIAN"] as const)("ordinary %s cannot acquire platform privilege or membership from claims", (role) => {
    const current = actor(role);
    for (const permission of ["ai_config:view", "ai_config:manage", "diagnostics:view"] as const) expect(hasActorPermission(current, permission)).toBe(false);
    expect(hasActorPermission({ ...current, platformRole: "SUPER_ADMIN", membership: undefined }, "order:view")).toBe(false);
    expect(hasActorPermission({ ...current, platformRole: "SUPER_ADMIN", isAnonymous: true }, "ai_config:manage")).toBe(false);
    expect(hasActorPermission({ ...current, isAnonymous: true }, role === "TECHNICIAN" ? "job:view_assigned" : "order:view")).toBe(false);
  });

  it.each(["ADMIN", "MANAGER", "TECHNICIAN"] as const)("Owner privilege cannot expand the %s business role", (role) => {
    const current = { ...actor(role), platformRole: "SUPER_ADMIN" as const };
    const denied = role === "ADMIN" ? ["review:approve", "job:complete_assigned"] as const
      : role === "MANAGER" ? ["order:create", "order:assign", "job:complete_assigned"] as const
        : ["order:view", "order:create", "order:assign", "review:approve", "ai:use"] as const;
    for (const permission of denied) expect(hasActorPermission(current, permission)).toBe(false);
    expect(hasActorPermission(current, "ai_config:manage")).toBe(true);
  });

  it.each(["ADMIN", "MANAGER", "TECHNICIAN"] as const)("read-only %s preview cannot invoke AI or any business mutation permission", (role) => {
    const current: ActorContext = { ...actor(role), platformRole: "SUPER_ADMIN", preview: { readOnly: true, effectiveEmployeeProfileId: role === "TECHNICIAN" ? employeeId : null } };
    for (const permission of ["order:create", "order:assign", "order:update", "order:reschedule", "job:start_assigned", "job:request_reschedule", "job:complete_assigned", "evidence:upload", "payment:record", "review:approve", "ai:use"] as const) expect(hasActorPermission(current, permission)).toBe(false);
    expect(canUseKnowledgeAi(current)).toBe(false); expect(canUseOperationsAi(current)).toBe(false);
    // Platform administration remains a separately authorized Owner capability.
    expect(hasActorPermission(current, "ai_config:manage")).toBe(true);
  });

  it.each(["ADMIN", "MANAGER", "TECHNICIAN"] as const)("not-ready %s cannot open either order read client", async (role) => {
    const from = vi.fn(); const client = { from } as unknown as SupabaseClient;
    const current = { ...actor(role), businessReady: false };
    await expect(listWorkspaceOrders(current, client, workspaceId)).rejects.toThrow("access denied");
    await expect(getWorkspaceOrderById(current, client, workspaceId, orderId)).rejects.toThrow("access denied");
    expect(from).not.toHaveBeenCalled();
  });

  const writes = [
    ["create", "ADMIN", (current: ActorContext, client: SupabaseClient) => createWorkspaceOrder(current, client, { workspaceId, expectedGeneration: 1, orderNo: "SYNTHETIC", branchId: employeeId, customerId: employeeId, problemDescription: "Synthetic issue", serviceType: "Repair" })],
    ["assign", "ADMIN", (current: ActorContext, client: SupabaseClient) => assignWorkspaceOrder(current, client, { workspaceId, expectedGeneration: 1, orderId, technicianId: employeeId, expectedUpdatedAt: timestamp, scheduledAt: null })],
    ["reschedule", "MANAGER", (current: ActorContext, client: SupabaseClient) => rescheduleManagerOrder(current, client, { workspaceId, expectedGeneration: 1, orderId, expectedUpdatedAt: timestamp, scheduledAt: timestamp }, null)],
    ["start job", "TECHNICIAN", (current: ActorContext, client: SupabaseClient) => transitionAssignedJob(current, client, { workspaceId, expectedGeneration: 1, orderId, expectedUpdatedAt: timestamp, nextStatus: "IN_PROGRESS" }, null)],
    ["complete job", "TECHNICIAN", (current: ActorContext, client: SupabaseClient) => transitionAssignedJob(current, client, { workspaceId, expectedGeneration: 1, orderId, expectedUpdatedAt: timestamp, nextStatus: "COMPLETED" }, null)],
    ["prepare proposal", "ADMIN", (current: ActorContext, client: SupabaseClient) => proposeWorkspaceOrderAssignment(current, client, { workspaceId, orderId, technicianId: employeeId, expectedUpdatedAt: timestamp, scheduledAt: null, idempotencyKey: revision })],
    ["approve proposal", "ADMIN", (current: ActorContext, client: SupabaseClient) => approveWorkspaceOrderAssignmentFromWeb(current, client, { workspaceId, proposalId: orderId })],
    ["execute proposal", "ADMIN", (current: ActorContext, client: SupabaseClient) => executeWorkspaceOrderAssignmentProposal(current, client, { workspaceId, proposalId: orderId })],
  ] as const;

  it.each(writes)("%s rejects revoked, wrong workspace, missing membership and preview actors before RPC", async (_name, role, write) => {
    const current = actor(role); const rpc = vi.fn(); const client = { rpc } as unknown as SupabaseClient;
    for (const denied of [
      { ...current, businessReady: false },
      { ...current, membership: { ...current.membership!, workspaceId: employeeId } },
      { ...current, platformRole: "SUPER_ADMIN" as const, membership: undefined },
      { ...current, platformRole: "SUPER_ADMIN" as const, preview: { readOnly: true as const, effectiveEmployeeProfileId: role === "TECHNICIAN" ? employeeId : null } },
    ]) await expect(write(denied, client)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(["list", "exact"])("Technician preview %s mapping error cannot fall back to a broad order query", async (mode) => {
    const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: "Synthetic missing mapping" } }) };
    query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
    const from = vi.fn().mockReturnValue(query); const client = { from } as unknown as SupabaseClient;
    const current: ActorContext = { ...actor("TECHNICIAN"), platformRole: "SUPER_ADMIN", preview: { readOnly: true, effectiveEmployeeProfileId: employeeId } };
    await expect(mode === "list" ? listWorkspaceOrders(current, client, workspaceId) : getWorkspaceOrderById(current, client, workspaceId, orderId)).rejects.toThrow("Technician mapping could not be read");
    expect(from.mock.calls).toEqual([["workspace_technicians"]]);
    expect(query.eq.mock.calls).toEqual([["workspace_id", workspaceId], ["profile_id", employeeId], ["active", true]]);
    expect(current.profileId).toBe(profileId); expect(current.authUserId).toBe(userId);
  });
});
