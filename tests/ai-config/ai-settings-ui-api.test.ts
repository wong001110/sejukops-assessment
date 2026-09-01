import { afterEach, describe, expect, it, vi } from "vitest";

import { aiSettingsApi } from "../../src/components/admin/ai-settings/ai-settings-api";

const ok = (body: unknown = { ok: true, checkedAt: "2026-08-10T00:00:00.000Z" }) => ({ ok: true, status: 200, json: async () => body }) as Response;
const input = { name: "Test", providerType: "OPENAI_COMPATIBLE", baseUrl: "https://api.example.com/v1", model: "model", status: "ACTIVE", capabilities: { text: true, vision: false, toolCalling: true, structuredOutput: true }, apiKey: "secret" } as const;
const requestKey = "0d350bbd-4782-44d9-bd27-1962e610930e";

describe("Admin AI settings browser adapter", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it("tests an unsaved provider without sending UI-only name or status", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(ok());
    vi.stubGlobal("fetch", fetchMock);
    await aiSettingsApi.testUnsavedProvider(input);
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)) as Record<string, unknown>;
    expect(body).not.toHaveProperty("name");
    expect(body).not.toHaveProperty("status");
    expect(body).toMatchObject({ baseUrl: input.baseUrl, model: input.model, apiKey: input.apiKey });
  });

  it("sends discriminated full-replacement routing payloads", async () => {
    const snapshot = { canManage: false, settings: { routingMode: "SINGLE_MODEL", defaultProviderConfigId: null, updatedAt: null }, providers: [], routes: { OPERATIONS_QUERY: null, WORKFLOW_EXPLANATION: null, OPERATIONAL_INSIGHT: null, DOCUMENT_UNDERSTANDING: null } };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(ok(snapshot)).mockResolvedValue(ok(snapshot));
    vi.stubGlobal("fetch", fetchMock);
    await aiSettingsApi.updateRouting({ routingMode: "SINGLE_MODEL", defaultProviderConfigId: null });
    await aiSettingsApi.updateRouting({ routingMode: "TASK_BASED", routes: snapshot.routes });
    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>);
    expect(bodies[0]).toEqual({ routingMode: "SINGLE_MODEL", defaultProviderConfigId: null });
    expect(bodies[1]).toEqual({ routingMode: "TASK_BASED", routes: snapshot.routes });
  });

  it("omits a blank replacement key so PATCH preserves the saved credential", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(ok({ provider: {} }));
    vi.stubGlobal("fetch", fetchMock);
    const withoutKey = Object.fromEntries(Object.entries(input).filter(([key]) => key !== "apiKey")) as Omit<typeof input, "apiKey">;
    await aiSettingsApi.updateProvider("provider-1", withoutKey);
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)) as Record<string, unknown>;
    expect(body).not.toHaveProperty("apiKey");
  });

  it("sends the caller-owned stable request key only on provider CREATE", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(ok({ provider: {} }));
    vi.stubGlobal("fetch", fetchMock);
    await aiSettingsApi.createProvider({ ...input, requestKey });
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)) as Record<string, unknown>;
    expect(body.requestKey).toBe(requestKey);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/admin/ai-settings/providers");
  });
});
