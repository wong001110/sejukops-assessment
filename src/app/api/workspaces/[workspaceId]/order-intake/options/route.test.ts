import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getWorkspaceRequestContext: vi.fn(), readWorkspaceGeneration: vi.fn(),
}));
vi.mock("@/lib/auth/workspace-request-context", () => ({ getWorkspaceRequestContext: mocks.getWorkspaceRequestContext }));
vi.mock("@/lib/services/workspaces/generation", () => ({ readWorkspaceGeneration: mocks.readWorkspaceGeneration }));

import { GET } from "./route";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const context = { params: Promise.resolve({ workspaceId }) };
const request = new Request("https://example.test/options");

describe("order intake option read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readWorkspaceGeneration.mockResolvedValue(2);
    const query = { eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }) };
    mocks.getWorkspaceRequestContext.mockResolvedValue({
      actor: { isAnonymous: false, platformRole: "USER", membership: { workspaceId, kind: "OWNER", role: "ADMIN" } },
      client: { from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(query) }) }, guestVisit: null,
    });
  });
  it("rejects wrong workspace and Technician before any database read", async () => {
    mocks.getWorkspaceRequestContext.mockResolvedValueOnce({ actor: { isAnonymous: false, platformRole: "USER",
      membership: { workspaceId: "22222222-2222-4222-8222-222222222222", kind: "OWNER", role: "ADMIN" } },
    client: { from: vi.fn() }, guestVisit: null });
    expect((await GET(request, context)).status).toBe(403);
    mocks.getWorkspaceRequestContext.mockResolvedValueOnce({ actor: { isAnonymous: false, platformRole: "USER",
      membership: { workspaceId, kind: "OWNER", role: "TECHNICIAN" } }, client: { from: vi.fn() }, guestVisit: null });
    expect((await GET(request, context)).status).toBe(403);
    expect(mocks.readWorkspaceGeneration).not.toHaveBeenCalled();
  });
  it("returns bounded option lists and current generation", async () => {
    const response = await GET(request, context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ generation: 2, branches: [], customers: [] });
  });
});
