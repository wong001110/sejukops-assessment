// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OwnerSessions } from "./owner-sessions";

const ownerId = "10000000-0000-4000-8000-000000000001";
const demoId = "10000000-0000-4000-8000-000000000002";
const firstId = "20000000-0000-4000-8000-000000000001";
const secondId = "20000000-0000-4000-8000-000000000002";
const workspaces = [{ id: ownerId, kind: "OWNER", name: "Private workspace" }, { id: demoId, kind: "DEMO", name: "Fictional Demo" }];
const summary = (id = firstId, title = "Fictional service investigation", workspaceId = ownerId) => ({
  id, title, workspaceId, workspaceKind: workspaceId === ownerId ? "OWNER" : "DEMO", surface: "WORKSPACE", role: "ADMIN",
  createdAt: "2026-10-09T00:00:00Z", updatedAt: "2026-10-09T01:00:00Z", turnCount: 1,
});
const list = (sessions = [summary()], nextCursor: string | null = null) => ({ sessions, nextCursor, workspaces });
const detail = (session = summary(), answer = "Recorded fictional answer") => ({ session, turns: [{
  id: "30000000-0000-4000-8000-000000000001", question: "Inspect fictional service records", status: "COMPLETED", answer,
  createdAt: "2026-10-09T00:00:00Z", completedAt: "2026-10-09T00:01:00Z", workspace: null, activity: [],
}] });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const user = () => userEvent.setup({ delay: null });
async function selectDemoWorkspace() {
  await user().click(screen.getByRole("combobox", { name: "Workspace" }));
  await user().click(await screen.findByRole("option", { name: "Fictional Demo · Demo" }));
}
function deferred() { let resolve!: (response: Response) => void; return { promise: new Promise<Response>((done) => { resolve = done; }), resolve: (value: Response) => resolve(value) }; }
beforeEach(() => { vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(list()))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Owner Sessions rendered contract", () => {
  it("renders explicit history limit, empty list and selection guidance", async () => {
    vi.mocked(fetch).mockResolvedValue(json(list([])));
    render(<OwnerSessions />);
    expect(screen.getByText(/earlier browser-only conversations are unavailable/)).toBeTruthy();
    expect(await screen.findByText("No recorded sessions in this workspace.")).toBeTruthy();
    expect(screen.getByText("Select a session to inspect its recorded conversation.")).toBeTruthy();
  });
  it("opens read-only recorded detail and renders long text as text", async () => {
    const longTitle = "A fictional long title ".repeat(4);
    vi.mocked(fetch).mockResolvedValueOnce(json(list([summary(firstId, longTitle)]))).mockResolvedValueOnce(json(detail(summary(firstId, longTitle), "<script>untrusted</script>")));
    render(<OwnerSessions />);
    await user().click(await screen.findByRole("button", { name: new RegExp("A fictional long title") }));
    expect(await screen.findByText("<script>untrusted</script>")).toBeTruthy();
    const panel = screen.getByRole("region", { name: "Session detail" });
    expect(panel.querySelector("script")).toBeNull();
    expect(within(panel).getByText(/actions are unavailable here/)).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: /confirm|approve|execute/i })).toBeNull();
    expect(vi.mocked(fetch).mock.calls[1][0]).toBe(`/api/owner/ai-sessions/${firstId}`);
  });
  it("supports paging with cursor and does not duplicate sessions", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(list([summary()], firstId))).mockResolvedValueOnce(json(list([summary(), summary(secondId, "Second fictional session")])));
    render(<OwnerSessions />);
    await user().click(await screen.findByRole("button", { name: "Load more sessions" }));
    expect(await screen.findByRole("button", { name: /Second fictional session/ })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Fictional service investigation/ })).toHaveLength(1);
    expect(vi.mocked(fetch).mock.calls[1][0]).toContain(`cursor=${firstId}`);
  });
  it("surfaces list failure without exposing backend details and retries", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ error: "secret backend message" }, 503)).mockResolvedValueOnce(json(list()));
    render(<OwnerSessions />);
    expect(await screen.findByText("Sessions could not be loaded.")).toBeTruthy();
    expect(screen.queryByText("secret backend message")).toBeNull();
    await user().click(screen.getByRole("button", { name: "Retry session list" }));
    expect(await screen.findByRole("button", { name: /Fictional service investigation/ })).toBeTruthy();
  });
  it("shows detail rejection and can retry the same record", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(list())).mockResolvedValueOnce(json({}, 403)).mockResolvedValueOnce(json(detail()));
    render(<OwnerSessions />);
    await user().click(await screen.findByRole("button", { name: /Fictional service investigation/ }));
    expect(await screen.findByText("This session could not be loaded.")).toBeTruthy();
    await user().click(screen.getByRole("button", { name: "Retry session detail" }));
    expect(await screen.findByText("Recorded fictional answer")).toBeTruthy();
  });
  it("cancels a slow list and ignores its late result", async () => {
    const slow = deferred(); vi.mocked(fetch).mockReturnValueOnce(slow.promise);
    render(<OwnerSessions />);
    expect(screen.getByRole("status", { name: "Loading sessions" })).toBeTruthy();
    await user().click(screen.getByRole("button", { name: "Cancel loading sessions" }));
    expect((vi.mocked(fetch).mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
    await act(async () => slow.resolve(json(list())));
    expect(screen.getByText("Session loading stopped.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Fictional service investigation/ })).toBeNull();
  });
  it("cancels detail loading and ignores its late result", async () => {
    const slow = deferred(); vi.mocked(fetch).mockResolvedValueOnce(json(list())).mockReturnValueOnce(slow.promise);
    render(<OwnerSessions />);
    await user().click(await screen.findByRole("button", { name: /Fictional service investigation/ }));
    await user().click(await screen.findByRole("button", { name: "Cancel loading detail" }));
    expect((vi.mocked(fetch).mock.calls[1][1]?.signal as AbortSignal).aborted).toBe(true);
    await act(async () => slow.resolve(json(detail())));
    expect(screen.getByText("Session detail loading stopped.")).toBeTruthy();
    expect(screen.queryByText("Recorded fictional answer")).toBeNull();
  });
  it("ignores a late detail from the previously selected session", async () => {
    const slow = deferred();
    vi.mocked(fetch).mockResolvedValueOnce(json(list([summary(), summary(secondId, "Second fictional session")]))).mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce(json(detail(summary(secondId, "Second fictional session"), "Fresh second answer")));
    render(<OwnerSessions />);
    await user().click(await screen.findByRole("button", { name: /Fictional service investigation/ }));
    await user().click(screen.getByRole("button", { name: /Second fictional session/ }));
    expect(await screen.findByText("Fresh second answer")).toBeTruthy();
    await act(async () => slow.resolve(json(detail())));
    expect(screen.queryByText("Recorded fictional answer")).toBeNull();
    expect(screen.getByText("Fresh second answer")).toBeTruthy();
  });
  it("changes workspace filter, cancels stale detail and clears prior records", async () => {
    const slow = deferred();
    vi.mocked(fetch).mockResolvedValueOnce(json(list())).mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce(json(list([summary(secondId, "Demo fictional session", demoId)])));
    render(<OwnerSessions />);
    await user().click(await screen.findByRole("button", { name: /Fictional service investigation/ }));
    await selectDemoWorkspace();
    expect(await screen.findByRole("button", { name: /Demo fictional session/ })).toBeTruthy();
    await act(async () => slow.resolve(json(detail())));
    expect(screen.queryByText("Recorded fictional answer")).toBeNull();
    expect(screen.queryByRole("button", { name: /Fictional service investigation/ })).toBeNull();
    expect(vi.mocked(fetch).mock.calls[2][0]).toContain(`workspaceId=${demoId}`);
  });
  it("rejects a mismatched detail record and malformed list data", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(list())).mockResolvedValueOnce(json(detail(summary(secondId))));
    const rendered = render(<OwnerSessions />);
    await user().click(await screen.findByRole("button", { name: /Fictional service investigation/ }));
    expect(await screen.findByText("This session could not be loaded.")).toBeTruthy();
    rendered.unmount(); vi.mocked(fetch).mockResolvedValue(json({ sessions: [{ id: "wrong" }] }));
    render(<OwnerSessions />);
    expect(await screen.findByText("Sessions could not be loaded.")).toBeTruthy();
  });
  it("aborts pending detail requests when the sessions view unmounts", async () => {
    const slow = deferred(); vi.mocked(fetch).mockResolvedValueOnce(json(list())).mockReturnValueOnce(slow.promise);
    const view = render(<OwnerSessions />);
    await user().click(await screen.findByRole("button", { name: /Fictional service investigation/ }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    view.unmount();
    expect((vi.mocked(fetch).mock.calls[1][1]?.signal as AbortSignal).aborted).toBe(true);
    await act(async () => slow.resolve(json(detail())));
  });
  it("shows sparse failed and interrupted records without inventing an answer or completed activity", async () => {
    const record = detail();
    const failed = { ...record.turns[0], status: "FAILED", answer: null, completedAt: null,
      activity: [{ id: ownerId, tool: "readOrder", status: "running" }] };
    const interrupted = { ...failed, id: demoId, status: "INTERRUPTED", activity: [] };
    vi.mocked(fetch).mockResolvedValueOnce(json(list())).mockResolvedValueOnce(json({ session: record.session, turns: [failed, interrupted] }));
    render(<OwnerSessions />);
    await user().click(await screen.findByRole("button", { name: /Fictional service investigation/ }));
    expect(await screen.findByText("Failed", { exact: true })).toBeTruthy();
    expect(screen.getByText("Interrupted", { exact: true })).toBeTruthy();
    expect(screen.getAllByText("No completed answer was recorded.")).toHaveLength(2);
    expect(screen.getByText(/Last recorded: running; outcome unconfirmed/)).toBeTruthy();
    expect(screen.queryByText("Recorded fictional answer")).toBeNull();
  });
  it("renders a source-only saved canvas with missing optional fields and no acting controls", async () => {
    const record = detail();
    const workspace = { runId: ownerId, workspaceId: ownerId, mode: "mock", type: "clarification", title: "Fictional incomplete investigation",
      summary: "Only the recorded source could be displayed.", status: "SOURCE_ONLY", items: [], excerpts: [], proposal: null,
      missingInformation: ["More service details required."], followUps: [], scope: { ordersRead: 0, knowledgeHits: 0, checkedAt: "2026-10-09T00:00:00Z" } };
    vi.mocked(fetch).mockResolvedValueOnce(json(list())).mockResolvedValueOnce(json({ ...record, turns: [{ ...record.turns[0], answer: null, workspace }] }));
    render(<OwnerSessions />);
    await user().click(await screen.findByRole("button", { name: /Fictional service investigation/ }));
    expect(await screen.findByText("Fictional incomplete investigation")).toBeTruthy();
    expect(screen.getByText("SOURCE_ONLY")).toBeTruthy();
    expect(screen.getByText("Mock result")).toBeTruthy();
    expect(screen.getByText("More service details required.")).toBeTruthy();
    expect(screen.getByText("Historical snapshot. Current records may have changed; browsing this history does not update them.")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Session detail" })).queryByRole("button")).toBeNull();
  });
  it("discards a stale list after changing the workspace filter", async () => {
    const slow = deferred();
    vi.mocked(fetch).mockResolvedValueOnce(json(list())).mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce(json(list([summary(secondId, "Fresh Demo history", demoId)])));
    render(<OwnerSessions />);
    await screen.findByRole("button", { name: /Fictional service investigation/ });
    await user().click(screen.getByRole("button", { name: "Refresh sessions" }));
    await selectDemoWorkspace();
    expect(await screen.findByRole("button", { name: /Fresh Demo history/ })).toBeTruthy();
    expect((vi.mocked(fetch).mock.calls[1][1]?.signal as AbortSignal).aborted).toBe(true);
    await act(async () => slow.resolve(json(list())));
    expect(screen.queryByRole("button", { name: /Fictional service investigation/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Fresh Demo history/ })).toBeTruthy();
  });
});
