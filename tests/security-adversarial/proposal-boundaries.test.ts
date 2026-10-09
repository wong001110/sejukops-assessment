import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActorContext } from "@/lib/auth/actor-policy";

// Real handlers, HMAC preview and domain adapters; only identity and database transports are mocked.
// RPC return states are contract fixtures, not a PostgreSQL transaction/concurrency simulation.
const transport = vi.hoisted(() => ({ actor: vi.fn(), session: vi.fn(), privileged: vi.fn() }));
vi.mock("@/lib/auth/server-actor", () => ({ getServerActorContext: transport.actor }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: transport.session }));
vi.mock("@/lib/supabase/config", () => ({ getSupabasePublicConfig: () => ({ url: "https://fictional.invalid" }) }));
vi.mock("@supabase/supabase-js", () => ({ createClient: transport.privileged }));

import { GET, POST } from "@/app/api/workspaces/[workspaceId]/assignment-proposals/[proposalId]/route";

const ids = {
  workspace: "11111111-1111-4111-8111-111111111111",
  proposal: "22222222-2222-4222-8222-222222222222",
  profile: "33333333-3333-4333-8333-333333333333",
  auth: "44444444-4444-4444-8444-444444444444",
  order: "55555555-5555-4555-8555-555555555555",
  technician: "66666666-6666-4666-8666-666666666666",
  other: "77777777-7777-4777-8777-777777777777",
  session: "88888888-8888-4888-8888-888888888888",
};
const actor: ActorContext = {
  authUserId: ids.auth, profileId: ids.profile, isAnonymous: false, platformRole: "USER",
  sessionId: ids.session, businessReady: true,
  membership: { workspaceId: ids.workspace, kind: "OWNER", role: "ADMIN" },
};
function initialRow() {
  return {
    id: ids.proposal, workspace_id: ids.workspace, initiated_by_profile_id: ids.profile,
    approver_profile_id: null as string | null, status: "PENDING",
    canonical_payload: { orderId: ids.order, technicianId: ids.technician, scheduledAt: null as string | null },
    target_updated_at: "2026-10-09T00:00:00.123456+00:00", dataset_generation: 7,
    expires_at: "2026-10-09T00:15:00+00:00", result_order_updated_at: null as string | null,
  };
}
type Row = ReturnType<typeof initialRow>;
let row: Row;
const approvalRpc = vi.fn();
const executionRpc = vi.fn();
const query = { eq: vi.fn(), maybeSingle: vi.fn() };
const url = `http://localhost/api/workspaces/${ids.workspace}/assignment-proposals/${ids.proposal}`;
const context = { params: Promise.resolve({ workspaceId: ids.workspace, proposalId: ids.proposal }) };
const session = { from: vi.fn(), rpc: executionRpc };
function confirm(previewToken: string, extra: Record<string, unknown> = {}) {
  return POST(new Request(url, { method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json" },
    body: JSON.stringify({ confirm: true, previewToken, ...extra }) }), context);
}
async function preview() {
  const response = await GET(new Request(url), context);
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  return (await response.json()).previewToken as string;
}
function expectNoWrite() {
  expect(transport.privileged).not.toHaveBeenCalled();
  expect(approvalRpc).not.toHaveBeenCalled();
  expect(executionRpc).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-09T00:05:00Z"));
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fictional-offline-signing-key");
  row = initialRow();
  transport.actor.mockResolvedValue(actor);
  query.eq.mockReturnValue(query);
  query.maybeSingle.mockImplementation(async () => ({ data: structuredClone(row), error: null }));
  session.from.mockReturnValue({ select: vi.fn().mockReturnValue(query) });
  transport.session.mockResolvedValue(session);
  transport.privileged.mockReturnValue({ rpc: approvalRpc });
  approvalRpc.mockImplementation(async () => ({ data: { ...row, status: "APPROVED", approver_profile_id: ids.profile }, error: null }));
  executionRpc.mockImplementation(async () => ({ data: { ...row, status: "EXECUTED", approver_profile_id: ids.profile,
    result_order_updated_at: "2026-10-09T00:05:01+00:00" }, error: null }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("saved proposal adversarial confirmation through real adapters", () => {
  it.each([
    ["order", (r: Row) => { r.canonical_payload.orderId = ids.other; }],
    ["technician", (r: Row) => { r.canonical_payload.technicianId = ids.other; }],
    ["schedule", (r: Row) => { r.canonical_payload.scheduledAt = "2026-10-10T01:00:00Z"; }],
    ["order version", (r: Row) => { r.target_updated_at = "2026-10-09T00:01:00.000001Z"; }],
    ["dataset generation", (r: Row) => { r.dataset_generation += 1; }],
    ["expiry", (r: Row) => { r.expires_at = "2026-10-09T00:16:00Z"; }],
  ] as const)("rejects a saved %s change after preview", async (_name, change) => {
    const token = await preview();
    change(row);
    expect((await confirm(token)).status).toBe(403);
    expectNoWrite();
  });

  it.each([
    ["lost login", null],
    ["role revoked", { ...actor, membership: { ...actor.membership!, role: "MANAGER" } }],
    ["onboarding or revoked session", { ...actor, businessReady: false }],
    ["Owner preview", { ...actor, preview: { readOnly: true, effectiveEmployeeProfileId: null } }],
    ["foreign workspace", { ...actor, membership: { ...actor.membership!, workspaceId: ids.other } }],
    ["foreign initiator", { ...actor, profileId: ids.other }],
    ["foreign Auth identity", { ...actor, authUserId: ids.other }],
  ] as const)("rechecks %s before confirmation", async (_name, changedActor) => {
    const token = await preview();
    transport.actor.mockResolvedValue(changedActor);
    expect((await confirm(token)).status).toBe(403);
    expectNoWrite();
  });

  it("rejects a proposal approved by a different profile", async () => {
    const token = await preview();
    row.status = "APPROVED";
    row.approver_profile_id = ids.other;
    expect((await confirm(token)).status).toBe(403);
    expectNoWrite();
  });

  it.each(["STALE", "EXPIRED"])("rejects stored %s state without RPC", async (status) => {
    const token = await preview();
    row.status = status;
    expect((await confirm(token)).status).toBe(409);
    expectNoWrite();
  });

  it("rejects expiry exactly at the current clock boundary", async () => {
    const token = await preview();
    vi.mocked(Date.now).mockReturnValue(Date.parse(row.expires_at));
    expect((await confirm(token)).status).toBe(409);
    expectNoWrite();
  });

  it.each(["STALE", "EXPIRED"])("does not execute after approval RPC returns %s", async (status) => {
    const token = await preview();
    approvalRpc.mockResolvedValue({ data: { ...row, status }, error: null });
    const response = await confirm(token);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ proposal: { status } });
    expect(approvalRpc).toHaveBeenCalledExactlyOnceWith("workspace_assignment_proposal_approve", {
      p_workspace_id: ids.workspace, p_proposal_id: ids.proposal,
      p_approver_auth_user_id: ids.auth, p_actor_session_id: ids.session,
    });
    expect(executionRpc).not.toHaveBeenCalled();
  });

  it.each(["STALE", "EXPIRED"])("reports %s from fresh execution RPC for a saved approved proposal", async (status) => {
    row.status = "APPROVED";
    row.approver_profile_id = ids.profile;
    const token = await preview();
    executionRpc.mockResolvedValue({ data: { ...row, status }, error: null });
    const response = await confirm(token);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ proposal: { status } });
    expect(transport.privileged).not.toHaveBeenCalled();
    expect(executionRpc).toHaveBeenCalledExactlyOnceWith("workspace_assignment_proposal_execute", {
      p_workspace_id: ids.workspace, p_proposal_id: ids.proposal,
    });
  });

  it("returns an already executed outcome on replay without a second RPC", async () => {
    const token = await preview();
    row.status = "EXECUTED";
    row.approver_profile_id = ids.profile;
    row.result_order_updated_at = "2026-10-09T00:05:01Z";
    // Executed proposals may be inspected after their original expiry.
    vi.mocked(Date.now).mockReturnValue(Date.parse("2026-10-09T01:00:00Z"));
    const response = await confirm(token);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ proposal: { status: "EXECUTED", resultOrderUpdatedAt: row.result_order_updated_at } });
    expectNoWrite();
  });

  it("stops at a database session rejection before execution", async () => {
    const token = await preview();
    approvalRpc.mockResolvedValue({ data: null, error: { code: "42501", message: "fictional revoked session" } });
    const response = await confirm(token);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Proposal rejected" });
    expect(executionRpc).not.toHaveBeenCalled();
  });

  it("does not report success if current execution fails after approval", async () => {
    const token = await preview();
    executionRpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "fictional target changed" } });
    const response = await confirm(token);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Proposal rejected" });
    expect(approvalRpc).toHaveBeenCalledOnce();
    expect(executionRpc).toHaveBeenCalledOnce();
  });

  it("uses the freshly resolved session for same-user confirmation", async () => {
    const token = await preview();
    // The HMAC is identity-bound, not session-bound; current session readiness belongs to Auth/SQL.
    transport.actor.mockResolvedValue({ ...actor, sessionId: ids.other });
    expect((await confirm(token)).status).toBe(200);
    expect(approvalRpc).toHaveBeenCalledExactlyOnceWith("workspace_assignment_proposal_approve", {
      p_workspace_id: ids.workspace, p_proposal_id: ids.proposal,
      p_approver_auth_user_id: ids.auth, p_actor_session_id: ids.other,
    });
    expect(executionRpc).toHaveBeenCalledExactlyOnceWith("workspace_assignment_proposal_execute", {
      p_workspace_id: ids.workspace, p_proposal_id: ids.proposal,
    });
  });

  it.each(["canonicalPayload", "approverProfileId", "workspaceId", "sessionId"])("rejects body substitution of %s", async (field) => {
    const token = await preview();
    expect((await confirm(token, { [field]: ids.other })).status).toBe(400);
    expectNoWrite();
  });
});
