// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OperationsAssistant } from "../../src/app/workspaces/[workspaceId]/operations-assistant";
import { OperationsShell } from "../../src/app/workspaces/[workspaceId]/operations-shell";
import { deferred, jsonResponse } from "../helpers/ui-request";

const navigation = vi.hoisted(() => ({ pathname: "/workspaces/current/overview", refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname, useRouter: () => ({ refresh: navigation.refresh, push: navigation.push }) }));
vi.mock("../../src/app/workspaces/[workspaceId]/workspace-nav", () => ({ WorkspaceNav: () => <span>Modes navigation</span> }));
const answer = { status: "EVIDENCE_FOUND", orders: [], answer: "Check these published excerpts.", traceId: "mock-trace",
  activity: [{ type: "KNOWLEDGE_SEARCH", hitCount: 1 }], excerpts: [{ text: "Disconnect power before inspection.",
    citation: { documentId: "doc", versionId: "version1", title: "Safety guide", sourceLabel: "Manual", section: "Safety", page: 2, ordinal: 0 } }] };
const view = (props = {}) => <OperationsAssistant workspaceId="current" role="MANAGER" canUseAi isGuest={false} readOnly={false} {...props} />;
const button = (name: string) => screen.getByRole("button", { name: new RegExp(name) });
const open = () => fireEvent.click(button("Open Operations Ask AI"));
const ask = () => {
  fireEvent.change(screen.getByRole("textbox", { name: "Question" }), { target: { value: "How to inspect a filter?" } });
  fireEvent.click(screen.getByRole("button", { name: "Ask AI" }));
};
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); navigation.pathname = "/workspaces/current/overview"; });

describe("Operations floating Ask AI", () => {
  it("welcomes the user and keeps earlier answers and evidence while sending independent questions", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(answer)).mockResolvedValueOnce(jsonResponse({ ...answer, answer: "Second source check.", excerpts: [], traceId: "second-trace" }));
    vi.stubGlobal("fetch", fetchMock); render(view()); open();
    expect(screen.getByText("Hi! How can I help?")).toBeTruthy();
    expect(screen.getByText(/Each question is checked independently/)).toBeTruthy();
    ask(); expect(await screen.findByText("Check these published excerpts.")).toBeTruthy();
    const composer = screen.getByRole("textbox", { name: "Question" }) as HTMLTextAreaElement;
    expect(composer.value).toBe("");
    fireEvent.change(composer, { target: { value: "Which jobs are scheduled?" } });
    expect(screen.getByText("Disconnect power before inspection.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ask AI" }));
    expect(await screen.findByText("Second source check.")).toBeTruthy();
    const firstTurn = screen.getByRole("region", { name: "Question 1" });
    const secondTurn = screen.getByRole("region", { name: "Question 2" });
    expect(within(firstTurn).getByText("How to inspect a filter?")).toBeTruthy();
    expect(within(firstTurn).getByText("mock-trace")).toBeTruthy();
    expect(within(secondTurn).getByText("second-trace")).toBeTruthy();
    expect(JSON.parse(String(fetchMock.mock.calls[1][1].body))).toEqual({ question: "Which jobs are scheduled?" });
    expect(screen.getByRole("log", { name: "Operations conversation" }).contains(firstTurn)).toBe(true);
    expect(composer.closest(".operations-assistant-composer")).toBeTruthy();
  });

  it("shows an honest waiting state and attaches only returned activity after completion", async () => {
    const pending = deferred<Response>(); vi.stubGlobal("fetch", vi.fn().mockReturnValue(pending.promise));
    render(view()); open(); ask();
    expect(screen.getByText("Waiting for the answer…")).toBeTruthy();
    expect(screen.getByText("Source checks and activity appear when the request completes.")).toBeTruthy();
    expect(screen.queryByText(/Search published knowledge.*hits/)).toBeNull();
    await act(async () => pending.resolve(jsonResponse(answer)));
    expect(screen.queryByText("Waiting for the answer…")).toBeNull();
    expect(screen.getByText(/Search published knowledge.*1 hits/)).toBeTruthy();
  });

  it("sends with Enter but preserves Shift+Enter and IME composition", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(answer)); vi.stubGlobal("fetch", fetchMock);
    render(view()); open(); const composer = screen.getByRole("textbox", { name: "Question" });
    fireEvent.change(composer, { target: { value: "Inspect a filter" } });
    expect(fireEvent.keyDown(composer, { key: "Enter", shiftKey: true })).toBe(true);
    fireEvent.compositionStart(composer); fireEvent.keyDown(composer, { key: "Enter" });
    fireEvent.compositionEnd(composer);
    fireEvent.keyDown(composer, { key: "Enter", isComposing: true });
    fireEvent.keyDown(composer, { key: "Enter", keyCode: 229 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(composer, { key: "Enter" })).toBe(false);
    expect(await screen.findByText("Disconnect power before inspection.")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("enforces the 120 character composer limit and rejects empty submissions", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(answer)); vi.stubGlobal("fetch", fetchMock);
    render(view()); open(); const composer = screen.getByRole("textbox", { name: "Question" }) as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: "   " } }); fireEvent.keyDown(composer, { key: "Enter" });
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(composer, { target: { value: "x".repeat(130) } });
    expect(composer.value).toHaveLength(120);
    fireEvent.keyDown(composer, { key: "Enter" }); await screen.findByText("Disconnect power before inspection.");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({ question: "x".repeat(120) });
  });

  it("keeps completed evidence when a later question fails and refreshes Guest usage once", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(answer)).mockRejectedValueOnce(new Error("Network unavailable"));
    vi.stubGlobal("fetch", fetchMock); render(view({ isGuest: true })); open(); ask();
    await screen.findByText("Disconnect power before inspection.");
    fireEvent.change(screen.getByRole("textbox", { name: "Question" }), { target: { value: "Try another question" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask AI" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Network unavailable");
    expect(screen.getByText("Disconnect power before inspection.")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Question" }) as HTMLTextAreaElement).value).toBe("Try another question");
    expect(navigation.refresh).toHaveBeenCalledTimes(2);
  });

  it("bounds local history to the latest 12 questions and clears it with Start over", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ ...answer, excerpts: [], answer: "Source check complete." })));
    vi.stubGlobal("fetch", fetchMock); render(view()); open();
    for (let index = 1; index <= 13; index++) {
      fireEvent.change(screen.getByRole("textbox", { name: "Question" }), { target: { value: `Question number ${index}` } });
      fireEvent.click(screen.getByRole("button", { name: "Ask AI" }));
      await waitFor(() => expect((screen.getByRole("textbox", { name: "Question" }) as HTMLTextAreaElement).value).toBe(""));
    }
    expect(screen.queryByRole("region", { name: "Question 1" })).toBeNull();
    expect(screen.getByRole("region", { name: "Question 2" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Question 13" })).toBeTruthy();
    expect(screen.getAllByText("Source check complete.")).toHaveLength(12);
    fireEvent.click(button("Start over"));
    expect(screen.queryByText("Source check complete.")).toBeNull();
    expect(screen.getByText("Hi! How can I help?")).toBeTruthy();
  });

  it("does not move the transcript away from earlier evidence when a pending response arrives", async () => {
    const pending = deferred<Response>(); const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(answer)).mockReturnValueOnce(pending.promise);
    vi.stubGlobal("fetch", fetchMock); render(view()); open(); ask(); await screen.findByText("Disconnect power before inspection.");
    ask(); const transcript = screen.getByRole("log", { name: "Operations conversation" });
    Object.defineProperties(transcript, { scrollHeight: { value: 1000 }, clientHeight: { value: 400 } });
    transcript.scrollTop = 50; fireEvent.scroll(transcript);
    await act(async () => pending.resolve(jsonResponse({ ...answer, excerpts: [], answer: "Later answer" })));
    expect(screen.getByText("Later answer")).toBeTruthy(); expect(transcript.scrollTop).toBe(50);
  });

  it("refreshes Guest usage on cancellation without refreshing again for a stale completion", async () => {
    const pending = deferred<Response>(); const fetchMock = vi.fn().mockReturnValue(pending.promise);
    vi.stubGlobal("fetch", fetchMock); render(view({ isGuest: true })); open(); ask();
    fireEvent.click(button("Cancel"));
    expect(navigation.refresh).toHaveBeenCalledOnce();
    expect(screen.getByText("Request cancelled. You can retry or search manually.")).toBeTruthy();
    await act(async () => pending.resolve(jsonResponse(answer)));
    expect(navigation.refresh).toHaveBeenCalledOnce();
    expect(screen.queryByText("Disconnect power before inspection.")).toBeNull();
  });

  it("uses one direct question for scoped Orders without a topic picker", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ...answer, status: "INSUFFICIENT", answer: "No matching recent orders.", orders: [], excerpts: [], activity: [{ type: "RECENT_ORDERS_READ", orderCount: 0 }], traceId: "order-trace" }));
    vi.stubGlobal("fetch", fetchMock); render(view()); open();
    fireEvent.change(screen.getByRole("textbox", { name: "Question" }), { target: { value: "Which orders need attention?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask AI" }));
    expect(await screen.findByText("No matching recent orders.")).toBeTruthy();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/workspaces/current/operations/ask");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({ question: "Which orders need attention?" });
    expect(screen.getByText(/Read recent orders.*0 returned/)).toBeTruthy();
    expect(screen.queryByText(/Confirm proposal/)).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("shows Orders and cited Knowledge together from the same question", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ...answer, orders: [{ id: "order1", order_no: "SO-01", status: "ASSIGNED", problem_description: "Filter noise", scheduled_at: "2026-10-06T02:00:00Z", assigned_technician_id: "tech1" }] }));
    vi.stubGlobal("fetch", fetchMock); render(view()); open(); ask();
    expect(await screen.findByText("SO-01")).toBeTruthy();
    expect(screen.getByText("Disconnect power before inspection.")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Orders from scoped evidence" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Cited knowledge excerpts" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "View SO-01" }).getAttribute("href")).toBe("/workspaces/current/orders?orderId=order1");
  });

  it("opens on demand, renders original citations and closes with cleared state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(answer)));
    render(view()); expect(screen.queryByRole("textbox")).toBeNull(); open(); ask();
    expect(await screen.findByText("Disconnect power before inspection.")).toBeTruthy();
    expect(screen.getByText(/Safety guide — Manual/)).toBeTruthy();
    expect(screen.getByText("version1")).toBeTruthy();
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/workspaces/current/operations/ask");
    fireEvent.click(button("Close"));
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull()); open();
    expect((screen.getByRole("textbox", { name: "Question" }) as HTMLTextAreaElement).value).toBe("");
    expect(screen.queryByRole("region", { name: "Question 1" })).toBeNull();
    expect(screen.queryByText("Disconnect power before inspection.")).toBeNull();
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
    fireEvent.click(screen.getByRole("button", { name: "Ask AI" }));
    expect(await screen.findByText("Disconnect power before inspection.")).toBeTruthy();
    expect(navigation.refresh).toHaveBeenCalledTimes(2);
  });

  it("cancels, suppresses double submit and retains the question for retry", async () => {
    const pending = deferred<Response>(); const fetchMock = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(jsonResponse(answer));
    vi.stubGlobal("fetch", fetchMock); render(view()); open(); ask();
    fireEvent.click(screen.getByRole("button", { name: "Ask AI" })); expect(fetchMock).toHaveBeenCalledOnce();
    fireEvent.click(button("Cancel")); expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Ask AI" }));
    expect(await screen.findByText("Disconnect power before inspection.")).toBeTruthy();
    await act(async () => pending.resolve(jsonResponse({ ...answer, answer: "Obsolete answer" })));
    expect(screen.queryByText("Obsolete answer")).toBeNull();
  });

  it("explains technician own-assignment and published-knowledge scope in one input", () => {
    vi.stubGlobal("fetch", vi.fn()); render(view({ role: "TECHNICIAN", canUseAi: false })); open();
    expect(screen.getByRole("textbox", { name: "Question" })).toBeTruthy();
    expect(screen.getByText(/Ask about your assigned jobs or published workspace knowledge/)).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull(); expect(vi.mocked(fetch)).not.toHaveBeenCalled();
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
