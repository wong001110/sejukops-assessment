import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const serverStore = readFileSync(
  resolve("src/lib/observability/ai-provider-observation-server.ts"),
  "utf8",
);
const persistentStore = readFileSync(
  resolve("src/lib/observability/ai-observation-store.ts"),
  "utf8",
);
const transport = readFileSync(
  resolve("src/lib/ai/providers/pinned-https.ts"),
  "utf8",
);
const helper = readFileSync(
  resolve("src/app/api/_shared/ai-provider-observation.ts"),
  "utf8",
);
const workspace = readFileSync(
  resolve("src/components/diagnostics/ai-observability-workspace.tsx"),
  "utf8",
);
const diagnosticsPage = readFileSync(
  resolve("src/app/diagnostics/ai-observability/page.tsx"),
  "utf8",
);
const operationsRoute = readFileSync(
  resolve("src/app/api/manager/ai-operations/route.ts"),
  "utf8",
);
const insightRoute = readFileSync(
  resolve("src/app/api/manager/operational-insight/route.ts"),
  "utf8",
);
const workflowRoute = readFileSync(
  resolve("src/app/api/manager/workflow-flags/[flagId]/explanation/route.ts"),
  "utf8",
);
const documentRoute = readFileSync(
  resolve("src/app/api/admin/document-imports/[id]/extract/route.ts"),
  "utf8",
);
const providerTestRoute = readFileSync(
  resolve("src/app/api/admin/ai-settings/test/route.ts"),
  "utf8",
);

describe("AI provider and execution observation", () => {
  it("captures the real pinned HTTPS provider exchange inside a request-scoped server context", () => {
    expect(transport).toContain("recordAIProviderExchange");
    expect(transport).toContain("target.endpoint.toString()");
    expect(transport).toContain('authorization: "[REDACTED]"');
    expect(transport).toContain("sanitizeAIProviderPayload(parsedRequestBody)");
    expect(transport).toContain("responsePayload(buffer, headers)");
    expect(serverStore).toContain("AsyncLocalStorage");
    expect(serverStore).toContain("Every supported AI route gets a server-owned observation context");
    expect(serverStore).not.toContain('get("x-sejuk-observe-ai") === "1"');
  });

  it("persists sanitized debug snapshots while keeping secrets and document values out", () => {
    expect(helper).toContain("persistAIObservation");
    expect(helper).toContain('response.headers.set("x-sejuk-trace-id"');
    expect(helper).not.toContain("__aiProviderObservation");
    expect(persistentStore).toContain("summarizeProviderCalls");
    expect(persistentStore).toContain("requestMetadata");
    expect(persistentStore).toContain("responseMetadata");
    expect(persistentStore).not.toContain("systemPromptFromBody");
    expect(persistentStore).toContain("rawPromptPersisted: false");
    expect(persistentStore).toContain("rawProviderResponsePersisted: false");
    expect(persistentStore).toContain("sanitizedDebugPayloadPersisted: true");
    expect(persistentStore).toContain("credentialsPersisted: false");
    expect(persistentStore).toContain("documentFieldValuesPersisted: false");
  });

  it("covers all implemented assessment AI entry points", () => {
    expect(operationsRoute).toContain('"OPERATIONS_QUERY"');
    expect(insightRoute).toContain('"OPERATIONAL_INSIGHT"');
    expect(workflowRoute).toContain('"WORKFLOW_EXPLANATION"');
    expect(documentRoute).toContain('"DOCUMENT_UNDERSTANDING"');
    expect(providerTestRoute).toContain('"PROVIDER_TEST"');
  });

  it("shows execution and safe provider metadata without prompt or response content", () => {
    expect(workspace).toContain("AI observability");
    expect(workspace).toContain("Execution trace");
    expect(workspace).toContain("Provider metadata");
    expect(workspace).toContain("Sanitized debug persistence");
    expect(persistentStore).toContain("LLM planner → approved operations tool");
    expect(workspace).toContain("prompt or response content");
  });

  it("keeps the diagnostics render path simple enough to hydrate before trace data loads", () => {
    expect(workspace).not.toContain('@ant-design/icons');
    expect(workspace).not.toContain("Descriptions.Item");
    expect(workspace).not.toContain("<Statistic");
    expect(workspace).not.toContain("Empty.PRESENTED_IMAGE_SIMPLE");
    expect(diagnosticsPage).not.toContain('@ant-design/icons');
    expect(diagnosticsPage).not.toContain('from "antd"');
  });
});
