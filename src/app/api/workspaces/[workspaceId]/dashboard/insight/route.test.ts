import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ context: vi.fn(), run: vi.fn(), budget: vi.fn(), reserve: vi.fn(), persist: vi.fn(), cookies: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/auth/workspace-request-context", () => ({ getWorkspaceRequestContext: mocks.context }));
vi.mock("@/lib/ai/runtime/dashboard-insight", () => ({ runDashboardInsight: mocks.run, DashboardInsightAccessError: class extends Error {}, DashboardInsightStaleError: class extends Error {} }));
vi.mock("@/lib/ai/runtime/guest-ai-budget", () => ({ readGuestAiBudget: mocks.budget, reserveGuestAiCall: mocks.reserve }));
vi.mock("@/lib/observability/workspace-ai-store", () => ({ persistWorkspaceAIRecord: mocks.persist }));
import { POST } from "./route";
const workspaceId = "10000000-0000-4000-8000-000000000001";
const id = "10000000-0000-4000-8000-000000000002";
const actor = { profileId: id, authUserId: id, isAnonymous: false, platformRole: "USER", membership: { workspaceId, kind: "DEMO", role: "TECHNICIAN" } };
const context = { params: Promise.resolve({ workspaceId }) };
const request = (origin = "http://localhost", body = { period: "this_week" }) => new Request(`http://localhost/api/workspaces/${workspaceId}/dashboard/insight`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); mocks.context.mockResolvedValue({ actor, client: {}, guestVisit: null }); mocks.budget.mockResolvedValue({ remaining: 5 }); mocks.cookies.mockResolvedValue({ get: () => ({ value: "a".repeat(43) }) }); mocks.run.mockResolvedValue({ highlights: [], period: "this_week", asOf: new Date().toISOString(), generation: 1, usage: {} }); });
describe("dashboard insight route", () => {
  it("allows ready technician aggregate insight without native access", async () => {
    const response = await POST(request(), context); expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.run).toHaveBeenCalledWith(actor, {}, { workspaceId, period: "this_week" }, expect.objectContaining({ abortSignal: expect.any(AbortSignal) }));
  });
  it("denies cross-origin, forged identity/input, preview and inactive actors before AI", async () => {
    expect((await POST(request("https://foreign.invalid"), context)).status).toBe(403);
    expect((await POST(request("http://localhost", { period: "invalid" }), context)).status).toBe(400);
    for (const invalid of [{ ...actor, businessReady: false }, { ...actor, preview: { readOnly: true } }, { ...actor, membership: { ...actor.membership, workspaceId: "other" } }]) {
      mocks.context.mockResolvedValue({ actor: invalid, client: {}, guestVisit: null });
      expect((await POST(request(), context)).status).toBe(403);
    }
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("exhausted Guest consumes no provider reservation", async () => {
    mocks.context.mockResolvedValue({ actor, client: {}, guestVisit: { id, demoGeneration: 1 } }); mocks.budget.mockResolvedValue({ remaining: 0, resetAt: "2026-10-06T00:00:00+08:00" });
    expect((await POST(request(), context)).status).toBe(429); expect(mocks.run).not.toHaveBeenCalled(); expect(mocks.reserve).not.toHaveBeenCalled();
  });
  it("reserves exactly once in the callback and refuses exhausted reservations", async () => {
    mocks.context.mockResolvedValue({ actor, client: {}, guestVisit: { id, demoGeneration: 1 } }); mocks.reserve.mockResolvedValue({ allowed: false });
    mocks.run.mockImplementation(async (_actor, _client, _input, options) => { await options.beforeProviderCall(); throw new Error("must not call model"); });
    expect((await POST(request(), context)).status).toBe(429); expect(mocks.reserve).toHaveBeenCalledOnce();
  });
});
