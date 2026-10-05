// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OperationsAssistant } from "../../src/app/workspaces/[workspaceId]/operations-assistant";
import { OperationsShell } from "../../src/app/workspaces/[workspaceId]/operations-shell";
import { deferred, jsonResponse } from "../helpers/ui-request";

const navigation = vi.hoisted(() => ({ pathname: "/workspaces/current/overview", refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname, useRouter: () => ({ refresh: navigation.refresh, push: navigation.push }) }));
vi.mock("../../src/app/workspaces/[workspaceId]/workspace-nav", () => ({ WorkspaceNav: () => <span>Modes navigation</span> }));
const answer = { status: "EXCERPTS_FOUND", answer: "Check these published excerpts.", traceId: "mock-trace",
  activity: [{ type: "KNOWLEDGE_SEARCH", hitCount: 1 }], excerpts: [{ text: "Disconnect power before inspection.",
    citation: { documentId: "doc", versionId: "version1", title: "Safety guide", sourceLabel: "Manual", section: "Safety", page: 2, ordinal: 0 } }] };
const view = (props = {}) => <OperationsAssistant workspaceId="current" role="MANAGER" canUseAi isGuest={false} readOnly={false} initialTask="knowledge" {...props} />;
const button = (name: string) => screen.getByRole("button", { name: new RegExp(name) });
const open = () => fireEvent.click(button("Open Operations Ask AI"));
const ask = () => {
  fireEvent.change(screen.getByRole("textbox", { name: "Question" }), { target: { value: "How to inspect a filter?" } });
  fireEvent.click(button("Find cited excerpts"));
};
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); navigation.pathname = "/workspaces/current/overview"; });

describe("Operations floating Ask AI", () => {
  it("reads scoped Orders with the existing bounded Assist contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ answer: "No matching recent orders.", orders: [], activity: [{ type: "RECENT_ORDERS_READ", orderCount: 0 }], traceId: "order-trace" }));
    vi.stubGlobal("fetch", fetchMock); render(view({ initialTask: "orders" })); open();
    await screen.findByRole("button", { name: /Check orders/ });
    fireEvent.click(button("Check orders"));
    expect(await screen.findByText("No matching recent orders.")).toBeTruthy();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/workspaces/current/agent/orders");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({ question: "Find relevant recent orders" });
    expect(screen.getByText(/Read recent orders.*0 returned/)).toBeTruthy();
    expect(screen.queryByText(/Confirm proposal/)).toBeNull();
  });

  it("switches topic by aborting obsolete Knowledge requests", async () => {
    const pending = deferred<Response>(); const fetchMock = vi.fn().mockReturnValue(pending.promise);
    vi.stubGlobal("fetch", fetchMock); render(view()); open(); ask();
    fireEvent.click(screen.getByText("Orders"));
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    await screen.findByRole("button", { name: /Check orders/ });
    await act(async () => pending.resolve(jsonResponse(answer)));
    expect(screen.queryByText("Disconnect power before inspection.")).toBeNull();
  });

  it("opens on demand, renders original citations and closes with cleared state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(answer)));
    render(view()); expect(screen.queryByRole("textbox")).toBeNull(); open(); ask();
    expect(await screen.findByText("Disconnect power before inspection.")).toBeTruthy();
    expect(screen.getByText(/Safety guide — Manual/)).toBeTruthy();
    expect(screen.getByText("version1")).toBeTruthy();
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/workspaces/current/agent/knowledge");
    fireEvent.click(button("Close"));
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull()); open();
    expect((screen.getByRole("textbox", { name: "Question" }) as HTMLTextAreaElement).value).toBe("");
  });

  it("aborts on close and rejects a late parsed answer after reopening", async () => {
    const parsed = deferred<unknown>();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => parsed.promise });
    vi.stubGlobal("fetch", fetchMock); render(view()); open(); ask();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    fireEvent.click(button("Close"));
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    open(); await act(async () => parsed.resolve(answer));
    expect(screen.queryByText("Disconnect power before inspection.")).toBeNull();
  });

  it("starts over by aborting a request and resetting the question", async () => {
    const pending = deferred<Response>(); const fetchMock = vi.fn().mockReturnValue(pending.promise);
    vi.stubGlobal("fetch", fetchMock); render(view()); open(); ask();
    fireEvent.click(button("Start over"));
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    expect((screen.getByRole("textbox", { name: "Question" }) as HTMLTextAreaElement).value).toBe("");
    await act(async () => pending.resolve(jsonResponse(answer)));
    expect(screen.queryByText("Disconnect power before inspection.")).toBeNull();
  });

  it("shows the quota reset and recovers by retrying the same question", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ error: "Guest allowance used up", resetAt: "2026-10-06T00:00:00Z" }, 429))
      .mockResolvedValueOnce(jsonResponse(answer));
    vi.stubGlobal("fetch", fetchMock); render(view({ isGuest: true })); open(); ask();
    expect(await screen.findByText(/Guest allowance used up.*Malaysia time/)).toBeTruthy();
    fireEvent.click(button("Find cited excerpts"));
    expect(await screen.findByText("Disconnect power before inspection.")).toBeTruthy();
    expect(navigation.refresh).toHaveBeenCalledTimes(2);
  });

  it("cancels, suppresses double submit and retains the question for retry", async () => {
    const pending = deferred<Response>(); const fetchMock = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(jsonResponse(answer));
    vi.stubGlobal("fetch", fetchMock); render(view()); open(); ask();
    fireEvent.click(button("Find cited excerpts")); expect(fetchMock).toHaveBeenCalledOnce();
    fireEvent.click(button("Cancel")); expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    fireEvent.click(button("Find cited excerpts"));
    expect(await screen.findByText("Disconnect power before inspection.")).toBeTruthy();
    await act(async () => pending.resolve(jsonResponse({ ...answer, answer: "Obsolete answer" })));
    expect(screen.queryByText("Obsolete answer")).toBeNull();
  });

  it("offers technician Knowledge without Orders or native workspace capabilities", () => {
    vi.stubGlobal("fetch", vi.fn()); render(view({ role: "TECHNICIAN", canUseAi: false, initialTask: "orders" })); open();
    expect(screen.getByRole("textbox", { name: "Question" })).toBeTruthy();
    expect(screen.queryByText("Order assistant")).toBeNull();
    expect(screen.queryByText("Orders")).toBeNull(); expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it.each([{ role: "MANAGER", canUseAi: false }, { role: "ADMIN", readOnly: true }, { role: "TECHNICIAN", readOnly: true }])("hides forbidden AI entry for %o", (props) => {
    render(view(props)); expect(screen.queryByRole("button", { name: "Open Operations Ask AI" })).toBeNull();
  });

  it("resets and aborts on navigation or perspective change in the real shell", async () => {
    const pending = deferred<Response>(); const fetchMock = vi.fn().mockReturnValue(pending.promise); vi.stubGlobal("fetch", fetchMock);
    navigation.pathname = "/workspaces/current/knowledge";
    const shell = (role: "MANAGER" | "TECHNICIAN") => <OperationsShell base="/workspaces/current" role={role} canUseAi={role === "MANAGER"} canAssign={false} isGuest readOnly={false} header={<span>Mock role</span>}><main>Full content</main></OperationsShell>;
    const rendered = render(shell("MANAGER")); open(); ask();
    navigation.pathname = "/workspaces/current/overview"; rendered.rerender(shell("TECHNICIAN"));
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    expect(screen.queryByRole("textbox")).toBeNull(); open();
    expect((screen.getByRole("textbox", { name: "Question" }) as HTMLTextAreaElement).value).toBe("");
    await act(async () => pending.resolve(jsonResponse(answer))); expect(screen.queryByText("Disconnect power before inspection.")).toBeNull();
  });

  it("does not mount Operations Ask AI inside AI Workspace", () => {
    navigation.pathname = "/workspaces/current/agent";
    render(<OperationsShell base="/workspaces/current" role="MANAGER" canUseAi canAssign={false} isGuest readOnly={false} header={null}><main>AI canvas</main></OperationsShell>);
    expect(screen.queryByRole("button", { name: "Open Operations Ask AI" })).toBeNull(); expect(screen.getByText("AI canvas")).toBeTruthy();
  });

  it("resets a same-role session when its resolved actor or Demo generation changes", async () => {
    const pending = deferred<Response>(); const fetchMock = vi.fn().mockReturnValue(pending.promise); vi.stubGlobal("fetch", fetchMock);
    navigation.pathname = "/workspaces/current/knowledge";
    const shell = (contextKey: string) => <OperationsShell base="/workspaces/current" role="MANAGER" canUseAi canAssign={false} isGuest readOnly={false} contextKey={contextKey} header={null}><main>Knowledge</main></OperationsShell>;
    const rendered = render(shell("actor:visit1:generation1")); open(); ask();
    rendered.rerender(shell("actor:visit2:generation2"));
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    expect(screen.queryByRole("textbox")).toBeNull(); open();
    expect((screen.getByRole("textbox", { name: "Question" }) as HTMLTextAreaElement).value).toBe("");
    await act(async () => pending.resolve(jsonResponse(answer)));
    expect(screen.queryByText("Disconnect power before inspection.")).toBeNull();
  });

  it("shows Dashboard for Admin and omits the Document import navigation item", () => {
    render(<OperationsShell base="/workspaces/current" role="ADMIN" canUseAi canAssign={false} isGuest readOnly={false} header={null}><main>Orders</main></OperationsShell>);
    expect(screen.getByText("Dashboard")).toBeTruthy(); expect(screen.queryByText("Document import")).toBeNull();
  });
});
