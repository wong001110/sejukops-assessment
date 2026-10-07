import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActorContext } from "@/lib/auth/actor-policy";

const mocks = vi.hoisted(() => ({
  actor: vi.fn(), client: vi.fn(), create: vi.fn(), stage: vi.fn(), index: vi.fn(), publish: vi.fn(), retry: vi.fn(),
}));
vi.mock("@/lib/auth/server-actor", () => ({ getServerActorContext: mocks.actor }));
vi.mock("@/lib/auth/workspace-request-context", () => ({ getWorkspaceRequestContext: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.client }));
vi.mock("@/lib/services/workspace-knowledge/service", () => ({
  createKnowledgeDocument: mocks.create, stageKnowledgeText: mocks.stage, indexKnowledgeVersion: mocks.index,
  publishKnowledgeVersion: mocks.publish, retryKnowledgeIndex: mocks.retry, readKnowledgeVersionForReview: vi.fn(),
  searchWorkspaceKnowledge: vi.fn(), WorkspaceKnowledgeError: class extends Error {},
}));
vi.mock("@/lib/services/workspaces/generation", () => ({ readWorkspaceGeneration: vi.fn(), WorkspaceGenerationError: class extends Error {} }));
import { POST } from "./route";

const origin = "http://localhost:3000";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";
const versionId = "33333333-3333-4333-8333-333333333333";
const context = { params: Promise.resolve({ workspaceId }) };
const actor: ActorContext = { authUserId: "auth", profileId: "profile", platformRole: "USER", isAnonymous: false,
  membership: { workspaceId, kind: "OWNER", role: "ADMIN" } };
const commands = [
  { body: { action: "create", generation: 1, title: "Synthetic document", sourceLabel: "Synthetic TXT" }, service: mocks.create, status: 201 },
  { body: { action: "stage", generation: 1, documentId, sourceText: "Synthetic knowledge" }, service: mocks.stage, status: 201 },
  { body: { action: "index", generation: 1, documentId, versionId }, service: mocks.index, status: 200 },
  { body: { action: "retry", generation: 1, documentId, versionId }, service: mocks.retry, status: 200 },
  { body: { action: "publish", generation: 1, documentId, versionId }, service: mocks.publish, status: 200 },
];
function request(body: string = JSON.stringify(commands[0].body)) {
  return new Request(`${origin}/api/workspaces/${workspaceId}/knowledge`, {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body,
  });
}
function streamed(body: string, declaredLength?: string) {
  const bytes = new TextEncoder().encode(body);
  let cursor = 0;
  const cancelled = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { if (cursor === bytes.length) { controller.close(); return; }
      const chunk = bytes.slice(cursor, cursor + 1024); cursor += chunk.length; controller.enqueue(chunk); },
    cancel: cancelled,
  }, { highWaterMark: 0 });
  const input = new Request(`${origin}/api/workspaces/${workspaceId}/knowledge`, {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json",
      ...(declaredLength !== undefined ? { "Content-Length": declaredLength } : {}) }, body: stream, duplex: "half",
  } as RequestInit);
  return { input, cancelled, consumed: () => cursor, total: bytes.length };
}

describe("Knowledge JSON request security", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.actor.mockResolvedValue(actor); mocks.client.mockResolvedValue({ session: "caller" });
    mocks.create.mockResolvedValue(documentId); mocks.stage.mockResolvedValue(versionId);
  });

  it.each([null, { ...actor, businessReady: false }, { ...actor, preview: { readOnly: true, effectiveEmployeeProfileId: "employee" } },
    { ...actor, membership: { ...actor.membership, role: "TECHNICIAN" } },
    { ...actor, membership: { ...actor.membership, workspaceId: documentId } },
    { ...actor, isAnonymous: true }])("rejects unauthorized actors without reading the body", async (rejected) => {
    mocks.actor.mockResolvedValue(rejected);
    const probe = streamed(JSON.stringify(commands[0].body));
    expect((await POST(probe.input, context)).status).toBe(403);
    expect(probe.consumed()).toBe(0); expect(probe.input.bodyUsed).toBe(false);
    expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each(commands)("preserves authorized $body.action dispatch", async ({ body, service, status }) => {
    expect((await POST(request(JSON.stringify(body)), context)).status).toBe(status);
    expect(service).toHaveBeenCalledWith(actor, { session: "caller" }, { workspaceId, ...body });
  });

  it("preserves Manager editing and the full 100000-character Unicode/escaped-text contract", async () => {
    const manager = { ...actor, membership: { ...actor.membership!, role: "MANAGER" } };
    mocks.actor.mockResolvedValue(manager);
    // 100000 UTF-16 units can expand to 600000 JSON bytes; the byte cap must not reduce the field contract.
    const sourceText = "\u0000".repeat(100_000);
    expect((await POST(request(JSON.stringify({ action: "stage", generation: 1, documentId, sourceText })), context)).status).toBe(201);
    expect(mocks.stage).toHaveBeenCalledWith(manager, { session: "caller" }, { workspaceId, action: "stage", generation: 1, documentId, sourceText });
    mocks.stage.mockClear();
    const multilingual = "界🙂".repeat(33_333);
    expect((await POST(request(JSON.stringify({ action: "stage", generation: 1, documentId, sourceText: multilingual })), context)).status).toBe(201);
    expect(mocks.stage).toHaveBeenCalledOnce();
  });

  it.each([undefined, "1"])("cancels an oversized streamed body with absent or false Content-Length %s", async (declared) => {
    const probe = streamed(" ".repeat(2 * 1024 * 1024) + JSON.stringify(commands[0].body), declared);
    expect((await POST(probe.input, context)).status).toBe(413);
    expect(probe.cancelled).toHaveBeenCalledOnce(); expect(probe.consumed()).toBeLessThan(probe.total);
    expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects an oversized declaration without starting to read", async () => {
    const probe = streamed(JSON.stringify(commands[0].body), String(2 * 1024 * 1024));
    expect((await POST(probe.input, context)).status).toBe(413);
    expect(probe.consumed()).toBe(0); expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each(["{", JSON.stringify({ action: "stage", generation: 1, documentId, sourceText: "x".repeat(100_001) }),
    JSON.stringify({ ...commands[0].body, role: "ADMIN" })])("keeps malformed/schema-invalid JSON controlled", async (body) => {
    expect((await POST(request(body), context)).status).toBe(400);
    expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.stage).not.toHaveBeenCalled();
  });

  it("rejects foreign Origin before resolving an actor or reading", async () => {
    const input = request(); input.headers.set("Origin", "https://untrusted.invalid");
    expect((await POST(input, context)).status).toBe(403);
    expect(input.bodyUsed).toBe(false); expect(mocks.actor).not.toHaveBeenCalled();
  });
});
