import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MockLanguageModelV3 } from "ai/test";
import { OPERATIONS_ASK_FAILURE_REASONS, OPERATIONS_SDK_ERROR_KINDS, operationsAskFailureMessage, operationsSdkErrorKind, type OperationsAskFailureReason } from "./operations-ask-diagnostics";
import { OPERATIONS_ASK_FAILURE_REASONS as runtimeReasons, OperationsAskError, runOperationsAsk } from "./operations-ask";

const fallback = "Operations AI is unavailable. Search orders or published knowledge manually.";
const invalidSource = "The AI response could not be verified against current sources. No unverified answer was shown. Try again or search manually.";
const invalidTool = "The AI did not complete a valid evidence lookup. Try a specific order number or search manually.";
const expected: Record<OperationsAskFailureReason, string> = {
  ACCESS_DENIED: fallback, SCOPE_CHANGED: fallback, INVALID_SCOPE_GENERATION: fallback,
  PROVIDER_UNAVAILABLE: "AI configuration is unavailable for this request. Search manually or ask an administrator to check AI settings.",
  PROVIDER_FAILURE: "The AI provider request failed. No verified answer is available; try again or search manually.",
  TOOL_INPUT_INVALID: invalidTool, TOOL_READ_FAILED: fallback, TOOL_INCOMPLETE: invalidTool,
  INVALID_JSON: invalidSource, INVALID_SELECTION: invalidSource, INVALID_EXCERPT: invalidSource,
  ORDER_CHANGED: fallback, KNOWLEDGE_CHANGED: fallback, CANCELLED_TIMEOUT: fallback,
  ALLOWANCE_EXHAUSTED: fallback, ALLOWANCE_UNAVAILABLE: fallback, UNEXPECTED_FAILURE: fallback,
};
function namedError(name: string, cause?: Error) {
  const error = new Error("PRIVATE_MESSAGE PRIVATE_SOURCE PRIVATE_SECRET", cause ? { cause } : undefined);
  error.name = name;
  Object.assign(error, { payload: "PRIVATE_MODEL_PAYLOAD", headers: { Authorization: "Bearer PRIVATE_CREDENTIAL" } });
  return error;
}

describe("Operations bounded SDK error classifier", () => {
  it("defines only fixed diagnostic categories", () => {
    expect([...OPERATIONS_SDK_ERROR_KINDS].sort()).toEqual(["RESPONSE_VALIDATION", "TOOL_CHOICE", "API_CALL", "NO_OUTPUT", "ABORTED", "OTHER"].sort());
    expect(new Set(OPERATIONS_SDK_ERROR_KINDS).size).toBe(6);
  });
  it.each([
    ["AI_TypeValidationError", "RESPONSE_VALIDATION"], ["AI_InvalidResponseDataError", "RESPONSE_VALIDATION"],
    ["AI_JSONParseError", "RESPONSE_VALIDATION"], ["AI_APICallError", "API_CALL"],
    ["AI_ToolChoiceViolationError", "TOOL_CHOICE"],
    ["AI_NoOutputGeneratedError", "NO_OUTPUT"], ["AbortError", "ABORTED"], ["TimeoutError", "ABORTED"],
    ["PRIVATE_UNRECOGNIZED_ERROR", "OTHER"],
  ])("classifies %s without copying its raw payload", (name, kind) => {
    const value = operationsSdkErrorKind(namedError(name));
    expect(value).toBe(kind); expect(OPERATIONS_SDK_ERROR_KINDS).toContain(value);
    expect(value).not.toContain("PRIVATE_");
  });
  it("finds response validation inside an API-call wrapper", () => {
    expect(operationsSdkErrorKind(namedError("AI_APICallError", namedError("AI_TypeValidationError")))).toBe("RESPONSE_VALIDATION");
  });
  it("retains API-call classification when its transport cause is an ordinary Error", () => {
    expect(operationsSdkErrorKind(namedError("AI_APICallError", namedError("Error")))).toBe("API_CALL");
  });
  it("finds a tool-choice violation inside an API-call wrapper", () => {
    expect(operationsSdkErrorKind(namedError("AI_APICallError", namedError("AI_ToolChoiceViolationError")))).toBe("TOOL_CHOICE");
  });
  it("reads at most four errors in a cause chain", () => {
    let withinBound = namedError("AI_JSONParseError");
    for (let index = 0; index < 3; index += 1) withinBound = namedError("Error", withinBound);
    expect(operationsSdkErrorKind(withinBound)).toBe("RESPONSE_VALIDATION");
    expect(operationsSdkErrorKind(namedError("Error", withinBound))).toBe("OTHER");
  });
  it("bounds cyclic causes without examining messages, payloads or stack text", () => {
    const error = namedError("Error");
    Object.defineProperty(error, "cause", { value: error });
    const inspectMessage = vi.fn(() => { throw new Error("Message inspected"); });
    const inspectPayload = vi.fn(() => { throw new Error("Payload inspected"); });
    Object.defineProperty(error, "message", { get: inspectMessage });
    Object.defineProperty(error, "payload", { get: inspectPayload });
    expect(operationsSdkErrorKind(error)).toBe("OTHER");
    expect(inspectMessage).not.toHaveBeenCalled(); expect(inspectPayload).not.toHaveBeenCalled();
  });
  it.each([null, undefined, "PRIVATE_PROVIDER_MESSAGE", { name: "AI_TypeValidationError", message: "PRIVATE_MODEL_PROSE" }])(
    "treats non-Error throwables as OTHER without stringifying them: %s", (input) => {
      expect(operationsSdkErrorKind(input)).toBe("OTHER");
    });
});

describe("Operations runtime SDK-failure wrapping", () => {
  it.each(["current", "reset", "revoked"] as const)("handles an actual SDK no-lookup response with fresh %s scope", async (scopeState) => {
    const workspaceId = "11111111-1111-4111-8111-111111111111";
    const profileId = "22222222-2222-4222-8222-222222222222";
    const model = new MockLanguageModelV3({ doGenerate: async () => ({
      content: [{ type: "text", text: "PRIVATE_UNVERIFIED_MODEL_ANSWER PRIVATE_SOURCE PRIVATE_SECRET" }],
      finishReason: { unified: "stop", raw: undefined },
      usage: { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 1, text: 1, reasoning: undefined } }, warnings: [],
    }) });
    const readOrders = vi.fn(async () => ({ workspaceId, orders: [] }));
    const searchKnowledge = vi.fn(async () => []);
    const beforeProviderCall = vi.fn(async () => {});
    const outcome = await runOperationsAsk({ authUserId: profileId, profileId, isAnonymous: false, platformRole: "USER",
      membership: { workspaceId, kind: "OWNER", role: "ADMIN" } }, {} as SupabaseClient,
    { workspaceId, question: "Show my scoped jobs." }, { beforeProviderCall, revalidateScope: async () => {
      if (model.doGenerateCalls.length > 0 && scopeState === "revoked") throw new OperationsAskError("FORBIDDEN");
      return model.doGenerateCalls.length > 0 && scopeState === "reset" ? 2 : 1;
    } }, {
      resolveProvider: async () => ({ providerType: "OPENAI_COMPATIBLE", model: "fictional-test", apiKey: "fictional-not-a-key",
        baseUrl: "https://provider.example/v1", capabilities: { text: true, toolCalling: true, structuredOutput: true, vision: false } }),
      createModel: () => model, readOrders, searchKnowledge,
    }).catch((value: unknown) => value);
    if (scopeState === "current") {
      expect(outcome).toEqual({ status: "INSUFFICIENT",
        answer: "The AI did not perform an evidence lookup for this request. No answer was verified. Try a specific order number or search manually.",
        orders: [], excerpts: [], activity: [], providerSteps: 1, usage: {},
        diagnostics: { failureReason: "TOOL_INCOMPLETE", sdkErrorKind: "TOOL_CHOICE" } });
      expect(JSON.stringify(outcome)).not.toContain("PRIVATE_");
    } else {
      expect(outcome).toBeInstanceOf(OperationsAskError);
      expect(outcome).toMatchObject({ code: scopeState === "reset" ? "STALE" : "FORBIDDEN",
        reason: scopeState === "reset" ? "SCOPE_CHANGED" : "ACCESS_DENIED" });
      expect(outcome).not.toHaveProperty("status");
    }
    expect(model.doGenerateCalls).toHaveLength(1); expect(beforeProviderCall).toHaveBeenCalledTimes(1);
    expect(readOrders).not.toHaveBeenCalled(); expect(searchKnowledge).not.toHaveBeenCalled();
  });
  it.each([
    ["AI_TypeValidationError", "RESPONSE_VALIDATION"], ["AI_ToolChoiceViolationError", "TOOL_CHOICE"],
    ["AI_NoOutputGeneratedError", "NO_OUTPUT"],
  ])("retains only the fixed kind for an actual SDK-loop %s failure", async (name, kind) => {
    const workspaceId = "11111111-1111-4111-8111-111111111111";
    const profileId = "22222222-2222-4222-8222-222222222222";
    const model = new MockLanguageModelV3({ doGenerate: async () => { throw namedError("AI_APICallError", namedError(name)); } });
    const readOrders = vi.fn(async () => ({ workspaceId, orders: [] }));
    const searchKnowledge = vi.fn(async () => []);
    const error = await runOperationsAsk({ authUserId: profileId, profileId, isAnonymous: false, platformRole: "USER",
      membership: { workspaceId, kind: "OWNER", role: "ADMIN" } }, {} as SupabaseClient,
    { workspaceId, question: "Show my scoped jobs." }, { revalidateScope: async () => 1 }, {
      resolveProvider: async () => ({ providerType: "OPENAI_COMPATIBLE", model: "fictional-test", apiKey: "fictional-not-a-key",
        baseUrl: "https://provider.example/v1", capabilities: { text: true, toolCalling: true, structuredOutput: true, vision: false } }),
      createModel: () => model, readOrders, searchKnowledge,
    }).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(OperationsAskError);
    expect(error).toMatchObject({ code: "UNAVAILABLE", reason: kind === "TOOL_CHOICE" ? "TOOL_INCOMPLETE" : "PROVIDER_FAILURE", sdkErrorKind: kind, message: "Operations assistant unavailable" });
    expect(error).not.toHaveProperty("cause"); expect(error).not.toHaveProperty("payload");
    expect(JSON.stringify(error)).not.toContain("PRIVATE_");
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(readOrders).not.toHaveBeenCalled(); expect(searchKnowledge).not.toHaveBeenCalled();
  });
});

describe("Operations fixed failure messages", () => {
  it("shares the exact allowlist with the runtime error contract", () => {
    expect(runtimeReasons).toBe(OPERATIONS_ASK_FAILURE_REASONS);
    expect(new Set(OPERATIONS_ASK_FAILURE_REASONS).size).toBe(17);
    expect(Object.keys(expected).sort()).toEqual([...OPERATIONS_ASK_FAILURE_REASONS].sort());
  });
  it.each(OPERATIONS_ASK_FAILURE_REASONS)("uses the fixed public message for %s", (reason) => {
    expect(operationsAskFailureMessage(reason)).toBe(expected[reason]);
  });
  it("does not echo fabricated reason text or inspect a payload object's prose", () => {
    const untrusted = "PRIVATE_MODEL_PROSE PRIVATE_PROVIDER_ERROR PRIVATE_SOURCE_TEXT Bearer fictional-secret";
    expect(operationsAskFailureMessage(untrusted as OperationsAskFailureReason)).toBe(fallback);
    const toString = vi.fn(() => untrusted);
    expect(operationsAskFailureMessage({ toString, message: untrusted } as unknown as OperationsAskFailureReason)).toBe(fallback);
    expect(toString).not.toHaveBeenCalled();
  });
});
