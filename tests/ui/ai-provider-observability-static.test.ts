import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const serverStore = readFileSync(resolve("src/lib/observability/ai-provider-observation-server.ts"), "utf8");
const clientStore = readFileSync(resolve("src/lib/observability/ai-provider-observation-client.ts"), "utf8");
const transport = readFileSync(resolve("src/lib/ai/providers/pinned-https.ts"), "utf8");
const browserObserver = readFileSync(resolve("src/lib/observability/api-observation.ts"), "utf8");
const helper = readFileSync(resolve("src/app/api/_shared/ai-provider-observation.ts"), "utf8");
const workspace = readFileSync(resolve("src/components/admin/api-observability/api-observability-workspace.tsx"), "utf8");
const providerPanel = readFileSync(resolve("src/components/admin/api-observability/ai-provider-traces.tsx"), "utf8");
const operationsRoute = readFileSync(resolve("src/app/api/manager/ai-operations/route.ts"), "utf8");
const documentRoute = readFileSync(resolve("src/app/api/admin/document-imports/[id]/extract/route.ts"), "utf8");

describe("AI provider request/response observation", () => {
  it("captures the real pinned HTTPS provider exchange with secret and base64 redaction", () => {
    expect(transport).toContain("recordAIProviderExchange");
    expect(transport).toContain("target.endpoint.toString()");
    expect(transport).toContain('authorization: "[REDACTED]"');
    expect(transport).toContain("sanitizeAIProviderPayload(parsedRequestBody)");
    expect(transport).toContain("sanitizeAIProviderPayload(responsePayload(buffer, headers))");
    expect(serverStore).toContain("AsyncLocalStorage");
    expect(serverStore).toContain("DATA_URL");
  });

  it("only enables provider debug envelopes for supported AI routes and strips them before strict clients parse", () => {
    expect(browserObserver).toContain('requestHeaders.set("x-sejuk-observe-ai", "1")');
    expect(browserObserver).toContain("captureAIProviderObservation(rawResponse)");
    expect(clientStore).toContain('const DEBUG_KEY = "__aiProviderObservation"');
    expect(clientStore).toContain("delete clean[DEBUG_KEY]");
    expect(helper).toContain('const DEBUG_KEY = "__aiProviderObservation"');
  });

  it("covers the major assessment AI entry points", () => {
    expect(operationsRoute).toContain('"OPERATIONS_QUERY"');
    expect(documentRoute).toContain('"DOCUMENT_UNDERSTANDING"');
    expect(clientStore).toContain("/api/manager/operational-insight");
    expect(clientStore).toContain("workflow-flags");
    expect(clientStore).toContain("ai-settings/providers");
  });

  it("surfaces provider request and raw response as the primary observation area", () => {
    expect(workspace).toContain("AI & API traces");
    expect(workspace).toContain("<AIProviderTraces />");
    expect(providerPanel).toContain("Provider request / response");
    expect(providerPanel).toContain('label: "Provider Request"');
    expect(providerPanel).toContain('label: "Provider Response"');
    expect(providerPanel).toContain("appTraceId");
  });
});
