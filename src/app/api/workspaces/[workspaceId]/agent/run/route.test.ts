import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NativeAgentOptions } from "@/lib/ai/runtime/workspace-native-agent";
const mocks = vi.hoisted(() => ({ context: vi.fn(), run: vi.fn(), freshActor: vi.fn(), generation: vi.fn(),
  budget: vi.fn(), reserve: vi.fn(), observe: vi.fn(), cookies: vi.fn(), visit: vi.fn(), service: vi.fn(), begin: vi.fn(), finish: vi.fn() }));
vi.mock("@/lib/services/ai-sessions/service", async original => ({ ...await original<typeof import("@/lib/services/ai-sessions/service")>(), beginAiSessionTurn: mocks.begin, finishAiSessionTurn: mocks.finish }));
vi.mock("@/lib/auth/workspace-request-context", () => ({ getWorkspaceRequestContext: mocks.context }));
vi.mock("@/lib/auth/server-actor", () => ({ resolveActorFromAuthenticatedClient: mocks.freshActor }));
vi.mock("@/lib/auth/guest-session", () => ({ GUEST_COOKIE_NAME: "guest", createGuestServiceClient: mocks.service, resolveGuestVisit: mocks.visit }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/ai/runtime/guest-ai-budget", () => ({ readGuestAiBudget: mocks.budget, reserveGuestAiCall: mocks.reserve }));
vi.mock("@/lib/observability/workspace-ai-store", () => ({ persistWorkspaceAIRecord: mocks.observe }));
vi.mock("@/lib/services/workspaces/generation", () => ({ readWorkspaceGeneration: mocks.generation }));
vi.mock("@/lib/ai/runtime/workspace-native-agent", async (importOriginal) => {
  const runtimeModule = await importOriginal<typeof import("@/lib/ai/runtime/workspace-native-agent")>();
  return { ...runtimeModule, runWorkspaceNativeAgent: mocks.run };
});
import { POST } from "./route";
import { ProviderAllowanceError } from "@/lib/ai/runtime/workspace-orders-agent";
import { recordAIProviderExchange } from "@/lib/observability/ai-provider-observation-server";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const actor = { authUserId: "22222222-2222-4222-8222-222222222222", profileId: "33333333-3333-4333-8333-333333333333",
  isAnonymous: false, platformRole: "USER", membership: { workspaceId, kind: "OWNER", role: "ADMIN" } };
const client = { session: "caller" };
const guest = { id: "44444444-4444-4444-8444-444444444444", workspaceId, persona: "ADMIN", demoGeneration: 1, expiresAt: "2026-10-06T00:00:00Z" };
const url = `http://localhost/api/workspaces/${workspaceId}/agent/run`;
const params = { params: Promise.resolve({ workspaceId }) };
function request(body: unknown = { prompt: "Show recent orders" }, origin = "http://localhost", signal?: AbortSignal) {
  return new Request(url, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body), signal });
}
async function events(response: Response) { return (await response.text()).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)); }
function workspace(runId: string) { return { runId, workspaceId, mode: "live", type: "clarification", title: "No orders",
  summary: "No orders were returned", status: "COMPLETE", items: [], excerpts: [], proposal: null,
  missingInformation: [], followUps: [], scope: { ordersRead: 0, knowledgeHits: 0, checkedAt: "2026-10-05T00:00:00Z" } }; }
describe("native conversation NDJSON route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.begin.mockResolvedValue(null); mocks.finish.mockResolvedValue(false);
    mocks.context.mockResolvedValue({ actor, client, guestVisit: null }); mocks.freshActor.mockResolvedValue(actor);
    mocks.generation.mockResolvedValue(1); mocks.budget.mockResolvedValue({ remaining: 20, resetAt: "2026-10-05T16:00:00Z" });
    mocks.reserve.mockResolvedValue({ allowed: true }); mocks.service.mockReturnValue({}); mocks.visit.mockResolvedValue(guest);
    mocks.cookies.mockResolvedValue({ get: () => ({ value: "opaque-visit-token" }) });
    mocks.run.mockImplementation(async (_actor, _client, _workspaceId, _input, options: NativeAgentOptions) => {
      options.onProviderStepStart?.(2);
      options.onActivity?.({ id: crypto.randomUUID(), tool: "recentOrders", status: "running" });
      options.onActivity?.({ id: crypto.randomUUID(), tool: "recentOrders", status: "succeeded", count: 0 });
      options.onDiagnosticStage?.("COMPLETE");
      return { workspace: workspace(options.runId!), providerSteps: 2, usage: { inputTokens: 10, outputTokens: 8 } };
    });
  });
  it("records the server's workspace and actual events, then rechecks authority before publishing", async () => {
    const journal = { sessionId: actor.authUserId }; mocks.begin.mockResolvedValue(journal); mocks.finish.mockResolvedValue(true);
    const req = request(); req.headers.set("X-Sejuk-Session", actor.authUserId);
    const recorded = await events(await POST(req, params));
    expect(recorded.at(-1)).toMatchObject({ type: "workspace", historySaved: true });
    expect(mocks.begin).toHaveBeenCalledWith(expect.objectContaining({ actor }), "WORKSPACE", 1, actor.authUserId, expect.any(String), "Show recent orders");
    expect(mocks.finish).toHaveBeenCalledWith(journal, expect.objectContaining({ workspace: expect.objectContaining({ workspaceId }), activity: expect.arrayContaining([expect.objectContaining({ status: "succeeded" })]) }), "COMPLETED");
    mocks.finish.mockImplementation(async () => { mocks.generation.mockResolvedValue(2); return true; });
    const changed = request(); changed.headers.set("X-Sejuk-Session", actor.authUserId);
    const denied = await events(await POST(changed, params));
    expect(denied.some(event => event.type === "workspace")).toBe(false); expect(denied.at(-1).type).toBe("error");
  });
  it("preserves old streams when recording is unavailable and rejects malformed session headers", async () => {
    const old = await events(await POST(request(), params)); expect(old.at(-1)).not.toHaveProperty("historySaved");
    const req = request(); req.headers.set("X-Sejuk-Session", actor.authUserId);
    const current = await events(await POST(req, params)); expect(current.at(-1)).toMatchObject({ type: "workspace", historySaved: false });
    const bad = request(); bad.headers.set("X-Sejuk-Session", "invalid");
    mocks.run.mockClear(); mocks.begin.mockClear();
    expect((await POST(bad, params)).status).toBe(400); expect(mocks.run).not.toHaveBeenCalled(); expect(mocks.begin).not.toHaveBeenCalled();
  });
  it("streams actual activity and a validated workspace with private no-store metadata", async () => {
    const response = await POST(request(), params); expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store"); expect(response.headers.get("Content-Type")).toContain("application/x-ndjson");
    const result = await events(response); expect(result.map((event) => event.type)).toEqual(["started", "activity", "activity", "workspace"]);
    expect(mocks.run).toHaveBeenCalledWith(actor, client, workspaceId,
      { prompt: "Show recent orders", contextOrderIds: [], conversation: [] }, expect.objectContaining({ isGuest: false, beforeProviderCall: undefined }));
    expect(mocks.freshActor).toHaveBeenCalledTimes(2);
    expect(mocks.observe).toHaveBeenCalledWith(expect.objectContaining({ execution: expect.objectContaining({ flow: "Bounded workspace conversation agent", providerSteps: 2 }) }), actor.profileId);
    expect(JSON.stringify(mocks.observe.mock.calls)).not.toContain("Show recent orders");
  });
  it.each([
    [{ prompt: "Show orders", approved: true }, "http://localhost", 400],
    [{ prompt: "Show orders" }, "https://attacker.example", 403],
    [{ prompt: "x".repeat(13000) }, "http://localhost", 400],
    [{ prompt: "Show orders", conversation: Array.from({ length: 7 }, () => ({ role: "user", content: "history" })) }, "http://localhost", 400],
  ])("rejects origin, forged fields and payload bounds before actor/runtime", async (body, origin, status) => {
    const response = await POST(request(body, origin as string), params); expect(response.status).toBe(status);
    expect(mocks.context).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled();
  });
  it("bounds streamed bytes even without a content-length header", async () => {
    const large = new Request(url, { method: "POST", headers: { Origin: "http://localhost" }, body: `{"prompt":"orders","padding":"${"a".repeat(25000)}"}` });
    expect((await POST(large, params)).status).toBe(400); expect(mocks.context).not.toHaveBeenCalled();
  });
  it("accepts full contract-length multibyte current request and conversation", async () => {
    const body = { prompt: "中".repeat(1000), contextOrderIds: [actor.authUserId, actor.profileId, guest.id, workspaceId],
      conversation: Array.from({ length: 6 }, () => ({ role: "user", content: "文".repeat(700) })) };
    expect(new TextEncoder().encode(JSON.stringify(body)).byteLength).toBeGreaterThan(12 * 1024);
    const response = await POST(request(body), params);
    expect(response.status).toBe(200); expect((await events(response)).at(-1)?.type).toBe("workspace");
    expect(mocks.run).toHaveBeenCalledWith(actor, client, workspaceId, body, expect.anything());
  });
  it.each(["workspace", "error"])("closes a terminal %s stream even when metadata never resolves", async (terminal) => {
    mocks.observe.mockImplementation(() => new Promise<void>(() => {}));
    if (terminal === "error") mocks.run.mockRejectedValue(new Error("unavailable"));
    const response = await POST(request(), params);
    const result = await events(response);
    expect(result.at(-1)?.type).toBe(terminal); expect(mocks.observe).toHaveBeenCalledTimes(1);
  }, 1000);
  it("ends a hung final scope recheck with a bounded timeout event", async () => {
    const timeout = new AbortController();
    const spy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
    try {
      mocks.freshActor.mockResolvedValueOnce(actor).mockImplementationOnce(() => new Promise(() => {}));
      const response = await POST(request(), params); const finished = events(response);
      await vi.waitFor(() => expect(mocks.freshActor).toHaveBeenCalledTimes(2));
      timeout.abort(new DOMException("Time limit", "TimeoutError"));
      const result = await finished;
      expect(result.at(-1)).toMatchObject({ type: "error", code: "TIMEOUT" });
      expect(result.some((event) => event.type === "workspace")).toBe(false);
      expect(mocks.observe.mock.calls[0][0].execution.failureStage).toBe("SCOPE_CHECK");
    } finally { spy.mockRestore(); }
  });
  it.each([
    null,
    { actor: { ...actor, businessReady: false }, client, guestVisit: null },
    { actor: { ...actor, preview: { readOnly: true, effectiveEmployeeProfileId: null } }, client, guestVisit: null },
    { actor: { ...actor, membership: { ...actor.membership, role: "TECHNICIAN" } }, client, guestVisit: null },
    { actor: { ...actor, membership: { ...actor.membership, workspaceId: guest.id } }, client, guestVisit: null },
  ])("rejects absent, wrong-scope, preview or disabled actors before streaming", async (scope) => {
    mocks.context.mockResolvedValue(scope); expect((await POST(request(), params)).status).toBe(403); expect(mocks.run).not.toHaveBeenCalled();
  });
  it("checks Guest exhaustion before starting and does not call the runtime", async () => {
    mocks.context.mockResolvedValue({ actor, client, guestVisit: guest }); mocks.budget.mockResolvedValue({ remaining: 0, resetAt: "2026-10-05T16:00:00Z" });
    const response = await POST(request(), params); expect(response.status).toBe(429); expect(await response.json()).toHaveProperty("resetAt"); expect(mocks.run).not.toHaveBeenCalled();
  });
  it("reserves Guest allowance for every provider attempt and sends controlled exhaustion", async () => {
    mocks.context.mockResolvedValue({ actor, client, guestVisit: guest }); mocks.reserve.mockResolvedValueOnce({ allowed: true }).mockResolvedValueOnce({ allowed: false });
    mocks.run.mockImplementation(async (_a, _c, _w, _i, options: NativeAgentOptions) => { await options.beforeProviderCall!(); await options.beforeProviderCall!(); });
    const result = await events(await POST(request(), params)); expect(result.at(-1)).toMatchObject({ type: "error", code: "GUEST_AI_EXHAUSTED" });
    expect(mocks.reserve).toHaveBeenCalledTimes(2); expect(result.some((event) => event.type === "workspace")).toBe(false);
  });
  it.each(["role", "session", "preview", "generation", "guest-persona"])("revalidates changed %s before publishing output", async (change) => {
    if (change === "guest-persona") mocks.context.mockResolvedValue({ actor, client, guestVisit: guest });
    mocks.run.mockImplementation(async (_a, _c, _w, _i, options: NativeAgentOptions) => {
      if (change === "role") mocks.freshActor.mockResolvedValue({ ...actor, membership: { ...actor.membership, role: "MANAGER" } });
      if (change === "session") mocks.freshActor.mockResolvedValue({ ...actor, sessionId: guest.id });
      if (change === "preview") mocks.freshActor.mockResolvedValue({ ...actor, preview: { readOnly: true } });
      if (change === "generation") mocks.generation.mockResolvedValue(2);
      if (change === "guest-persona") mocks.visit.mockResolvedValue({ ...guest, persona: "MANAGER" });
      return { workspace: workspace(options.runId!), usage: {}, providerSteps: 1 };
    });
    const result = await events(await POST(request(), params)); expect(result.at(-1)?.type).toBe("error");
    expect(result.some((event) => event.type === "workspace")).toBe(false);
  });
  it("never exports provider error text", async () => {
    mocks.run.mockRejectedValue(new Error("private provider key secret"));
    const response = await POST(request(), params); const body = await response.text(); expect(body).not.toContain("private provider key secret"); expect(body).toContain("UNAVAILABLE");
  });
  it.each([
    [400, "TOKEN_LIMIT", "request settings"], [401, "CREDENTIAL_REJECTED", "credentials"],
    [402, "UNKNOWN", "credits"], [429, "RATE_LIMIT", "rate limiting"],
    [503, "UPSTREAM_ERROR", "service error"], [0, "UNKNOWN", "connection failed"],
  ])("records safe upstream diagnostics and an actionable message for HTTP %s", async (status, category, message) => {
    mocks.run.mockImplementation(async (_a, _c, _w, _i, options: NativeAgentOptions) => {
      options.onProviderStepStart?.(1); options.onDiagnosticStage?.("PROVIDER_REQUEST");
      recordAIProviderExchange({ providerType: "private-provider", model: "private-model", endpoint: "https://private-endpoint.example",
        method: "POST", statusCode: status as number, statusText: "private-status", durationMs: 10,
        request: { headers: { authorization: "private-key" }, body: { messages: "private-prompt" } },
        response: { headers: {}, body: { error: { code: status === 400 ? "context_length_exceeded" : "private-code", message: "private-response" } } },
        error: { name: "private-error", message: "private-exception" } });
      throw new Error("private-exception");
    });
    const response = await POST(request(), params);
    const body = await response.text();
    expect(body).toContain(message as string); expect(body).not.toContain("private-");
    const record = mocks.observe.mock.calls[0][0];
    expect(record).toMatchObject({ status: "FAILED", errorCode: "WORKSPACE_AGENT_UNAVAILABLE",
      execution: { providerSteps: 1, providerStatusCode: status, providerFailureCategory: category, failureStage: "PROVIDER_REQUEST" }, providerCalls: [] });
    expect(JSON.stringify(record)).not.toContain("private-");
  });
  it("canceling the stream aborts the agent's signal", async () => {
    let options: NativeAgentOptions | undefined;
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    mocks.run.mockImplementation(async (_a, _c, _w, _i, passed: NativeAgentOptions) => { options = passed; await wait; passed.abortSignal!.throwIfAborted(); });
    const response = await POST(request(), params); const reader = response.body!.getReader(); await reader.read();
    await vi.waitFor(() => expect(options).toBeDefined()); await reader.cancel(); expect(options!.abortSignal!.aborted).toBe(true); release();
  });
  it("preserves allowance unavailable as controlled route error", async () => {
    mocks.run.mockRejectedValue(new ProviderAllowanceError("UNAVAILABLE"));
    expect((await events(await POST(request(), params))).at(-1)).toMatchObject({ type: "error", code: "GUEST_AI_UNAVAILABLE" });
  });
});
