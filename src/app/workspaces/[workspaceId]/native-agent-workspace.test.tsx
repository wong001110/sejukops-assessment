// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NativeWorkspace } from "@/domain/agent-workspace/contracts";
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
const response = () => new Response([JSON.stringify({ type: "started", runId: id }), JSON.stringify({ type: "workspace", workspace: result })].join("\n") + "\n", { headers: { "content-type": "application/x-ndjson" } });
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
