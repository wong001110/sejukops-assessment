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
import { currentAIProviderObservationContext, recordAIProviderExchange } from "@/lib/observability/ai-provider-observation-server";
import { operationsAskFailureMessage } from "@/lib/ai/runtime/operations-ask-diagnostics";
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
  it.each(["fixed", "fabricated"] as const)("strips %s no-lookup diagnostics from public JSON and records only CONTROLLED metadata", async (kind) => {
    mocks.context.mockResolvedValue({ actor, client: {}, guestVisit: null });
    const diagnostics = kind === "fixed" ? { failureReason: "TOOL_INCOMPLETE", sdkErrorKind: "TOOL_CHOICE" }
      : { failureReason: "PRIVATE_FAKE_REASON", sdkErrorKind: "PRIVATE_FAKE_KIND" };
    mocks.run.mockImplementation(async (_a, _c, _i, options: Options) => {
      await options.beforeProviderCall?.(); options.onProviderStepStart?.();
      recordAIProviderExchange({ providerType: "OPENAI_COMPATIBLE", endpoint: "https://provider.example/v1/chat/completions", model: "fictional-test",
        method: "POST", statusCode: 200, statusText: "OK", durationMs: 5,
        request: { headers: { Authorization: "Bearer PRIVATE_SECRET" }, body: { messages: [{ role: "user", content: "PRIVATE_PROMPT" }] } },
        response: { headers: {}, body: { choices: [{ finish_reason: "stop", message: { content: "PRIVATE_UNVERIFIED_PROVIDER_ANSWER" } }] } } });
      return { status: "INSUFFICIENT", answer: "The AI did not perform an evidence lookup for this request. No answer was verified. Try a specific order number or search manually.",
        orders: [], excerpts: [], activity: [], providerSteps: 1, usage: {}, diagnostics: { ...diagnostics, payload: "PRIVATE_DIAGNOSTIC_PAYLOAD" } };
    });
    const response = await POST(request(), params), body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "INSUFFICIENT", orders: [], excerpts: [], activity: [] });
    expect(body.answer).toContain("No answer was verified");
    for (const field of ["diagnostics", "reason", "sdkErrorKind", "providerSteps", "usage"]) expect(body).not.toHaveProperty(field);
    expect(mocks.observe).toHaveBeenCalledTimes(1);
    expect(mocks.observe.mock.calls[0][0]).toMatchObject({ task: "OPERATIONS_QUERY", status: "CONTROLLED", errorCode: null,
      execution: { providerStatusCode: 200, finalFinishReason: "stop", providerSteps: 1,
        operationsFailureReason: kind === "fixed" ? "TOOL_INCOMPLETE" : null,
        sdkErrorKind: kind === "fixed" ? "TOOL_CHOICE" : null } });
    expect(JSON.stringify({ body, persisted: mocks.observe.mock.calls, warnings: vi.mocked(console.warn).mock.calls })).not.toContain("PRIVATE_");
    expect(console.warn).not.toHaveBeenCalled(); expect(mocks.reserve).not.toHaveBeenCalled();
  });
  it("denies a scope reset after runtime abstention before returning the public result", async () => {
    mocks.context.mockResolvedValue({ actor, client: {}, guestVisit: null });
    mocks.run.mockImplementation(async (_a, _c, _i, options: Options) => {
      await options.beforeProviderCall?.(); options.onProviderStepStart?.();
      mocks.generation.mockResolvedValue(2);
      return { ...result, providerSteps: 1, usage: {}, diagnostics: { failureReason: "TOOL_INCOMPLETE", sdkErrorKind: "TOOL_CHOICE" } };
    });
    const response = await POST(request(), params), body = await response.json();
    expect(response.status).toBe(409); expect(body).not.toHaveProperty("status"); expect(body).not.toHaveProperty("diagnostics");
    expect(mocks.observe).toHaveBeenCalledTimes(1);
    expect(mocks.observe.mock.calls[0][0]).toMatchObject({ status: "CONTROLLED", execution: { operationsFailureReason: "SCOPE_CHANGED" } });
    expect(console.warn).toHaveBeenCalledWith("OPERATIONS_ASK_FAILURE", "SCOPE_CHANGED");
  });
  it.each([
    { name: "upstream token rejection", upstreamStatus: 400, reason: "PROVIDER_FAILURE" as const, sdkKind: "API_CALL" as const,
      providerBody: { error: { code: 1313, type: "invalid_request_error", param: "max_tokens",
        message: "max_tokens must be less than the maximum token budget. PRIVATE_PROVIDER_MESSAGE", secret: "PRIVATE_RESPONSE_SECRET" } },
      expected: { providerStatusCode: 400, upstreamErrorCode: 1313, providerFailureCategory: "TOKEN_LIMIT", finalFinishReason: "unknown", visibleTextLength: 0 } },
    { name: "successful provider response rejected by excerpt verification", upstreamStatus: 200, reason: "INVALID_EXCERPT" as const, sdkKind: undefined,
      providerBody: { choices: [{ finish_reason: "stop", message: { content: "PRIVATE_MODEL_RESPONSE" } }] },
      expected: { providerStatusCode: 200, upstreamErrorCode: null, providerFailureCategory: null, finalFinishReason: "stop", visibleTextLength: "PRIVATE_MODEL_RESPONSE".length } },
    { name: "network transport failure without a provider error body", upstreamStatus: 0, reason: "PROVIDER_FAILURE" as const, sdkKind: "API_CALL" as const,
      providerBody: null,
      expected: { providerStatusCode: 0, upstreamErrorCode: null, providerFailureCategory: null, finalFinishReason: "unknown", visibleTextLength: 0 } },
    { name: "HTTP 200 stop with an SDK response validation failure", upstreamStatus: 200, reason: "PROVIDER_FAILURE" as const, sdkKind: "RESPONSE_VALIDATION" as const,
      providerBody: { choices: [{ finish_reason: "stop", message: { content: "PRIVATE_MODEL_RESPONSE" } }] },
      expected: { providerStatusCode: 200, upstreamErrorCode: null, providerFailureCategory: null, finalFinishReason: "stop", visibleTextLength: "PRIVATE_MODEL_RESPONSE".length } },
    { name: "HTTP 200 stop with an SDK tool-choice violation", upstreamStatus: 200, reason: "PROVIDER_FAILURE" as const, sdkKind: "TOOL_CHOICE" as const,
      providerBody: { choices: [{ finish_reason: "stop", message: { content: "PRIVATE_MODEL_RESPONSE" } }] },
      expected: { providerStatusCode: 200, upstreamErrorCode: null, providerFailureCategory: null, finalFinishReason: "stop", visibleTextLength: "PRIVATE_MODEL_RESPONSE".length } },
  ])("persists safe real-ALS exchange facts for $name without exposing raw content", async ({ upstreamStatus, reason, sdkKind, providerBody, expected }) => {
    mocks.context.mockResolvedValue({ actor, client: {}, guestVisit: null });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.run.mockImplementation(async (_a, _c, _input, options: Options) => {
      expect(currentAIProviderObservationContext()?.task).toBe("OPERATIONS_QUERY");
      await options.beforeProviderCall?.(); options.onProviderStepStart?.();
      recordAIProviderExchange({ providerType: "OPENAI_COMPATIBLE", providerSource: "SAVED", endpoint: "https://PRIVATE_ENDPOINT.example/v1/chat/completions",
        model: "PRIVATE_MODEL_NAME", method: "POST", statusCode: upstreamStatus, statusText: "PRIVATE_STATUS_TEXT", durationMs: 7,
        request: { headers: { Authorization: "Bearer PRIVATE_CREDENTIAL", "x-api-key": "PRIVATE_API_KEY" },
          body: { messages: [{ role: "user", content: "PRIVATE_PROMPT" }, { role: "tool", content: "PRIVATE_SOURCE" }] } },
        response: { headers: { "set-cookie": "PRIVATE_COOKIE" }, body: providerBody },
        ...(upstreamStatus === 0 ? { error: { name: "PRIVATE_TRANSPORT_NAME", message: "PRIVATE_TRANSPORT_MESSAGE" } } : {}) });
      const failure = new OperationsAskError("UNAVAILABLE", reason, sdkKind);
      Object.assign(failure, { message: "PRIVATE_RUNTIME_ERROR", cause: new Error("PRIVATE_RAW_CAUSE") });
      throw failure;
    });
    const response = await POST(request({ question: "PRIVATE_CALLER_QUESTION" }), params);
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body.error).toBe(operationsAskFailureMessage(reason));
    expect(body).not.toHaveProperty("reason");
    expect(body).not.toHaveProperty("sdkErrorKind");
    expect(body).not.toHaveProperty("diagnostics");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.observe).toHaveBeenCalledTimes(1);
    const record = mocks.observe.mock.calls[0][0];
    expect(record).toMatchObject({ task: "OPERATIONS_QUERY", status: "FAILED", errorCode: "WORKSPACE_AGENT_UNAVAILABLE" });
    expect(record.execution).toMatchObject({ flow: "Read-only Operations evidence selection", providerSteps: 1,
      operationsFailureReason: reason, sdkErrorKind: sdkKind ?? null, ...expected });
    expect(record.providerCalls).toEqual([]);
    expect(console.warn).toHaveBeenCalledExactlyOnceWith("OPERATIONS_ASK_FAILURE", reason);
    expect(JSON.stringify({ body, persisted: mocks.observe.mock.calls, warnings: vi.mocked(console.warn).mock.calls,
      logs: log.mock.calls, errors: errorLog.mock.calls })).not.toContain("PRIVATE_");
    expect(currentAIProviderObservationContext()).toBeUndefined();
  });
  it("records successful provider diagnostics under the distinct Operations task without persisting its exchanges", async () => {
    mocks.context.mockResolvedValue({ actor, client: {}, guestVisit: null });
    mocks.run.mockImplementation(async (_a, _c, _input, options: Options) => {
      expect(currentAIProviderObservationContext()?.task).toBe("OPERATIONS_QUERY");
      for (let index = 0; index < 2; index += 1) {
        await options.beforeProviderCall?.(); options.onProviderStepStart?.();
        recordAIProviderExchange({ providerType: "OPENAI_COMPATIBLE", endpoint: "https://PRIVATE_ENDPOINT.example/v1/chat/completions", model: "PRIVATE_MODEL",
          method: "POST", statusCode: 200, statusText: "OK", durationMs: 5,
          request: { headers: { Authorization: "Bearer PRIVATE_KEY" }, body: { messages: [{ role: "user", content: "PRIVATE_PROMPT" }] } },
          response: { headers: {}, body: { choices: [{ finish_reason: index === 0 ? "tool_calls" : "stop", message: { content: "PRIVATE_PROVIDER_RESPONSE" } }],
            usage: { prompt_tokens: 10, completion_tokens: 3, completion_tokens_details: { reasoning_tokens: 1 } } } } });
      }
      return { ...result, status: "EVIDENCE_FOUND", orders: [{ id: otherId, workspace_id: workspaceId, order_no: "EVAL-DIAGNOSTIC-1",
        branch_id: otherId, customer_id: otherId, assigned_technician_id: actor.profileId, status: "ASSIGNED", problem_description: "Fictional filter inspection",
        service_type: "REPAIR", scheduled_at: null, created_at: "2026-10-07T00:00:00Z", updated_at: "2026-10-07T00:00:00Z" }],
        usage: { inputTokens: 20, outputTokens: 6 } };
    });
    const response = await POST(request({ question: "PRIVATE_CALLER_QUESTION" }), params);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "EVIDENCE_FOUND", orders: [{ order_no: "EVAL-DIAGNOSTIC-1" }] });
    expect(body).not.toHaveProperty("reason"); expect(body).not.toHaveProperty("providerSteps"); expect(body).not.toHaveProperty("usage");
    expect(mocks.observe).toHaveBeenCalledTimes(1);
    expect(mocks.observe.mock.calls[0][0]).toMatchObject({ task: "OPERATIONS_QUERY", status: "SUCCEEDED", errorCode: null,
      execution: { flow: "Read-only Operations evidence selection", providerStatusCode: 200, finalFinishReason: "stop", providerFailureCategory: null,
        operationsFailureReason: null, sdkErrorKind: null, providerSteps: 2, reasoningTokens: 2, inputTokens: 20, outputTokens: 6 }, providerCalls: [] });
    expect(JSON.stringify({ body, persisted: mocks.observe.mock.calls, warnings: vi.mocked(console.warn).mock.calls })).not.toContain("PRIVATE_");
    expect(console.warn).not.toHaveBeenCalled(); expect(mocks.reserve).not.toHaveBeenCalled();
    expect(currentAIProviderObservationContext()).toBeUndefined();
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
    const failure = new OperationsAskError("UNAVAILABLE"); Object.assign(failure, { reason: "provider-secret", sdkErrorKind: "PRIVATE_FAKE_SDK_KIND" });
    mocks.run.mockRejectedValue(failure);
    const response = await POST(request(), params), body = await response.json();
    expect(response.status).toBe(503);
    expect(console.warn).toHaveBeenCalledWith("OPERATIONS_ASK_FAILURE", "UNEXPECTED_FAILURE");
    expect(mocks.observe.mock.calls[0][0]).toMatchObject({ task: "OPERATIONS_QUERY", execution: { operationsFailureReason: "UNEXPECTED_FAILURE", sdkErrorKind: null } });
    expect(body.error).toBe(operationsAskFailureMessage("UNEXPECTED_FAILURE")); expect(body).not.toHaveProperty("reason");
    expect(JSON.stringify({ warnings: vi.mocked(console.warn).mock.calls, persisted: mocks.observe.mock.calls, body })).not.toContain("provider-secret");
    expect(JSON.stringify({ warnings: vi.mocked(console.warn).mock.calls, persisted: mocks.observe.mock.calls, body })).not.toContain("PRIVATE_FAKE_SDK_KIND");
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
  it.each([[{ question: "Hi", workspaceId: otherId }, "http://localhost", 400], [{ question: "Hi", role: "ADMIN" }, "http://localhost", 400], [{ question: "x".repeat(121) }, "http://localhost", 400], [{ question: "Hi" }, "https://attacker.example", 403]])("denies forged fields and length after authorization; foreign origin before scope", async (body, origin, status) => {
    expect((await POST(request(body, origin as string), params)).status).toBe(status);
    if (status === 403) expect(mocks.context).not.toHaveBeenCalled(); else expect(mocks.context).toHaveBeenCalledExactlyOnceWith(workspaceId);
    expect(mocks.run).not.toHaveBeenCalled(); expect(mocks.generation).not.toHaveBeenCalled();
    expect(mocks.budget).not.toHaveBeenCalled(); expect(mocks.reserve).not.toHaveBeenCalled(); expect(mocks.observe).not.toHaveBeenCalled();
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
