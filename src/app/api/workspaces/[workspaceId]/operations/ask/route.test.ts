import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActorContext } from "@/lib/auth/actor-policy";
import type { runOperationsAsk } from "@/lib/ai/runtime/operations-ask";
const mocks = vi.hoisted(() => ({ context: vi.fn(), run: vi.fn(), fresh: vi.fn(), generation: vi.fn(), budget: vi.fn(), reserve: vi.fn(), observe: vi.fn(), cookies: vi.fn(), visit: vi.fn(), service: vi.fn() }));
vi.mock("@/lib/auth/workspace-request-context", () => ({ getWorkspaceRequestContext: mocks.context }));
vi.mock("@/lib/auth/server-actor", () => ({ resolveActorFromAuthenticatedClient: mocks.fresh }));
vi.mock("@/lib/auth/guest-session", () => ({ GUEST_COOKIE_NAME: "guest", createGuestServiceClient: mocks.service, resolveGuestVisit: mocks.visit }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/services/workspaces/generation", () => ({ readWorkspaceGeneration: mocks.generation }));
vi.mock("@/lib/ai/runtime/guest-ai-budget", () => ({ readGuestAiBudget: mocks.budget, reserveGuestAiCall: mocks.reserve }));
vi.mock("@/lib/observability/workspace-ai-store", () => ({ persistWorkspaceAIRecord: mocks.observe }));
vi.mock("@/lib/ai/runtime/operations-ask", async (original) => ({ ...await original<typeof import("@/lib/ai/runtime/operations-ask")>(), runOperationsAsk: mocks.run }));
import { POST } from "./route";
import { OperationsAskError } from "@/lib/ai/runtime/operations-ask";
const workspaceId = "11111111-1111-4111-8111-111111111111", otherId = "22222222-2222-4222-8222-222222222222";
const actor: ActorContext = { authUserId: otherId, profileId: otherId, isAnonymous: false, platformRole: "USER", membership: { workspaceId, kind: "DEMO", role: "TECHNICIAN" }, sessionId: "session1", staff: { authRevision: "r1", passwordChangeRequired: false, sessionAllowed: true } };
const guest = { id: otherId, workspaceId, persona: "TECHNICIAN", demoGeneration: 1, expiresAt: "2027-01-01T00:00:00Z" };
const params = { params: Promise.resolve({ workspaceId }) };
const result = { status: "INSUFFICIENT", answer: "No verified matches", orders: [], excerpts: [], activity: [], providerSteps: 2, usage: { inputTokens: 1 } };
function request(body: unknown = { question: "Show my jobs and filter knowledge" }, origin = "http://localhost", signal?: AbortSignal) { return new Request(`http://localhost/api/workspaces/${workspaceId}/operations/ask`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body), signal }); }
type Options = Parameters<typeof runOperationsAsk>[3];
describe("Operations unified ask route", () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => {
    vi.resetAllMocks(); mocks.context.mockResolvedValue({ actor, client: {}, guestVisit: guest }); mocks.fresh.mockResolvedValue(actor);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.generation.mockResolvedValue(1); mocks.budget.mockResolvedValue({ remaining: 20 }); mocks.reserve.mockResolvedValue({ allowed: true });
    mocks.cookies.mockResolvedValue({ get: () => ({ value: "test-token" }) }); mocks.service.mockReturnValue({}); mocks.visit.mockResolvedValue(guest);
    mocks.run.mockImplementation(async (_actor, _client, _input, options: Options) => {
      await options.revalidateScope(); await options.beforeProviderCall?.(); options.onProviderStepStart?.();
      await options.revalidateScope(); await options.beforeProviderCall?.(); options.onProviderStepStart?.(); return result;
    });
  });
  it("logs only an allowlisted final-selection enum without exposing provider/source error details", async () => {
    const failure = new OperationsAskError("UNAVAILABLE", "INVALID_EXCERPT");
    Object.assign(failure, { message: "private-source and provider-secret", cause: new Error("raw provider payload") });
    mocks.run.mockRejectedValue(failure);
    const response = await POST(request(), params), body = await response.json();
    expect(response.status).toBe(503); expect(console.warn).toHaveBeenCalledWith("OPERATIONS_ASK_FAILURE", "INVALID_EXCERPT");
    const output = JSON.stringify({ logs: vi.mocked(console.warn).mock.calls, observations: mocks.observe.mock.calls, body });
    expect(output).not.toContain("private-source"); expect(output).not.toContain("provider-secret"); expect(output).not.toContain("raw provider payload");
    expect(body).not.toHaveProperty("reason");
  });
  it("rejects unexpected reason values at the technical logging boundary", async () => {
    const failure = new OperationsAskError("UNAVAILABLE"); Object.assign(failure, { reason: "provider-secret" });
    mocks.run.mockRejectedValue(failure); expect((await POST(request(), params)).status).toBe(503);
    expect(console.warn).toHaveBeenCalledWith("OPERATIONS_ASK_FAILURE", "UNEXPECTED_FAILURE");
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("provider-secret");
  });
  it("uses fixed caller scope and reserves each Guest provider call with safe no-store observations", async () => {
    const response = await POST(request(), params); expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ status: "INSUFFICIENT", orders: [], excerpts: [] });
    expect(mocks.reserve).toHaveBeenCalledTimes(2); expect(mocks.fresh.mock.calls.length).toBeGreaterThan(3);
    expect(JSON.stringify(mocks.observe.mock.calls)).not.toContain("filter knowledge");
  });
  it.each(["actor", "visit", "generation"])("settles all parallel fresh reads after %s failure and denies runtime/source work", async (failure) => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    mocks.generation.mockReset().mockResolvedValueOnce(1).mockResolvedValue(1);
    if (failure === "actor") {
      mocks.fresh.mockRejectedValueOnce(new Error("actor read unavailable"));
      mocks.generation.mockReset().mockResolvedValueOnce(1).mockImplementationOnce(async () => { await blocked; return 1; });
    } else if (failure === "visit") {
      mocks.visit.mockRejectedValueOnce(new Error("visit read unavailable"));
      mocks.fresh.mockImplementationOnce(async () => { await blocked; return actor; });
    } else {
      mocks.generation.mockReset().mockResolvedValueOnce(1).mockRejectedValueOnce(new Error("generation read unavailable"));
      mocks.visit.mockImplementationOnce(async () => { await blocked; return guest; });
    }
    let finished = false;
    const pending = POST(request(), params).then((response) => { finished = true; return response; });
    await vi.waitFor(() => { expect(mocks.fresh).toHaveBeenCalledOnce(); expect(mocks.visit).toHaveBeenCalledOnce(); expect(mocks.generation).toHaveBeenCalledTimes(2); });
    expect(finished).toBe(false); expect(mocks.run).not.toHaveBeenCalled(); expect(mocks.reserve).not.toHaveBeenCalled();
    release(); expect((await pending).status).toBe(503); expect(mocks.run).not.toHaveBeenCalled();
  });
  it("returns the freshly read generation through the scope callback contract", async () => {
    mocks.run.mockImplementation(async (_a, _c, _i, options: Options) => {
      expect(await options.revalidateScope()).toBe(1); return result;
    });
    expect((await POST(request(), params)).status).toBe(200);
  });
  it.each([[{ question: "Hi", workspaceId: otherId }, "http://localhost", 400], [{ question: "Hi", role: "ADMIN" }, "http://localhost", 400], [{ question: "x".repeat(121) }, "http://localhost", 400], [{ question: "Hi" }, "https://attacker.example", 403]])("denies forged fields, length and origin before scope/runtime", async (body, origin, status) => {
    expect((await POST(request(body, origin as string), params)).status).toBe(status); expect(mocks.context).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled();
  });
  it.each([null, { actor: { ...actor, businessReady: false }, client: {}, guestVisit: guest }, { actor: { ...actor, preview: { readOnly: true, effectiveEmployeeProfileId: otherId } }, client: {}, guestVisit: guest }, { actor: { ...actor, membership: { ...actor.membership, workspaceId: otherId } }, client: {}, guestVisit: guest }, { actor: { ...actor, isAnonymous: true }, client: {}, guestVisit: null }])("denies initial invalid or incomplete session %o", async (scope) => {
    mocks.context.mockResolvedValue(scope); expect((await POST(request(), params)).status).toBe(403); expect(mocks.run).not.toHaveBeenCalled();
  });
  it.each(["role", "profile", "session", "revision", "onboarding", "preview"])("freshly denies changed %s before a second provider step", async (change) => {
    mocks.run.mockImplementation(async (_a, _c, _i, options: Options) => {
      await options.beforeProviderCall!(); options.onProviderStepStart?.();
      const updated: ActorContext = change === "role" ? { ...actor, membership: { ...actor.membership!, role: "ADMIN" } }
        : change === "profile" ? { ...actor, profileId: workspaceId } : change === "session" ? { ...actor, sessionId: "session2" }
        : change === "revision" ? { ...actor, staff: { ...actor.staff!, authRevision: "r2" } }
        : change === "preview" ? { ...actor, preview: { readOnly: true, effectiveEmployeeProfileId: otherId } } : { ...actor, businessReady: false };
      mocks.fresh.mockResolvedValue(updated); await options.beforeProviderCall!(); return result;
    });
    expect((await POST(request(), params)).status).toBe(403); expect(mocks.reserve).toHaveBeenCalledTimes(1);
  });
  it.each(["expired", "revoked", "persona", "generation"])("freshly rejects changed Guest %s", async (change) => {
    mocks.run.mockImplementation(async (_a, _c, _i, options: Options) => {
      await options.beforeProviderCall!();
      mocks.visit.mockResolvedValue(change === "persona" ? { ...guest, persona: "ADMIN" } : change === "generation" ? { ...guest, demoGeneration: 2 } : null);
      await options.beforeProviderCall!(); return result;
    });
    expect((await POST(request(), params)).status).toBe(409); expect(mocks.reserve).toHaveBeenCalledTimes(1);
  });
  it("rejects generation reset during processing", async () => {
    mocks.run.mockImplementation(async (_a, _c, _i, options: Options) => { mocks.generation.mockResolvedValue(2); await options.revalidateScope(); return result; });
    expect((await POST(request(), params)).status).toBe(409);
  });
  it("rejects initial and second-step exhaustion without treating it as an empty answer", async () => {
    mocks.budget.mockResolvedValueOnce({ remaining: 0 }); expect((await POST(request(), params)).status).toBe(429); expect(mocks.run).not.toHaveBeenCalled();
    mocks.budget.mockResolvedValue({ remaining: 20 }); mocks.reserve.mockResolvedValueOnce({ allowed: true }).mockResolvedValueOnce({ allowed: false });
    expect((await POST(request(), params)).status).toBe(429); expect(mocks.reserve).toHaveBeenCalledTimes(2);
  });
  it("bounds hung telemetry locally and still returns the result", async () => {
    mocks.observe.mockImplementation(() => new Promise(() => {})); const start = performance.now();
    expect((await POST(request(), params)).status).toBe(200); expect(performance.now() - start).toBeLessThan(2_000);
  });
  it("cancels a hung uncached actor lookup before calling runtime", async () => {
    const controller = new AbortController(); mocks.fresh.mockImplementation(() => new Promise(() => {}));
    const pending = POST(request(undefined, undefined, controller.signal), params);
    await vi.waitFor(() => expect(mocks.fresh).toHaveBeenCalled()); controller.abort();
    expect((await pending).status).toBe(503); expect(mocks.run).not.toHaveBeenCalled();
  });
});
