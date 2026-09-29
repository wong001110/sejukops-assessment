import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/config", () => ({
  getSupabasePublicConfig: () => ({ url: "https://test-ref.supabase.co", anonKey: "public-key" }),
}));

import { resolveMcpWorkspaceActor, verifyMcpBearer } from "./bearer-actor";

const authUserId = "11111111-1111-4111-8111-111111111111";
const sessionId = "77777777-7777-4777-8777-777777777777";
const profileId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "33333333-3333-4333-8333-333333333333";
const otherWorkspaceId = "44444444-4444-4444-8444-444444444444";
const token = "header.payload.signature";
const claims = {
  iss: "https://test-ref.supabase.co/auth/v1", aud: "authenticated",
  exp: Math.floor(Date.now() / 1000) + 3600,
  sub: authUserId, session_id: sessionId, role: "authenticated", is_anonymous: false,
};

function bearerRequest(headers: Record<string, string> = {}) {
  return new Request("https://app.example/api/mcp", {
    headers: { authorization: `Bearer ${token}`, ...headers },
  });
}
function tableQuery(row: unknown) {
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }) };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
  return query;
}

describe("MCP bearer and workspace resolution", () => {
  let verifier: { auth: { getClaims: ReturnType<typeof vi.fn>; getUser: ReturnType<typeof vi.fn> } };
  let service: { rpc: ReturnType<typeof vi.fn> };
  let dataClient: { from: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockReset();
    verifier = { auth: {
      getClaims: vi.fn().mockResolvedValue({ data: { claims }, error: null }),
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: authUserId, is_anonymous: false } }, error: null }),
    } };
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");
    service = { rpc: vi.fn().mockResolvedValue({ data: true, error: null }) };
    dataClient = { from: vi.fn((table: string) => {
      if (table === "profiles") return tableQuery({
        id: profileId, auth_user_id: authUserId, platform_role: "USER", active: true,
      });
      if (table === "workspace_memberships") return tableQuery({
        profile_id: profileId, workspace_id: workspaceId, role: "ADMIN", active: true,
      });
      if (table === "workspaces") return tableQuery({ id: workspaceId, kind: "DEMO", active: true });
      throw new Error("Unexpected table");
    }) };
    mocks.createClient.mockReturnValueOnce(verifier).mockReturnValueOnce(service).mockReturnValueOnce(dataClient);
  });

  it("rejects cookie and malformed bearer without contacting Auth", async () => {
    await expect(verifyMcpBearer(bearerRequest({ cookie: "session=x" }))).rejects.toThrow();
    await expect(verifyMcpBearer(new Request("https://app.example/api/mcp", {
      headers: { authorization: "Bearer malformed" },
    }))).rejects.toThrow();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("rejects expired, wrong-issuer, and wrong-audience claims", async () => {
    for (const override of [
      { exp: 1 }, { iss: "https://other.supabase.co/auth/v1" }, { aud: "anon" },
      { session_id: "invalid" },
    ]) {
      mocks.createClient.mockReset().mockReturnValueOnce(verifier);
      verifier.auth.getClaims.mockResolvedValueOnce({ data: { claims: { ...claims, ...override } }, error: null });
      await expect(verifyMcpBearer(bearerRequest())).rejects.toThrow();
    }
    expect(verifier.auth.getUser).not.toHaveBeenCalled();
  });

  it("rejects an Auth user removed after a JWT was signed", async () => {
    verifier.auth.getUser.mockResolvedValue({ data: { user: null }, error: { code: "user_not_found" } });
    await expect(verifyMcpBearer(bearerRequest())).rejects.toThrow();
  });

  it("accepts an older permanent user record without an anonymous flag", async () => {
    verifier.auth.getUser.mockResolvedValue({ data: { user: { id: authUserId } }, error: null });
    const identity = await verifyMcpBearer(bearerRequest());
    expect(identity.isAnonymous).toBe(false);
  });

  it("rejects a signed JWT after its Auth session was revoked", async () => {
    service.rpc.mockResolvedValueOnce({ data: false, error: null });
    await expect(verifyMcpBearer(bearerRequest())).rejects.toThrow();
    expect(service.rpc).toHaveBeenCalledWith("mcp_session_active", {
      p_auth_user_id: authUserId, p_session_id: sessionId,
    });
    expect(mocks.createClient).toHaveBeenCalledTimes(2);
  });

  it("uses the bearer JWT and current active membership, never caller identity fields", async () => {
    const identity = await verifyMcpBearer(bearerRequest());
    expect(verifier.auth.getClaims).toHaveBeenCalledWith(token);
    expect(verifier.auth.getUser).toHaveBeenCalledWith(token);
    expect(service.rpc).toHaveBeenCalledWith("mcp_session_active", {
      p_auth_user_id: authUserId, p_session_id: sessionId,
    });
    expect(mocks.createClient).toHaveBeenLastCalledWith(
      "https://test-ref.supabase.co", "public-key", expect.objectContaining({ accessToken: expect.any(Function) }),
    );
    const actor = await resolveMcpWorkspaceActor(identity, workspaceId);
    expect(actor.profileId).toBe(profileId);
    expect(actor.membership?.workspaceId).toBe(workspaceId);
    await expect(resolveMcpWorkspaceActor(identity, otherWorkspaceId)).rejects.toThrow();
  });

  it("denies a revoked membership on the next tool call", async () => {
    const identity = await verifyMcpBearer(bearerRequest());
    dataClient.from.mockImplementation((table: string) => {
      if (table === "profiles") return tableQuery({ id: profileId, auth_user_id: authUserId,
        platform_role: "USER", active: true });
      if (table === "workspace_memberships") return tableQuery({ profile_id: profileId,
        workspace_id: workspaceId, role: "ADMIN", active: false });
      return tableQuery({ id: workspaceId, kind: "DEMO", active: true });
    });
    await expect(resolveMcpWorkspaceActor(identity, workspaceId)).rejects.toThrow();
  });
});
