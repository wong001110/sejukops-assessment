// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NativeAgentEvent, NativeWorkspace } from "@/domain/agent-workspace/contracts";
const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a> }));
import { NativeAgentWorkspace } from "./native-agent-workspace";
const id = "10000000-0000-4000-8000-000000000001";
const orderId = "50000000-0000-4000-8000-000000000001";
const result: NativeWorkspace = {
  workspaceId: id, runId: id, mode: "mock", type: "investigation", title: "Synthetic source investigation", summary: "Fictional source records only.", status: "COMPLETE",
  items: [{ order: { id: orderId, branch_id: id, order_no: "MOCK-NATIVE", service_type: "Filter inspection", problem_description: "Fictional request", status: "ASSIGNED", scheduled_at: null, assigned_technician_id: id, updated_at: "2026-10-05T00:00:00Z" }, interpretation: "Assigned source record." }],
  excerpts: [], proposal: null, missingInformation: [], followUps: [], scope: { ordersRead: 1, knowledgeHits: 0, checkedAt: "2026-10-05T00:00:00Z" },
};
const response = (workspace = result) => new Response([JSON.stringify({ type: "started", runId: id }), JSON.stringify({ type: "workspace", workspace })].join("\n") + "\n", { headers: { "content-type": "application/x-ndjson" } });
function deferredStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const cancelled = vi.fn();
  const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; }, cancel: cancelled });
  return {
    response: new Response(body, { headers: { "content-type": "application/x-ndjson" } }), cancelled,
    async event(event: NativeAgentEvent) { await act(async () => { controller.enqueue(new TextEncoder().encode(`${JSON.stringify(event)}\n`)); }); },
    async close() { await act(async () => { controller.close(); }); },
  };
}
const props = { workspaceId: id, canAssign: false, manualTask: null, isGuest: false } as const;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(async () => response()));
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const user = () => userEvent.setup({ delay: null });
async function send(text: string) {
  if (!screen.queryByRole("textbox", { name: "Message the agent" })) await user().click(screen.getByRole("button", { name: "Open conversation" }));
  await user().type(screen.getByRole("textbox", { name: "Message the agent" }), text);
  await user().click(screen.getByRole("button", { name: "Send message" }));
}
describe("native floating conversation actual component", () => {
  function studioFetch() {
    vi.mocked(fetch).mockImplementation(async (url) => String(url).includes("ai-sessions?")
      ? Response.json({ sessions: [], nextCursor: null, workspaces: [] }) : response());
  }
  it("keeps studio conversation available while results open, close and expand without starting another run", async () => {
    studioFetch();
    render(<NativeAgentWorkspace {...props} presentation="studio" />);
    expect(screen.queryByRole("button", { name: "Open conversation" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Minimize conversation" })).toBeNull();
    await send("Inspect in studio"); await screen.findByText("MOCK-NATIVE");
    await user().click(screen.getByRole("button", { name: "Expand results" }));
    expect(document.querySelector(".native-studio-grid.is-maximized")).toBeTruthy();
    await user().keyboard("{Escape}");
    expect(document.querySelector(".native-studio-grid.is-maximized")).toBeNull();
    await user().click(screen.getByRole("button", { name: "Close results" }));
    expect(screen.queryByRole("region", { name: "Business results" })).toBeNull();
    await user().click(screen.getByRole("button", { name: "Show results" }));
    expect(screen.getByText("MOCK-NATIVE")).toBeTruthy();
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith("/agent/run"))).toHaveLength(1);
  });
  it("starts a clean studio conversation and aborts an unfinished run", async () => {
    const stream = deferredStream();
    vi.mocked(fetch).mockImplementation(async (url) => String(url).includes("ai-sessions?")
      ? Response.json({ sessions: [], nextCursor: null, workspaces: [] }) : stream.response);
    render(<NativeAgentWorkspace {...props} presentation="studio" focusOrderId={orderId} />);
    await send("Pending studio request");
    const call = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith("/agent/run"))!;
    await user().click(screen.getByRole("button", { name: "Start new conversation" }));
    expect((call[1]?.signal as AbortSignal).aborted).toBe(true);
    expect(screen.queryByText("Pending studio request")).toBeNull();
    expect(screen.queryByRole("region", { name: "Agent execution" })).toBeNull();
    expect(screen.queryByText("Selected order context retained")).toBeNull();
    expect(screen.getByRole("textbox", { name: "Message the agent" })).toBeTruthy();
  });
  it("leaves studio results inspectable after a provider failure while disabling earlier actions", async () => {
    studioFetch(); render(<NativeAgentWorkspace {...props} presentation="studio" />);
    await send("Successful first run"); await screen.findByText("MOCK-NATIVE");
    vi.mocked(fetch).mockImplementation(async (url) => String(url).includes("ai-sessions?")
      ? Response.json({ sessions: [], nextCursor: null, workspaces: [] }) : Response.json({}, { status: 503 }));
    await send("Failed follow-up");
    await waitFor(() => expect(screen.getAllByText("Request not completed").length).toBeGreaterThan(0));
    expect(screen.getByText("MOCK-NATIVE")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Investigate order" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Earlier result")).toBeTruthy();
  });
  it("keeps embedded conversation available after Escape and a completed mobile request", async () => {
    const matchMedia = window.matchMedia;
    window.matchMedia = vi.fn((query: string) => ({ matches: query.includes("max-width"), media: query, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(), onchange: null }));
    try {
      render(<NativeAgentWorkspace {...props} presentation="embedded" />);
      expect(screen.queryByRole("button", { name: "Minimize conversation" })).toBeNull();
      await user().keyboard("{Escape}");
      expect(screen.getByRole("textbox", { name: "Message the agent" })).toBeTruthy();
      await send("Inspect on mobile");
      await screen.findByText("MOCK-NATIVE");
      expect(screen.getByRole("textbox", { name: "Message the agent" })).toBeTruthy();
    } finally { window.matchMedia = matchMedia; }
  });
  it("reuses a conversation correlation ID and starts a distinct ID after New conversation", async () => {
    render(<NativeAgentWorkspace {...props} />);
    await send("First request"); await screen.findByText("MOCK-NATIVE");
    await send("Follow up"); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const header = (index: number) => new Headers(vi.mocked(fetch).mock.calls[index][1]?.headers).get("X-Sejuk-Session");
    const first = header(0); expect(first).toMatch(/^[0-9a-f-]{36}$/); expect(header(1)).toBe(first);
    await user().click(screen.getByRole("button", { name: "New conversation" }));
    await send("Separate conversation"); await screen.findByText("MOCK-NATIVE");
    expect(header(2)).not.toBe(first);
  });
  it("restores a recorded proposal with no execution or current-context replay", async () => {
    const proposal: NonNullable<NativeWorkspace["proposal"]> = { id: orderId, status: "PENDING", orderNo: "MOCK-NATIVE", technicianLabel: "Mock technician",
      canonicalPayload: { orderId, technicianId: id, scheduledAt: null }, targetUpdatedAt: "2026-10-05T00:00:00Z", expiresAt: "2099-10-05T00:00:00Z" };
    const session = { id: orderId, workspaceId: id, workspaceKind: "OWNER", title: "Saved inspection", surface: "WORKSPACE", role: "ADMIN", createdAt: "2026-10-05T00:00:00Z", updatedAt: "2026-10-05T00:00:00Z", turnCount: 1 };
    vi.mocked(fetch).mockImplementation(async (url) => {
      if (String(url).includes("ai-sessions/")) return Response.json({ session, turns: [{ id, question: "Saved request", answer: "Saved answer", status: "COMPLETED", createdAt: session.createdAt, completedAt: session.updatedAt, workspace: { ...result, proposal }, activity: [] }] });
      if (String(url).includes("ai-sessions?")) return Response.json({ sessions: [session], nextCursor: null, workspaces: [{ id, kind: "OWNER", name: "Owner" }] });
      if (String(url).includes("assignment-proposals")) return Response.json({ proposal, previewToken: "a".repeat(64) });
      return response();
    });
    render(<NativeAgentWorkspace {...props} canAssign />);
    await user().click(screen.getByRole("button", { name: "Conversation history" }));
    await user().click(await screen.findByRole("button", { name: /Saved inspection/ }));
    await screen.findByText("Historical conversation");
    const confirm = await screen.findByRole("button", { name: "Confirm and execute assignment" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true); await user().click(confirm);
    expect(vi.mocked(fetch).mock.calls.some(([, options]) => options?.method === "POST")).toBe(false);
    await send("Check current records"); await waitFor(() => expect(screen.queryByText("Historical conversation")).toBeNull());
    const call = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes("/agent/run"))!;
    expect(JSON.parse(call[1]?.body as string).contextOrderIds).toEqual([]);
    expect(new Headers(call[1]?.headers).get("X-Sejuk-Session")).toBe(orderId);
  });
  it("shows pending separately, updates actual streamed tool rows, then collapses completed execution beside the transcript", async () => {
    const stream = deferredStream();
    vi.mocked(fetch).mockResolvedValueOnce(stream.response);
    render(<NativeAgentWorkspace {...props} />);
    await send("Inspect with actual streamed events");
    const panel = screen.getByRole("region", { name: "Agent execution" });
    expect(within(panel).getByText("Request pending · waiting for execution events")).toBeTruthy();
    expect(panel.querySelectorAll("[data-tool-status]")).toHaveLength(0);
    await stream.event({ type: "started", runId: id });
    await stream.event({ type: "activity", activity: { id: orderId, tool: "readOrder", status: "running" } });
    expect(within(panel).getByText("Read an order")).toBeTruthy();
    expect(panel.querySelectorAll('[data-tool-status="running"]')).toHaveLength(1);
    expect(within(screen.getByRole("log")).queryByText("Read an order")).toBeNull();
    await stream.event({ type: "activity", activity: { id: orderId, tool: "readOrder", status: "succeeded", count: 1 } });
    expect(panel.querySelectorAll("[data-tool-status]")).toHaveLength(1);
    expect(within(panel).getByText("succeeded · 1 returned")).toBeTruthy();
    expect(within(panel).getByText("Waiting for the next execution event or result.")).toBeTruthy();
    await stream.event({ type: "workspace", workspace: result });
    await stream.close();
    await screen.findByText("MOCK-NATIVE");
    expect(within(panel).getByRole("status").textContent).toBe("Completed");
    expect(panel.querySelectorAll("[data-tool-status]")).toHaveLength(0);
    await user().click(within(panel).getByRole("button", { name: "Show tool activity" }));
    expect(panel.querySelectorAll('[data-tool-status="succeeded"]')).toHaveLength(1);
    const conversation = screen.getByRole("region", { name: "Agent conversation" });
    expect(Array.from(conversation.children).map((element) => element.className)).toEqual([
      "", "native-messages", "native-execution ", "native-composer",
    ]);
  });
  it("retains the previous canvas with disabled actions while pending and after cancellation, keeping actual completed and unfinished events", async () => {
    render(<NativeAgentWorkspace {...props} />);
    await send("First request");
    await screen.findByText("MOCK-NATIVE");
    const stream = deferredStream();
    vi.mocked(fetch).mockResolvedValueOnce(stream.response);
    await send("Slow follow up");
    expect(screen.getByText("Earlier result")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Investigate order" }) as HTMLButtonElement).disabled).toBe(true);
    await stream.event({ type: "started", runId: id });
    await stream.event({ type: "activity", activity: { id, tool: "recentOrders", status: "succeeded", count: 1 } });
    await stream.event({ type: "activity", activity: { id: orderId, tool: "readOrder", status: "running" } });
    await user().click(screen.getByRole("button", { name: "Cancel request" }));
    await waitFor(() => expect(stream.cancelled).toHaveBeenCalled());
    expect(screen.getByText("MOCK-NATIVE")).toBeTruthy();
    const panel = screen.getByRole("region", { name: "Agent execution" });
    expect(within(panel).getByRole("status").textContent).toBe("Stopped");
    await user().click(within(panel).getByRole("button", { name: "Show tool activity" }));
    expect(within(panel).getByText("succeeded · 1 returned")).toBeTruthy();
    expect(within(panel).getByText("Stopped waiting")).toBeTruthy();
    expect(within(panel).getByText("Last event: running. No completion event received.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Investigate order" }) as HTMLButtonElement).disabled).toBe(true);
    await user().click(screen.getByRole("button", { name: "Minimize conversation" }));
    await user().click(screen.getByRole("button", { name: "Open conversation" }));
    expect(within(screen.getByRole("region", { name: "Agent execution" })).getByText("Stopped")).toBeTruthy();
    await send("A fresh request");
    await waitFor(() => expect(screen.queryByText("Earlier result")).toBeNull());
    expect((screen.getByRole("button", { name: "Investigate order" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText("Stopped waiting")).toBeNull();
  });
  it("shows failed tool and unconfirmed outcomes from a real error stream without converting them to success", async () => {
    const stream = deferredStream();
    vi.mocked(fetch).mockResolvedValueOnce(stream.response);
    render(<NativeAgentWorkspace {...props} />);
    await send("A failing run");
    await stream.event({ type: "started", runId: id });
    await stream.event({ type: "activity", activity: { id, tool: "recentOrders", status: "running" } });
    await stream.event({ type: "activity", activity: { id: orderId, tool: "readOrder", status: "failed" } });
    await stream.event({ type: "error", code: "UNAVAILABLE", message: "Synthetic provider failure" });
    await stream.close();
    const panel = screen.getByRole("region", { name: "Agent execution" });
    await waitFor(() => expect(within(panel).getByRole("status").textContent).toBe("Failed"));
    expect(within(panel).getByText("0 completed · 1 failed · 2 tools")).toBeTruthy();
    await user().click(within(panel).getByRole("button", { name: "Show tool activity" }));
    expect(within(panel).getByText("Outcome unconfirmed")).toBeTruthy();
    expect(panel.querySelectorAll('[data-tool-status="failed"]')).toHaveLength(1);
    expect(panel.querySelectorAll('[data-tool-status="succeeded"]')).toHaveLength(0);
  });
  it.each(["error", "cancel"])("blocks earlier proposal confirmation through pending and %s states", async outcome => {
    const proposal: NonNullable<NativeWorkspace["proposal"]> = { id: orderId, status: "PENDING", orderNo: "MOCK-NATIVE", technicianLabel: "Mock technician",
      canonicalPayload: { orderId, technicianId: id, scheduledAt: null }, targetUpdatedAt: "2026-10-05T00:00:00Z", expiresAt: "2099-10-05T00:00:00Z" };
    const stream = deferredStream();
    let run = 0;
    vi.mocked(fetch).mockImplementation(async (url) => String(url).includes("assignment-proposals")
      ? Response.json({ proposal, previewToken: "a".repeat(64) }) : ++run === 1 ? response({ ...result, proposal }) : stream.response);
    render(<NativeAgentWorkspace {...props} canAssign />);
    await send("Prepare a proposal");
    const confirm = await screen.findByRole("button", { name: "Confirm and execute assignment" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    await send("Now inspect something else");
    expect(confirm.disabled).toBe(true);
    await stream.event({ type: "started", runId: id });
    if (outcome === "cancel") await user().click(screen.getByRole("button", { name: "Cancel request" }));
    else {
      await stream.event({ type: "error", code: "UNAVAILABLE", message: "Synthetic provider failure" });
      await stream.close();
      await screen.findByText("Request not completed");
    }
    expect(confirm.disabled).toBe(true);
    await user().click(confirm);
    expect(vi.mocked(fetch).mock.calls.some(([url, options]) => String(url).includes("assignment-proposals") && options?.method === "POST")).toBe(false);
    expect(screen.getByText("Earlier result")).toBeTruthy();
  });
  it("labels source-only terminal results without claiming completed execution or tools", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ ...result, status: "SOURCE_ONLY" }));
    render(<NativeAgentWorkspace {...props} />);
    await send("Source-only request");
    await screen.findByText("MOCK-NATIVE");
    const panel = screen.getByRole("region", { name: "Agent execution" });
    expect(within(panel).getByRole("status").textContent).toBe("Sources only");
    expect(within(panel).getByText("No tool execution events received")).toBeTruthy();
  });
  it("starts with a full canvas and opens, closes, reopens without losing source or transcript", async () => {
    render(<NativeAgentWorkspace {...props} />);
    expect(screen.queryByRole("region", { name: "Agent conversation" })).toBeNull();
    await send("Inspect the order");
    await screen.findByText("MOCK-NATIVE");
    const panel = screen.getByRole("region", { name: "Agent conversation" });
    expect(document.querySelector(".native-agent-layout")?.contains(panel)).toBe(false);
    await user().click(screen.getByRole("button", { name: "Minimize conversation" }));
    expect(screen.queryByRole("region", { name: "Agent conversation" })).toBeNull();
    expect(screen.getByText("MOCK-NATIVE")).toBeTruthy();
    await user().click(screen.getByRole("button", { name: "Open conversation" }));
    expect(within(screen.getByRole("region", { name: "Agent conversation" })).getByText("Inspect the order")).toBeTruthy();
    expect(screen.getByText(`Branch ID: ${id}`)).toBeTruthy();
    expect(screen.getByText(`Technician ID: ${id}`)).toBeTruthy();
  });
  it("close during a slow request keeps it running and reopening preserves pending conversation", async () => {
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<NativeAgentWorkspace {...props} />);
    await send("Inspect slowly");
    await user().click(screen.getByRole("button", { name: "Minimize conversation" }));
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(false);
    await user().click(screen.getByRole("button", { name: "Open conversation" }));
    expect(screen.getByRole("button", { name: "Cancel request" })).toBeTruthy();
    finish(response());
    await screen.findByText("MOCK-NATIVE");
  });
  it("new conversation cancels an in-flight request and clears history, source and selected IDs", async () => {
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<NativeAgentWorkspace {...props} focusOrderId={orderId} />);
    await send("Old slow request");
    await user().click(screen.getByRole("button", { name: "New conversation" }));
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
    finish(response());
    expect(screen.queryByText("Old slow request")).toBeNull();
    expect(screen.queryByText("MOCK-NATIVE")).toBeNull();
    await send("Fresh request");
    await screen.findByText("MOCK-NATIVE");
    expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]?.body as string)).toMatchObject({ conversation: [], contextOrderIds: [] });
    expect(screen.queryByText("Old slow request")).toBeNull();
  });
  it.each(["context", "role", "workspace"])("%s change aborts and resets the conversation, and hides a late old result", async kind => {
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<NativeAgentWorkspace {...props} contextKey="old" />);
    await send("Old perspective");
    view.rerender(<NativeAgentWorkspace {...props} contextKey={kind === "context" ? "new" : "old"}
      canAssign={kind === "role"} workspaceId={kind === "workspace" ? orderId : id} />);
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
    finish(response());
    await waitFor(() => expect(screen.queryByText("MOCK-NATIVE")).toBeNull());
    expect(screen.queryByRole("region", { name: "Agent conversation" })).toBeNull();
    await user().click(screen.getByRole("button", { name: "Open conversation" }));
    expect(screen.queryByText("Old perspective")).toBeNull();
  });
});
