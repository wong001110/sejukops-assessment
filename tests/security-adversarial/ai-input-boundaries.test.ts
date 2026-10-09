import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActorContext } from "@/lib/auth/actor-policy";

const mocks = vi.hoisted(() => ({
  context: vi.fn(), fresh: vi.fn(), generation: vi.fn(), runOperations: vi.fn(), runNative: vi.fn(),
  budget: vi.fn(), reserve: vi.fn(), store: vi.fn(), observation: vi.fn(), cookies: vi.fn(), service: vi.fn(), visit: vi.fn(),
}));
vi.mock("@/lib/auth/workspace-request-context", () => ({ getWorkspaceRequestContext: mocks.context }));
vi.mock("@/lib/auth/server-actor", () => ({ resolveActorFromAuthenticatedClient: mocks.fresh }));
vi.mock("@/lib/auth/guest-session", () => ({ GUEST_COOKIE_NAME: "fictional-guest", createGuestServiceClient: mocks.service, resolveGuestVisit: mocks.visit }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/services/workspaces/generation", () => ({ readWorkspaceGeneration: mocks.generation }));
vi.mock("@/lib/ai/runtime/guest-ai-budget", () => ({ readGuestAiBudget: mocks.budget, reserveGuestAiCall: mocks.reserve }));
vi.mock("@/lib/observability/workspace-ai-store", () => ({ persistWorkspaceAIRecord: mocks.store }));
vi.mock("@/lib/observability/ai-provider-observation-server", () => ({ runWithAIProviderObservation: mocks.observation }));
vi.mock("@/lib/ai/runtime/workspace-orders-agent", () => ({ ProviderAllowanceError: class extends Error {} }));
// Use the actual Operations abort wrapper; only its provider/runtime work is replaced.
vi.mock("@/lib/ai/runtime/operations-ask", async (original) => ({
  ...await original<typeof import("@/lib/ai/runtime/operations-ask")>(), runOperationsAsk: mocks.runOperations,
}));
vi.mock("@/lib/ai/runtime/workspace-native-agent", () => ({
  runWorkspaceNativeAgent: mocks.runNative, WorkspaceNativeAgentError: class extends Error {},
  withNativeAbort: async (signal: AbortSignal, work: () => unknown) => { signal.throwIfAborted(); return work(); },
}));

import { POST as operationsPost } from "@/app/api/workspaces/[workspaceId]/operations/ask/route";
import { POST as nativePost } from "@/app/api/workspaces/[workspaceId]/agent/run/route";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const context = { params: Promise.resolve({ workspaceId }) };
const SAMPLE_BYTES = 256 * 1024;
const CHUNK_BYTES = 4 * 1024;
const actor: ActorContext = { authUserId: workspaceId, profileId: workspaceId, isAnonymous: false,
  platformRole: "USER", businessReady: true, membership: { workspaceId, kind: "OWNER", role: "ADMIN" } };
const scope = { actor, client: {}, guestVisit: null };
type MeasuredBody = ReturnType<typeof measuredRequest>;

function measuredRequest(path: string, json: string, totalBytes: number, declared?: string, signal?: AbortSignal) {
  const encoded = new TextEncoder().encode(json);
  if (encoded.byteLength > totalBytes) throw new Error("Synthetic sample exceeds its declared bounded fixture size");
  const bytes = new Uint8Array(totalBytes).fill(32);
  bytes.set(encoded);
  let deliveredBytes = 0, cancelled = false, reachedEnd = false;
  const events: string[] = [];
  // Zero queue size prevents eager stream prefetch: each delivery corresponds to a handler read.
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (deliveredBytes === bytes.byteLength) {
        reachedEnd = true; events.push("body:end"); controller.close(); return;
      }
      const end = Math.min(deliveredBytes + CHUNK_BYTES, bytes.byteLength);
      controller.enqueue(bytes.slice(deliveredBytes, end)); deliveredBytes = end;
      events.push(`body:read:${deliveredBytes}`);
    },
    cancel() { cancelled = true; events.push("body:cancel"); },
  }, { highWaterMark: 0 });
  const request = new Request(`http://localhost/api/workspaces/${workspaceId}/${path}`, {
    method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json", ...(declared === undefined ? {} : { "Content-Length": declared }) },
    body, duplex: "half", signal,
  } as RequestInit & { duplex: "half" });
  expect(request.headers.get("content-length")).toBe(declared ?? null);
  mocks.context.mockImplementation(async () => { events.push("scope:denied"); return null; });
  return { request, events, stats: () => ({ suppliedBytes: totalBytes, deliveredBytes, cancelled, reachedEnd }) };
}

function expectNoDownstream() {
  for (const mock of [mocks.fresh, mocks.generation, mocks.runOperations, mocks.runNative, mocks.budget,
    mocks.reserve, mocks.store, mocks.observation, mocks.cookies, mocks.service, mocks.visit]) expect(mock).not.toHaveBeenCalled();
}
function record(name: string, sample: MeasuredBody, status: number) {
  console.info("AI_INPUT_BOUNDARY_OBSERVATION", JSON.stringify({ name, status, ...sample.stats(),
    scopeCalls: mocks.context.mock.calls.length, finalEvents: sample.events.slice(-3) }));
}
function authorize(sample?: MeasuredBody) {
  mocks.context.mockImplementation(async () => { sample?.events.push("scope:allowed"); return scope; });
  mocks.fresh.mockResolvedValue(actor); mocks.generation.mockResolvedValue(1);
  mocks.runOperations.mockResolvedValue({ status: "INSUFFICIENT", answer: "No verified matches", orders: [], excerpts: [], activity: [], providerSteps: 1, usage: {} });
  mocks.observation.mockImplementation(async (_request, _task, work: () => Promise<unknown>) => ({ ok: true, value: await work(), exchanges: [] }));
}
beforeEach(() => { vi.resetAllMocks(); vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

describe("Operations input boundary acceptance through actual handler and stream reader", () => {
  it.each([null, { ...scope, actor: { ...actor, businessReady: false } },
    { ...scope, actor: { ...actor, preview: { readOnly: true, effectiveEmployeeProfileId: null } } },
    { ...scope, actor: { ...actor, membership: { ...actor.membership!, workspaceId: "22222222-2222-4222-8222-222222222222" } } },
    { ...scope, actor: { ...actor, isAnonymous: true } }])("denies unauthorized scope without consuming any of the original 256KiB sample %j", async (denied) => {
    const sample = measuredRequest("operations/ask", JSON.stringify({ question: "Show orders" }), SAMPLE_BYTES);
    mocks.context.mockImplementation(async () => { sample.events.push("scope:denied"); return denied; });
    const response = await operationsPost(sample.request, context);
    record("operations-valid-padding-auth-order", sample, response.status);
    expect(response.status).toBe(403);
    expect(sample.stats()).toEqual({ suppliedBytes: SAMPLE_BYTES, deliveredBytes: 0, cancelled: false, reachedEnd: false });
    expect(sample.request.bodyUsed).toBe(false); expect(sample.events).toEqual(["scope:denied"]);
    expect(mocks.context).toHaveBeenCalledExactlyOnceWith(workspaceId);
    expectNoDownstream();
  });

  it.each([undefined, "0", "1"])("caps actual authorized padded input with declaration %s and cancels overflow", async (declared) => {
    const sample = measuredRequest("operations/ask", JSON.stringify({ question: "Show orders" }), SAMPLE_BYTES, declared);
    authorize(sample);
    const response = await operationsPost(sample.request, context);
    expect(response.status).toBe(413); expect(await response.json()).toEqual({ error: "Request body too large" });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(sample.stats()).toEqual({ suppliedBytes: SAMPLE_BYTES, deliveredBytes: 8192, cancelled: true, reachedEnd: false });
    expect(sample.events[0]).toBe("scope:allowed"); expect(sample.request.body?.locked).toBe(false);
    expectNoDownstream();
  });

  it("rejects the original 256KiB oversized field at the byte cap, before schema/provider work", async () => {
    const json = JSON.stringify({ question: "x".repeat(SAMPLE_BYTES - 15) });
    const sample = measuredRequest("operations/ask", json, SAMPLE_BYTES);
    authorize(sample);
    const response = await operationsPost(sample.request, context);
    record("operations-oversized-field", sample, response.status);
    expect(response.status).toBe(413);
    expect(sample.stats()).toEqual({ suppliedBytes: SAMPLE_BYTES, deliveredBytes: 8192, cancelled: true, reachedEnd: false });
    expect(mocks.context).toHaveBeenCalledExactlyOnceWith(workspaceId);
    expectNoDownstream();
  });

  it.each(["-1", "1.5", "abc", "1,2", "262144"])("rejects invalid/oversized declared bytes %s without reading or downstream work", async (declared) => {
    const sample = measuredRequest("operations/ask", "{}", SAMPLE_BYTES, declared); authorize(sample);
    expect((await operationsPost(sample.request, context)).status).toBe(declared === "262144" ? 413 : 400);
    expect(sample.stats().deliveredBytes).toBe(0); expect(sample.request.bodyUsed).toBe(false); expectNoDownstream();
  });

  it.each(["ADMIN", "MANAGER", "TECHNICIAN"] as const)("retains a valid 120-unit escaped Unicode question at the exact 4KiB cap for %s", async (role) => {
    const question = "界🙂".repeat(40);
    const json = JSON.stringify({ question }).replace(/[^\x00-\x7F]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
    const sample = measuredRequest("operations/ask", json, CHUNK_BYTES); authorize(sample);
    const roleActor = { ...actor, membership: { ...actor.membership!, role } };
    mocks.context.mockImplementation(async () => { sample.events.push("scope:allowed"); return { ...scope, actor: roleActor }; });
    mocks.fresh.mockResolvedValue(roleActor);
    const response = await operationsPost(sample.request, context);
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ status: "INSUFFICIENT", answer: "No verified matches", traceId: expect.any(String) });
    expect(mocks.runOperations).toHaveBeenCalledWith(roleActor, {}, { workspaceId, question }, expect.objectContaining({ abortSignal: expect.any(AbortSignal) }));
    expect(sample.events[0]).toBe("scope:allowed"); expect(sample.stats().deliveredBytes).toBe(4096); expect(sample.stats().cancelled).toBe(false);
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it.each([undefined, "text/plain", "application/json; charset=utf-8"])("retains ordinary JSON header compatibility %s", async (mediaType) => {
    const sample = measuredRequest("operations/ask", JSON.stringify({ question: "Show my jobs" }), 100); authorize(sample);
    if (mediaType === undefined) sample.request.headers.delete("Content-Type"); else sample.request.headers.set("Content-Type", mediaType);
    expect((await operationsPost(sample.request, context)).status).toBe(200);
  });

  it("rejects foreign Origin before scope and body consumption", async () => {
    const sample = measuredRequest("operations/ask", "{}", SAMPLE_BYTES); sample.request.headers.set("Origin", "https://fictional-attacker.invalid");
    expect((await operationsPost(sample.request, context)).status).toBe(403);
    expect(sample.request.bodyUsed).toBe(false); expect(mocks.context).not.toHaveBeenCalled(); expectNoDownstream();
  });

  it.each(["params", "scope"])("cancels a stalled %s resolution before body work", async (phase) => {
    const controller = new AbortController(); const sample = measuredRequest("operations/ask", "{}", SAMPLE_BYTES, undefined, controller.signal);
    const routeContext = phase === "params" ? { params: new Promise<{ workspaceId: string }>(() => {}) } : context;
    if (phase === "scope") mocks.context.mockImplementation(() => new Promise(() => {}));
    const pending = operationsPost(sample.request, routeContext);
    if (phase === "scope") await vi.waitFor(() => expect(mocks.context).toHaveBeenCalledOnce());
    controller.abort();
    expect((await pending).status).toBe(503); expect(sample.stats().deliveredBytes).toBe(0); expectNoDownstream();
  });

  it.each(["disconnect", "deadline"])("%s stops an actual stalled body read without waiting for source cleanup", async (kind) => {
    const controller = new AbortController(), cancel = vi.fn(() => new Promise<void>(() => {})), pull = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 });
    const request = new Request(`http://localhost/api/workspaces/${workspaceId}/operations/ask`, { method: "POST",
      headers: { Origin: "http://localhost" }, body: stream, signal: kind === "disconnect" ? controller.signal : undefined, duplex: "half" } as RequestInit);
    if (kind === "deadline") vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    authorize(); const pending = operationsPost(request, context);
    await vi.waitFor(() => expect(pull).toHaveBeenCalledOnce());
    controller.abort(new DOMException("Synthetic cancellation", kind === "deadline" ? "TimeoutError" : "AbortError"));
    const response = await pending;
    expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ error: "Request cancelled or timed out. You can retry or search manually." });
    await vi.waitFor(() => expect(request.body?.locked).toBe(false)); expect(cancel).toHaveBeenCalledOnce(); expectNoDownstream();
    if (kind === "deadline") expect(AbortSignal.timeout).toHaveBeenCalledExactlyOnceWith(30000);
  });
});

describe("unchanged Native input controls", () => {
  it("Native cancels a 256KiB absent-length body on the first chunk over its 24KiB cap", async () => {
    const sample = measuredRequest("agent/run", JSON.stringify({ prompt: "Show orders" }), SAMPLE_BYTES);
    const response = await nativePost(sample.request, context);
    record("native-stream-byte-cap", sample, response.status);
    expect(response.status).toBe(400);
    expect(sample.stats()).toEqual({ suppliedBytes: SAMPLE_BYTES, deliveredBytes: 28 * 1024, cancelled: true, reachedEnd: false });
    expect(sample.events.at(-1)).toBe("body:cancel");
    expect(mocks.context).not.toHaveBeenCalled();
    expectNoDownstream();
  });

  it("Native consumes a valid small body before missing-actor denial within its input cap", async () => {
    const sample = measuredRequest("agent/run", JSON.stringify({ prompt: "Show orders" }), CHUNK_BYTES);
    const response = await nativePost(sample.request, context);
    record("native-small-body-auth-order", sample, response.status);
    expect(response.status).toBe(403);
    expect(sample.stats()).toEqual({ suppliedBytes: CHUNK_BYTES, deliveredBytes: CHUNK_BYTES, cancelled: false, reachedEnd: true });
    expect(sample.events.slice(-2)).toEqual(["body:end", "scope:denied"]);
    expect(mocks.context).toHaveBeenCalledExactlyOnceWith(workspaceId);
    expectNoDownstream();
  });
});
