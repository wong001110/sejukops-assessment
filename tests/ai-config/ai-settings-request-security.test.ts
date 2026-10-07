import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  actor: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(),
  routing: vi.fn(), unsaved: vi.fn(), saved: vi.fn(), observed: vi.fn(),
}));
vi.mock("@/lib/auth/server-actor", () => ({ getServerActorContext: mocks.actor }));
vi.mock("@/lib/services/ai-config/service", () => ({
  createAIProvider: mocks.create, updateAIProvider: mocks.update,
  deleteAIProvider: mocks.remove, updateAIRouting: mocks.routing,
  testUnsavedAIProvider: mocks.unsaved, testSavedAIProvider: mocks.saved,
}));
vi.mock("@/app/api/_shared/ai-provider-observation", () => ({ observedAIJson: mocks.observed }));

import { POST as create } from "@/app/api/admin/ai-settings/providers/route";
import { PATCH as update, DELETE as remove } from "@/app/api/admin/ai-settings/providers/[id]/route";
import { PUT as routing } from "@/app/api/admin/ai-settings/routing/route";
import { POST as unsaved } from "@/app/api/admin/ai-settings/test/route";
import { POST as saved } from "@/app/api/admin/ai-settings/providers/[id]/test/route";

const origin = "https://app.example.com";
const id = "11111111-1111-4111-8111-111111111111";
const context = { params: Promise.resolve({ id }) };
const owner = { authUserId: "owner-auth", profileId: "owner-profile", isAnonymous: false, platformRole: "SUPER_ADMIN" };
const provider = { name: "Synthetic provider", providerType: "OPENAI_COMPATIBLE", baseUrl: "https://api.example.com/v1",
  model: "synthetic-model", capabilities: { text: true, vision: false, toolCalling: true, structuredOutput: true },
  status: "ACTIVE", apiKey: "synthetic-test-token", requestKey: id };
const targets = [
  { name: "create", method: "POST", invoke: create, body: provider, service: mocks.create, status: 201 },
  { name: "update", method: "PATCH", invoke: (request: Request) => update(request, context), body: { name: "Updated" }, service: mocks.update, status: 200 },
  { name: "delete", method: "DELETE", invoke: (request: Request) => remove(request, context), body: undefined, service: mocks.remove, status: 204 },
  { name: "routing", method: "PUT", invoke: routing, body: { routingMode: "SINGLE_MODEL", defaultProviderConfigId: id }, service: mocks.routing, status: 200 },
  { name: "unsaved test", method: "POST", invoke: unsaved, body: { providerType: provider.providerType, baseUrl: provider.baseUrl,
    model: provider.model, capabilities: provider.capabilities, apiKey: provider.apiKey }, service: mocks.unsaved, status: 200 },
  { name: "saved test", method: "POST", invoke: (request: Request) => saved(request, context), body: {}, service: mocks.saved, status: 200 },
];
function request(target: typeof targets[number], requestOrigin: string | null = origin, contentType: string | null = "application/json") {
  return new Request(`${origin}/api/admin/ai-settings/test`, {
    method: target.method,
    headers: { ...(requestOrigin ? { Origin: requestOrigin } : {}), ...(contentType ? { "Content-Type": contentType } : {}) },
    ...(target.body === undefined ? {} : { body: JSON.stringify(target.body) }),
  });
}

describe("AI settings mutation request security", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.actor.mockResolvedValue(owner);
    for (const target of targets) target.service.mockResolvedValue({ ok: true });
    mocks.observed.mockImplementation(async (_request, _task, action, onError) => {
      try { return NextResponse.json(await action()); } catch (error) { return onError(error); }
    });
  });

  describe.each(targets)("$name", (target) => {
    it.each(["https://sibling.example.com", "https://unrelated.invalid", null])("rejects untrusted or missing Origin %s before auth, parsing or dispatch", async (untrusted) => {
      const input = request(target, untrusted, "text/plain");
      expect((await target.invoke(input)).status).toBe(403);
      expect(input.bodyUsed).toBe(false);
      expect(mocks.actor).not.toHaveBeenCalled(); expect(target.service).not.toHaveBeenCalled();
      expect(mocks.observed).not.toHaveBeenCalled();
    });

    it("preserves authorized same-origin JSON and bodyless DELETE", async () => {
      const input = request(target, origin, target.method === "DELETE" ? null : "Application/JSON; charset=utf-8");
      expect((await target.invoke(input)).status).toBe(target.status);
      expect(mocks.actor).toHaveBeenCalledOnce(); expect(target.service).toHaveBeenCalledOnce();
    });

    it("rejects same-site JSON from a sibling origin before dispatch", async () => {
      const input = request(target, "https://sibling.example.com");
      expect((await target.invoke(input)).status).toBe(403);
      expect(input.bodyUsed).toBe(false); expect(target.service).not.toHaveBeenCalled();
    });

    it.each([null, { ...owner, platformRole: "USER" }, { ...owner, businessReady: false }, { ...owner, isAnonymous: true }])("keeps unauthorized identities denied before reading secrets", async (actor) => {
      mocks.actor.mockResolvedValue(actor);
      const input = request(target);
      expect((await target.invoke(input)).status).toBe(403);
      expect(input.bodyUsed).toBe(false); expect(target.service).not.toHaveBeenCalled();
    });

    if (target.method !== "DELETE") {
      it.each(["text/plain", "application/x-www-form-urlencoded", "application/jsonp", null])("rejects non-JSON media type %s without dispatch", async (mediaType) => {
        const input = request(target, origin, mediaType);
        expect((await target.invoke(input)).status).toBe(415);
        expect(input.bodyUsed).toBe(false); expect(target.service).not.toHaveBeenCalled();
        expect(mocks.observed).not.toHaveBeenCalled();
      });
    }
  });

  it("preserves a JSON-typed empty saved-provider test body and blank replacement credential", async () => {
    for (const body of [undefined, JSON.stringify({ apiKey: "" })]) {
      const input = new Request(`${origin}/api/admin/ai-settings/providers/${id}/test`, {
        method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body,
      });
      expect((await saved(input, context)).status).toBe(200);
    }
    expect(mocks.saved.mock.calls).toEqual([[id, {}], [id, { apiKey: "" }]]);
  });

  it("keeps malformed JSON a controlled error without provider dispatch", async () => {
    const input = new Request(`${origin}/api/admin/ai-settings/providers`, {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: "{",
    });
    const response = await create(input);
    expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ error: { code: "INVALID_JSON" } });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
