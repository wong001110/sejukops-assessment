// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfigProvider } from "antd";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AIObservabilityPagedWorkspace } from "../../src/components/diagnostics/ai-observability-paged-workspace";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/diagnostics/ai-observability",
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("AI observation provider-call labels", () => {
  it.each([
    { task: "WORKSPACE_ORDERS", flow: "Bounded workspace orders agent", providerSteps: 2 },
    { task: "DOCUMENT_UNDERSTANDING", flow: "Document extraction to editable draft; explicit confirmation required", providerSteps: 1 },
  ])("shows aggregate provider metadata for $task without recorded call entries", async ({ task, flow, providerSteps }) => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        retentionDays: 7,
        observations: [{
          id: "11111111-1111-4111-8111-111111111111",
          traceId: "22222222-2222-4222-8222-222222222222",
          createdAt: "2026-09-30T01:00:00.000Z",
          task,
          actorRole: "SUPER_ADMIN",
          status: "SUCCEEDED",
          durationMs: 7296,
          execution: { flow, providerSteps, inputTokens: 884, outputTokens: 521 },
          providerCalls: [],
          errorCode: null,
          safety: { rawPromptPersisted: false, rawProviderResponsePersisted: false, sanitizedDebugPayloadPersisted: false, credentialsPersisted: false, documentFieldValuesPersisted: false },
        }],
        pagination: { page: 1, pageSize: 12, total: 1, totalPages: 1, hasMore: false },
        summary: { runs: 1, providerCalls: 0, controlled: 0, failures: 0, averageLatency: 7296 },
      }),
    }));

    render(<ConfigProvider><QueryClientProvider client={queryClient}><AIObservabilityPagedWorkspace /></QueryClientProvider></ConfigProvider>);

    expect(await screen.findByText("Recorded provider calls")).toBeTruthy();
    expect(screen.getByText(/Workspace agent and document extraction runs record providerSteps and aggregate token usage/)).toBeTruthy();
    expect(await screen.findByText("Configured model")).toBeTruthy();
    expect(screen.getByText("884 in / 521 out")).toBeTruthy();

    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByRole("button", { name: flow }));
    expect(await screen.findByText("This run records providerSteps and aggregate token usage; individual provider-call entries and payloads are not retained.")).toBeTruthy();
    await act(async () => { queryClient.clear(); });
  });
});
