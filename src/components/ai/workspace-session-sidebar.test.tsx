// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfigProvider } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiSessionDetailResponseSchema, type AiSessionSummary } from "@/domain/ai-sessions/contracts";
import { WorkspaceSessionSidebar, type WorkspaceSessionSidebarProps } from "./workspace-session-sidebar";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const otherWorkspaceId = "22222222-2222-4222-8222-222222222222";
const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const session = (value: number, overrides: Partial<AiSessionSummary> = {}): AiSessionSummary => ({
  id: id(value), workspaceId, workspaceKind: "DEMO", title: `Saved task ${value}`, surface: "WORKSPACE", role: "ADMIN",
  createdAt: "2026-10-09T03:00:00Z", updatedAt: "2026-10-09T04:00:00Z", turnCount: 1, ...overrides,
});
const list = (sessions: AiSessionSummary[] = [], nextCursor: string | null = null) => ({ sessions, nextCursor, workspaces: [] });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
const fetchMock = vi.fn<typeof fetch>();
let props: WorkspaceSessionSidebarProps;
const tree = (overrides: Partial<WorkspaceSessionSidebarProps> = {}) => <ConfigProvider theme={{ token: { motion: false } }}><WorkspaceSessionSidebar {...props} {...overrides} /></ConfigProvider>;
const savedButton = (value: number) => screen.getByRole("button", { name: `Open saved conversation: Saved task ${value}` });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  props = { workspaceId, contextKey: "ADMIN:actor-1:generation-1", busy: false, revision: 0, onNew: vi.fn(), onRestore: vi.fn() };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("actual AI Workspace conversation sidebar with synthetic API", () => {
  it("shows real loading and empty states with historical/private semantics", async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    render(tree());
    expect(screen.getByRole("status").textContent).toContain("Loading conversations");
    expect(screen.getByText("Private to your current workspace and role.")).toBeTruthy();
    expect(screen.getByText(/Saved conversations open as read-only history/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(`/api/workspaces/${workspaceId}/ai-sessions?surface=WORKSPACE`, expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }));
    await act(async () => pending.resolve(response(list())));
    await screen.findByText("No saved conversations yet");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("sanitizes failed history loading and retries", async () => {
    fetchMock.mockResolvedValueOnce(response({ secret: "Synthetic upstream details" }, 503)).mockResolvedValueOnce(response(list([session(1)])));
    const user = userEvent.setup({ delay: null });
    render(tree());
    await screen.findByText(/Conversation history is unavailable/);
    expect(screen.queryByText(/Synthetic upstream details/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Retry history" }));
    await screen.findByText("Saved task 1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("loads deduplicated pages and prevents duplicate pending requests", async () => {
    const pending = deferred<Response>();
    fetchMock.mockResolvedValueOnce(response(list([session(1)], id(1)))).mockReturnValueOnce(pending.promise);
    const user = userEvent.setup({ delay: null });
    render(tree({ selectedSessionId: id(1) }));
    await screen.findByText("Saved task 1");
    expect(savedButton(1).getAttribute("aria-current")).toBe("page");
    await user.dblClick(screen.getByRole("button", { name: "Load more conversations" }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/workspaces/${workspaceId}/ai-sessions?surface=WORKSPACE&cursor=${id(1)}`);
    await act(async () => pending.resolve(response(list([session(1), session(2)]))));
    await screen.findByText("Saved task 2");
    expect(screen.getAllByText("Saved task 1")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Load more conversations" })).toBeNull();
  });

  it("keeps loaded rows when pagination fails and allows a fresh history retry", async () => {
    fetchMock.mockResolvedValueOnce(response(list([session(1)], id(1)))).mockResolvedValueOnce(response({}, 500)).mockResolvedValueOnce(response(list([session(2)])));
    const user = userEvent.setup({ delay: null });
    render(tree()); await screen.findByText("Saved task 1");
    await user.click(screen.getByRole("button", { name: "Load more conversations" }));
    await screen.findByText("More conversations could not be loaded. Retry history.");
    expect(savedButton(1)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Retry history" }));
    await screen.findByText("Saved task 2");
    expect(screen.queryByText("Saved task 1")).toBeNull();
  });

  it("bounds the visible list at 120 sessions", async () => {
    for (let page = 0; page < 4; page += 1) fetchMock.mockResolvedValueOnce(response(list(Array.from({ length: 30 }, (_, index) => session(page * 30 + index + 1)), id((page + 1) * 30))));
    const user = userEvent.setup({ delay: null }); render(tree());
    await screen.findByText("Saved task 1");
    for (let page = 1; page < 4; page += 1) {
      await user.click(screen.getByRole("button", { name: "Load more conversations" }));
      await screen.findByText(`Saved task ${page * 30 + 1}`);
    }
    expect(screen.getAllByRole("listitem")).toHaveLength(120);
    expect(screen.getByText("Showing the latest 120 conversations.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Load more conversations" })).toBeNull();
  });

  it("restores a validated read-only detail only once while pending", async () => {
    const pending = deferred<Response>(); const detail = { session: session(1), turns: [] };
    fetchMock.mockResolvedValueOnce(response(list([session(1)]))).mockReturnValueOnce(pending.promise);
    const user = userEvent.setup({ delay: null }); render(tree()); await screen.findByText("Saved task 1");
    await user.dblClick(savedButton(1));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status").textContent).toContain("Opening saved conversation");
    await act(async () => pending.resolve(response(detail)));
    await waitFor(() => expect(props.onRestore).toHaveBeenCalledExactlyOnceWith(detail));
  });

  it.each([
    { id: id(2) }, { workspaceId: otherWorkspaceId }, { surface: "CHATBOT" as const },
  ])("rejects substituted detail scope %j", async (overrides) => {
    fetchMock.mockResolvedValueOnce(response(list([session(1)]))).mockResolvedValueOnce(response({ session: session(1, overrides), turns: [] }));
    const user = userEvent.setup({ delay: null }); render(tree()); await screen.findByText("Saved task 1");
    await user.click(savedButton(1));
    await screen.findByText(/This conversation is no longer available in your current scope/);
    expect(props.onRestore).not.toHaveBeenCalled();
  });

  it("rejects rows from a different workspace or surface", async () => {
    fetchMock.mockResolvedValueOnce(response(list([session(1, { workspaceId: otherWorkspaceId }), session(2, { surface: "CHATBOT" })])));
    render(tree()); await screen.findByText(/Conversation history is unavailable/);
    expect(screen.queryByText("Saved task 1")).toBeNull(); expect(screen.queryByText("Saved task 2")).toBeNull();
  });

  it("rejects a valid session envelope containing a different workspace's canvas snapshot", async () => {
    const detail = { session: session(1), turns: [{
      id: id(3), question: "Show saved context", status: "COMPLETED", answer: "Saved result", createdAt: "2026-10-09T03:00:00Z", completedAt: "2026-10-09T04:00:00Z", activity: [],
      workspace: { runId: id(4), workspaceId: otherWorkspaceId, mode: "mock", type: "focus", title: "Other workspace result", summary: "Synthetic snapshot",
        status: "COMPLETE", items: [], excerpts: [], proposal: null, missingInformation: [], followUps: [], scope: { ordersRead: 0, knowledgeHits: 0, checkedAt: "2026-10-09T04:00:00Z" } },
    }] };
    expect(aiSessionDetailResponseSchema.safeParse(detail).success).toBe(true);
    fetchMock.mockResolvedValueOnce(response(list([session(1)]))).mockResolvedValueOnce(response(detail));
    const user = userEvent.setup({ delay: null }); render(tree()); await screen.findByText("Saved task 1");
    await user.click(savedButton(1)); await screen.findByText(/This conversation is no longer available in your current scope/);
    expect(props.onRestore).not.toHaveBeenCalled();
  });

  it("aborts and ignores late lists after same-workspace role/scope change", async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(response(list([session(2, { role: "MANAGER" })])));
    const view = render(tree()); const signal = fetchMock.mock.calls[0]?.[1]?.signal;
    view.rerender(tree({ contextKey: "MANAGER:actor-1:generation-1" }));
    await screen.findByText("Saved task 2"); expect(signal?.aborted).toBe(true);
    await act(async () => pending.resolve(response(list([session(1)]))));
    expect(screen.queryByText("Saved task 1")).toBeNull();
  });

  it.each(["scope", "revision", "busy", "new", "unmount"])("cancels pending restoration on %s and ignores its late response", async (change) => {
    const pending = deferred<Response>();
    fetchMock.mockResolvedValueOnce(response(list([session(1)]))).mockReturnValueOnce(pending.promise).mockResolvedValue(response(list([session(2)])));
    const user = userEvent.setup({ delay: null }); const view = render(tree()); await screen.findByText("Saved task 1");
    await user.click(savedButton(1)); const signal = fetchMock.mock.calls[1]?.[1]?.signal;
    if (change === "scope") view.rerender(tree({ contextKey: "ADMIN:actor-2:generation-2" }));
    if (change === "revision") view.rerender(tree({ revision: 1 }));
    if (change === "busy") view.rerender(tree({ busy: true }));
    if (change === "new") await user.click(screen.getByRole("button", { name: "New conversation" }));
    if (change === "unmount") view.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => pending.resolve(response({ session: session(1), turns: [] })));
    expect(props.onRestore).not.toHaveBeenCalled();
    if (change === "new") expect(props.onNew).toHaveBeenCalledOnce();
  });

  it("blocks history restoration while an active task runs but allows New conversation", async () => {
    fetchMock.mockResolvedValueOnce(response(list([session(1)])));
    const user = userEvent.setup({ delay: null }); render(tree({ busy: true })); await screen.findByText("Saved task 1");
    await user.click(savedButton(1)); expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((savedButton(1) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "New conversation" })); expect(props.onNew).toHaveBeenCalledOnce();
  });
});
