import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  verifyMcpBearer: vi.fn(),
  resolveMcpWorkspaceActor: vi.fn(),
  readRecentWorkspaceOrders: vi.fn(),
  searchWorkspaceKnowledge: vi.fn(),
  inspectWorkspaceOrderAssignmentProposal: vi.fn(),
  proposeWorkspaceOrderAssignmentFromMcp: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/config", () => ({
  getSupabasePublicConfig: () => ({ url: "https://test-ref.supabase.co", anonKey: "public-key" }),
}));
vi.mock("@/lib/mcp/bearer-actor", () => ({
  verifyMcpBearer: mocks.verifyMcpBearer,
  resolveMcpWorkspaceActor: mocks.resolveMcpWorkspaceActor,
}));
vi.mock("@/lib/capabilities/recent-orders", () => ({ readRecentWorkspaceOrders: mocks.readRecentWorkspaceOrders }));
vi.mock("@/lib/services/workspace-knowledge/service", () => ({ searchWorkspaceKnowledge: mocks.searchWorkspaceKnowledge }));
vi.mock("@/lib/services/workspace-orders/assignment-proposals", () => ({
  inspectWorkspaceOrderAssignmentProposal: mocks.inspectWorkspaceOrderAssignmentProposal,
  proposeWorkspaceOrderAssignmentFromMcp: mocks.proposeWorkspaceOrderAssignmentFromMcp,
}));

import { DELETE, GET, POST } from "./route";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const otherWorkspace = "22222222-2222-4222-8222-222222222222";
const url = new URL("https://app.example/api/mcp");
const identity = { authUserId: "33333333-3333-4333-8333-333333333333", isAnonymous: false,
  client: { from: vi.fn() } };
const actor = { profileId: "44444444-4444-4444-8444-444444444444",
  membership: { workspaceId, kind: "OWNER", role: "ADMIN" } };

describe("MCP Streamable HTTP endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("MCP_EXTERNAL_ENABLED", "true");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");
    mocks.createClient.mockReturnValue({ rpc: vi.fn() });
    mocks.verifyMcpBearer.mockResolvedValue(identity);
    mocks.resolveMcpWorkspaceActor.mockImplementation(async (_identity, requested) => {
      if (requested !== workspaceId) throw new Error("Forbidden");
      return actor;
    });
    mocks.readRecentWorkspaceOrders.mockResolvedValue({ workspaceId, orders: [{ id: "safe-order" }] });
    mocks.searchWorkspaceKnowledge.mockResolvedValue([]);
    mocks.inspectWorkspaceOrderAssignmentProposal.mockResolvedValue({ status: "PENDING" });
    mocks.proposeWorkspaceOrderAssignmentFromMcp.mockResolvedValue({
      id: "55555555-5555-4555-8555-555555555555",
      workspaceId, status: "PENDING",
      canonicalPayload: { orderId: "66666666-6666-4666-8666-666666666666",
        technicianId: "77777777-7777-4777-8777-777777777777", scheduledAt: null },
    });
  });

  it("keeps external MCP unavailable by default during the website MVP", async () => {
    vi.stubEnv("MCP_EXTERNAL_ENABLED", "");
    const result = await POST(new Request(url, { method: "POST", body: "{}" }));
    expect(result.status).toBe(404);
    expect(mocks.verifyMcpBearer).not.toHaveBeenCalled();
  });

  it("denies missing bearer and browser cookies before protocol handling", async () => {
    mocks.verifyMcpBearer.mockRejectedValue(new Error("Unauthenticated"));
    const unauth = await POST(new Request(url, { method: "POST", body: "{}" }));
    expect(unauth.status).toBe(401);
    expect(unauth.headers.get("WWW-Authenticate")).toContain("Bearer");
    expect(mocks.readRecentWorkspaceOrders).not.toHaveBeenCalled();
  });

  it("rejects cross-origin and mismatched host before Auth", async () => {
    const wrongOrigin = await POST(new Request(url, {
      method: "POST", headers: { origin: "https://attacker.example" }, body: "{}",
    }));
    expect(wrongOrigin.status).toBe(403);
    const wrongHost = await POST(new Request(url, {
      method: "POST", headers: { host: "attacker.example" }, body: "{}",
    }));
    expect(wrongHost.status).toBe(403);
    expect(mocks.verifyMcpBearer).not.toHaveBeenCalled();
  });

  it("accepts the inbound Host when Next normalizes Request.url to localhost", async () => {
    const request = new Request("http://localhost:3100/api/mcp", { method: "POST",
      headers: { host: "127.0.0.1:3100", origin: "http://127.0.0.1:3100",
        "x-forwarded-proto": "http", "content-type": "application/json" }, body: "{}" });
    const result = await POST(request);
    expect(result.status).not.toBe(403);
    expect(mocks.verifyMcpBearer).toHaveBeenCalledOnce();
  });

  it("uses the real v2 SDK client for scoped reads and a proposal-only write", async () => {
    const transport = new StreamableHTTPClientTransport(url, {
      authProvider: { token: async () => "fixture-token" },
      fetch: async (input, init) => {
        const request = new Request(input, init);
        if (request.method === "GET") return GET(request);
        if (request.method === "DELETE") return DELETE(request);
        return POST(request);
      },
    });
    const client = new Client({ name: "p5-test-client", version: "0.1.0" });
    await client.connect(transport);
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
      "assignment_propose", "knowledge_search", "proposal_inspect", "recent_orders",
    ]);
    const recent = await client.callTool({ name: "recent_orders", arguments: { workspaceId, limit: 5 } });
    expect(recent.content).toContainEqual(expect.objectContaining({
      type: "text", text: JSON.stringify({ workspaceId, orders: [{ id: "safe-order" }] }),
    }));
    expect(mocks.readRecentWorkspaceOrders).toHaveBeenCalledWith(actor, identity.client,
      { workspaceId, limit: 5 });
    const knowledge = await client.callTool({ name: "knowledge_search", arguments: {
      workspaceId, query: "compressor", limit: 3,
    } });
    expect(knowledge.isError).not.toBe(true);
    expect(mocks.searchWorkspaceKnowledge).toHaveBeenCalledWith(actor, identity.client,
      { workspaceId, query: "compressor", limit: 3 });
    const proposalId = "55555555-5555-4555-8555-555555555555";
    const inspected = await client.callTool({ name: "proposal_inspect", arguments: { workspaceId, proposalId } });
    expect(inspected.isError).not.toBe(true);
    expect(mocks.inspectWorkspaceOrderAssignmentProposal).toHaveBeenCalledWith(actor, identity.client,
      { workspaceId, proposalId });
    const prepared = await client.callTool({ name: "assignment_propose", arguments: {
      workspaceId,
      orderId: "66666666-6666-4666-8666-666666666666",
      technicianId: "77777777-7777-4777-8777-777777777777",
      expectedUpdatedAt: "2026-09-28T12:00:00Z",
      scheduledAt: null,
      idempotencyKey: "88888888-8888-4888-8888-888888888888",
    } });
    expect(prepared.isError).not.toBe(true);
    expect(prepared.content).toContainEqual(expect.objectContaining({
      type: "text", text: expect.stringContaining('"requiresWebConfirmation":true'),
    }));
    expect(prepared.content).toContainEqual(expect.objectContaining({
      text: expect.stringContaining(`/workspaces/${workspaceId}/assignment?proposalId=${proposalId}`),
    }));
    expect(mocks.createClient).toHaveBeenCalledWith("https://test-ref.supabase.co", "test-service-role-key",
      { auth: { persistSession: false, autoRefreshToken: false } });
    expect(mocks.proposeWorkspaceOrderAssignmentFromMcp).toHaveBeenCalledWith(actor, expect.anything(),
      expect.objectContaining({ workspaceId, idempotencyKey: "88888888-8888-4888-8888-888888888888" }));
    await expect(client.callTool({ name: "assignment_approve", arguments: {
      workspaceId, proposalId, approved: true,
    } })).rejects.toThrow("Tool assignment_approve not found");
    const fakeHuman = await client.callTool({ name: "assignment_propose", arguments: {
      workspaceId,
      orderId: "66666666-6666-4666-8666-666666666666",
      technicianId: "77777777-7777-4777-8777-777777777777",
      expectedUpdatedAt: "2026-09-28T12:00:00Z",
      scheduledAt: null,
      idempotencyKey: "88888888-8888-4888-8888-888888888888",
      approved: true,
    } });
    expect(fakeHuman.isError).toBe(true);
    expect(mocks.proposeWorkspaceOrderAssignmentFromMcp).toHaveBeenCalledTimes(1);
    const cross = await client.callTool({ name: "recent_orders", arguments: { workspaceId: otherWorkspace } });
    expect(cross.isError).toBe(true);
    const spoofed = await client.callTool({ name: "recent_orders", arguments: {
      workspaceId, actorAuthUserId: "66666666-6666-4666-8666-666666666666",
    } });
    expect(spoofed.isError).toBe(true);
    expect(mocks.readRecentWorkspaceOrders).toHaveBeenCalledTimes(1);
    const wrongWorkspaceProposal = await client.callTool({ name: "assignment_propose", arguments: {
      workspaceId: otherWorkspace,
      orderId: "66666666-6666-4666-8666-666666666666",
      technicianId: "77777777-7777-4777-8777-777777777777",
      expectedUpdatedAt: "2026-09-28T12:00:00Z",
      scheduledAt: null,
      idempotencyKey: "88888888-8888-4888-8888-888888888888",
    } });
    expect(wrongWorkspaceProposal.isError).toBe(true);
    expect(mocks.proposeWorkspaceOrderAssignmentFromMcp).toHaveBeenCalledTimes(1);
    await client.close();
  });

  it("does not construct a privileged client when membership is denied", async () => {
    mocks.resolveMcpWorkspaceActor.mockRejectedValue(new Error("Revoked"));
    const transport = new StreamableHTTPClientTransport(url, {
      authProvider: { token: async () => "fixture-token" },
      fetch: async (input, init) => POST(new Request(input, init)),
    });
    const client = new Client({ name: "p5-denied-client", version: "0.1.0" });
    await client.connect(transport);
    const denied = await client.callTool({ name: "assignment_propose", arguments: {
      workspaceId,
      orderId: "66666666-6666-4666-8666-666666666666",
      technicianId: "77777777-7777-4777-8777-777777777777",
      expectedUpdatedAt: "2026-09-28T12:00:00Z", scheduledAt: null,
      idempotencyKey: "88888888-8888-4888-8888-888888888888",
    } });
    expect(denied.isError).toBe(true);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.proposeWorkspaceOrderAssignmentFromMcp).not.toHaveBeenCalled();
    await client.close();
  });
});
