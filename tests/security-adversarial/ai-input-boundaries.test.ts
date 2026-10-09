import { beforeEach, describe, expect, it, vi } from "vitest";

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
// These wrappers permit actual handler input parsing; no runtime/provider implementation is loaded.
vi.mock("@/lib/ai/runtime/operations-ask", () => ({
  runOperationsAsk: mocks.runOperations, OperationsAskError: class extends Error {}, OPERATIONS_ASK_FAILURE_REASONS: [],
  withOperationsAbort: async (signal: AbortSignal, work: () => unknown) => { signal.throwIfAborted(); return work(); },
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
type MeasuredBody = ReturnType<typeof measuredRequest>;

function measuredRequest(path: string, json: string, totalBytes: number) {
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
    method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json" },
    body, duplex: "half",
  } as RequestInit & { duplex: "half" });
  expect(request.headers.get("content-length")).toBeNull();
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
beforeEach(() => { vi.resetAllMocks(); });

describe("bounded offline input observations through actual AI handlers", () => {
  // These passing assertions preserve observed evidence of a REPAIR condition, not an acceptance pass.
  it("REPAIR evidence: Operations consumes all 256KiB of valid padded JSON before denying missing actor", async () => {
    const sample = measuredRequest("operations/ask", JSON.stringify({ question: "Show orders" }), SAMPLE_BYTES);
    const response = await operationsPost(sample.request, context);
    record("operations-valid-padding-auth-order", sample, response.status);
    expect(response.status).toBe(403);
    expect(sample.stats()).toEqual({ suppliedBytes: SAMPLE_BYTES, deliveredBytes: SAMPLE_BYTES, cancelled: false, reachedEnd: true });
    expect(sample.events.slice(-2)).toEqual(["body:end", "scope:denied"]);
    expect(mocks.context).toHaveBeenCalledExactlyOnceWith(workspaceId);
    expectNoDownstream();
  });

  it("REPAIR evidence: Operations field length rejection occurs after consuming the complete 256KiB body", async () => {
    const json = JSON.stringify({ question: "x".repeat(SAMPLE_BYTES - 15) });
    const sample = measuredRequest("operations/ask", json, SAMPLE_BYTES);
    const response = await operationsPost(sample.request, context);
    record("operations-oversized-field", sample, response.status);
    expect(response.status).toBe(400);
    expect(sample.stats()).toEqual({ suppliedBytes: SAMPLE_BYTES, deliveredBytes: SAMPLE_BYTES, cancelled: false, reachedEnd: true });
    expect(mocks.context).not.toHaveBeenCalled();
    expectNoDownstream();
  });

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
