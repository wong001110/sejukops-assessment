// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentWorkspace, OrdersWorkspace } from "../../src/app/workspaces/[workspaceId]/workspace-client";
import { KnowledgeAssistPanel } from "../../src/app/workspaces/[workspaceId]/knowledge-assist-panel";
import { deferred, jsonResponse } from "../helpers/ui-request";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

const order = (id: string, label = id) => ({ id, order_no: label, branch_id: "branch", status: "NEW", problem_description: "Fictional service request", service_type: "Inspection", scheduled_at: null, assigned_technician_id: null, updated_at: "2026-09-30T00:00:00Z" });
const workspaceId = "10000000-0000-4000-8000-000000000001";
const branchId = "20000000-0000-4000-8000-000000000001";
const firstOrderId = "50000000-0000-4000-8000-000000000001";
const secondOrderId = "50000000-0000-4000-8000-000000000002";
const runId = "b0000000-0000-4000-8000-000000000001";
const nativeOrder = (id: string, label: string) => ({ id, order_no: label, branch_id: branchId, status: "NEW",
  problem_description: `Fictional service request for ${label}`, service_type: "Inspection", scheduled_at: null,
  assigned_technician_id: null, updated_at: "2026-09-30T00:00:00.000Z" });
const nativeWorkspace = (title: string, orderId = firstOrderId) => ({ runId, workspaceId, mode: "mock" as const,
  type: "investigation" as const, title, summary: "Verified synthetic order data.", status: "COMPLETE" as const,
  items: [{ order: nativeOrder(orderId, orderId === firstOrderId ? "MOCK-001" : "MOCK-002"), interpretation: title }],
  excerpts: [], proposal: null, missingInformation: [], followUps: [],
  scope: { ordersRead: 1, knowledgeHits: 0, checkedAt: "2026-09-30T04:00:00.000Z" } });
const nativeResponse = (title: string, orderId = firstOrderId) => new Response([
  { type: "started", runId }, { type: "workspace", workspace: nativeWorkspace(title, orderId) },
].map((event) => JSON.stringify(event)).join("\n") + "\n", { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
const agent = (focusOrderId?: string, contextKey?: string) => <AgentWorkspace workspaceId={workspaceId} focusOrderId={focusOrderId}
  contextKey={contextKey} canAssign={false} manualTask={null} isGuest={false} />;

const scrollToDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
function mockNativeAgentDom() {
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: false, media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() })));
}
function sendAgentPrompt(prompt: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "Message the agent" }), { target: { value: prompt } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
}
function openAgentConversation() {
  fireEvent.click(screen.getByRole("button", { name: "Open conversation" }));
}
function nativeRequestBody(fetchMock: ReturnType<typeof vi.fn>, callIndex: number) {
  return JSON.parse(String((fetchMock.mock.calls[callIndex][1] as RequestInit).body));
}
function requestSignal(fetchMock: ReturnType<typeof vi.fn>, callIndex: number) {
  return (fetchMock.mock.calls[callIndex][1] as RequestInit).signal as AbortSignal;
}

afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks();
  if (scrollToDescriptor) Object.defineProperty(HTMLElement.prototype, "scrollTo", scrollToDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
});

describe("rendered workspace request lifecycle with synthetic responses", () => {
  it("selects an order through application history without replaying private router state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ orders: [order("selected-order")], generation: 1 })));
    const replace = vi.spyOn(window.history, "replaceState");
    window.history.replaceState({ __NA: true }, "", "/");
    replace.mockClear();
    render(<OrdersWorkspace workspaceId="mock-workspace" canAssign={false} canImport={false} canCreate={false} isGuest={false} canGuestAssign={false} canManagerReschedule={false} canAdvanceJob={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "View details" }));
    expect(window.location.search).toBe("?orderId=selected-order");
    // Next.js treats its private marker as an internal navigation and skips URL synchronization.
    const data = replace.mock.calls.at(-1)?.[0];
    expect(data?.__NA).not.toBe(true);
    expect(data?._N).not.toBe(true);
    expect(screen.getByRole("button", { name: "Selected", hidden: true }).getAttribute("aria-pressed")).toBe("true");
    replace.mockRestore();
    window.history.replaceState(null, "", "/");
  });

  it("ignores a cancelled request's late error while its retry is running", async () => {
    mockNativeAgentDom();
    const first = deferred<Response>();
    const second = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    vi.stubGlobal("fetch", fetchMock);
    render(agent());
    openAgentConversation();
    sendAgentPrompt("Review recent orders");
    fireEvent.click(screen.getByRole("button", { name: "Cancel request" }));
    expect(requestSignal(fetchMock, 0).aborted).toBe(true);
    sendAgentPrompt("Retry the order review");
    expect(requestSignal(fetchMock, 1).aborted).toBe(false);
    await act(async () => first.reject(new Error("Old request failed")));
    expect(screen.getByText("Request pending · waiting for execution events")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Send message" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Cancel request" })).toBeTruthy();
    await act(async () => second.resolve(nativeResponse("Current evidence")));
    expect(await screen.findByRole("heading", { name: "Current evidence" })).toBeTruthy();
    expect(screen.queryByText("Old request failed")).toBeNull();
  });

  it("aborts a focused request on remount and sends only the new order context", async () => {
    mockNativeAgentDom();
    const first = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce(nativeResponse("Second focus evidence", secondOrderId));
    vi.stubGlobal("fetch", fetchMock);
    const view = render(agent(firstOrderId, "admin-context"));
    openAgentConversation();
    sendAgentPrompt("Review the selected order");
    expect(nativeRequestBody(fetchMock, 0).contextOrderIds).toEqual([firstOrderId]);
    view.rerender(agent(secondOrderId, "manager-context"));
    expect(requestSignal(fetchMock, 0).aborted).toBe(true);
    expect(screen.queryByText("Review the selected order")).toBeNull();
    openAgentConversation();
    expect(screen.getByText("Selected order context retained")).toBeTruthy();
    sendAgentPrompt("Review the selected order");
    expect(nativeRequestBody(fetchMock, 1).contextOrderIds).toEqual([secondOrderId]);
    expect(await screen.findByRole("heading", { name: "Second focus evidence" })).toBeTruthy();
    await act(async () => first.resolve(nativeResponse("Obsolete focus evidence", firstOrderId)));
    expect(screen.queryByText("Obsolete focus evidence")).toBeNull();
  });

  it("aborts an in-flight agent stream when leaving the rendered component", () => {
    mockNativeAgentDom();
    const response = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValue(response.promise);
    vi.stubGlobal("fetch", fetchMock);
    const view = render(agent(firstOrderId));
    openAgentConversation();
    sendAgentPrompt("Inspect the selected order");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(nativeRequestBody(fetchMock, 0).contextOrderIds).toEqual([firstOrderId]);
    view.unmount();
    expect(requestSignal(fetchMock, 0).aborted).toBe(true);
  });

  it("keeps knowledge retry active when the cancelled attempt settles late", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise));
    render(<KnowledgeAssistPanel workspaceId="mock-workspace" isGuest={false} />);
    fireEvent.change(screen.getByLabelText("Question"), { target: { value: "Fictional filter replacement" } });
    fireEvent.click(screen.getByRole("button", { name: /Find cited excerpts/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: /Find cited excerpts/ }));
    await act(async () => first.reject(new Error("Old knowledge failure")));
    expect(screen.getByText("Searching published knowledge…")).toBeTruthy();
    await act(async () => second.resolve(jsonResponse({ status: "INSUFFICIENT", answer: "No supported source yet", excerpts: [], activity: [{ type: "KNOWLEDGE_SEARCH", hitCount: 0 }], traceId: "mock-trace" })));
    expect(await screen.findByText("No supported source yet")).toBeTruthy();
    expect(screen.queryByText("Old knowledge failure")).toBeNull();
  });

  it("keeps the newest Orders refresh and hides detail actions while loading", async () => {
    const old = deferred<Response>();
    const newest = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ orders: [order("initial")], generation: 1 }))
      .mockReturnValueOnce(old.promise).mockReturnValueOnce(newest.promise));
    render(<OrdersWorkspace workspaceId="mock-workspace" canAssign={false} canImport={false} canCreate={false} isGuest={false} canGuestAssign={false} canManagerReschedule={false} canAdvanceJob={false} />);
    expect(await screen.findByText("initial")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "View details" }));
    expect(await screen.findByRole("button", { name: "AI Assist" })).toBeTruthy();
    // Synthetic refresh events exercise racing reads with the detail Drawer open.
    // The mask prevents these background pointer clicks in a normal user journey.
    fireEvent.click(screen.getByRole("button", { name: /Refresh/, hidden: true }));
    fireEvent.click(screen.getByRole("button", { name: /Refresh/, hidden: true }));
    expect(screen.queryByRole("button", { name: "AI Assist" })).toBeNull();
    expect(screen.queryByRole("link", { name: /Open this order in AI Workspace/ })).toBeNull();
    await act(async () => newest.resolve(jsonResponse({ orders: [order("newest")], generation: 2 })));
    await waitFor(() => expect(screen.getAllByText("newest").length).toBeGreaterThan(0));
    await act(async () => old.resolve(jsonResponse({ orders: [order("obsolete")], generation: 1 })));
    expect(screen.queryByText("obsolete")).toBeNull();
  });
});
