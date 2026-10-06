// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KnowledgeWorkspace } from "../../src/app/workspaces/[workspaceId]/knowledge/workspace";
import { deferred, jsonResponse } from "../helpers/ui-request";

const review = { documentId: "fictional-document", versionId: "fictional-version", title: "Fictional filter guide",
  sourceLabel: "Fictional manual", sourceText: "Disconnect power before filter inspection.", sourceKind: "TEXT", indexState: "READY", indexError: null };
const hit = (content: string) => ({ content, citation: { documentId: review.documentId, versionId: review.versionId,
  title: review.title, sourceLabel: review.sourceLabel, section: "Filter", page: 1, ordinal: 0 } });
const workspace = (workspaceId = "current-workspace", canEdit = true) => <KnowledgeWorkspace workspaceId={workspaceId} canEdit={canEdit} isDemo={false} />;
const button = (name: string) => screen.getByRole("button", { name: new RegExp(`${name}$`) });
const disabled = (name: string) => (button(name) as HTMLButtonElement).disabled;
async function ready(field = "Search text") { await waitFor(() => expect((screen.getByRole("textbox", { name: field }) as HTMLInputElement).disabled).toBe(false)); }
function query(value = "filter") { fireEvent.change(screen.getByRole("textbox", { name: "Search text" }), { target: { value } }); }
async function draftFields() {
  fireEvent.click(screen.getByRole("tab", { name: "Manage knowledge" }));
  await ready("Title");
  fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "New fictional guide" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Source label" }), { target: { value: "New fictional source" } });
}
beforeEach(() => window.history.replaceState(null, "", "/workspaces/current-workspace/knowledge"));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("rendered knowledge workspace request lifecycle", () => {
  it("aborts obsolete initial loads and keeps the current workspace generation", async () => {
    const old = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(jsonResponse({ generation: 7 }))
      .mockResolvedValueOnce(jsonResponse({ documentId: "new-document" }, 201));
    vi.stubGlobal("fetch", fetchMock);
    const view = render(workspace("old-workspace"));
    view.rerender(workspace());
    await ready();
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    await act(async () => old.resolve(jsonResponse({ generation: 1 })));
    await draftFields(); fireEvent.click(button("Create draft"));
    expect(await screen.findByText("Private draft created. Add text next.")).toBeTruthy();
    expect(JSON.parse(String(fetchMock.mock.calls[2][1].body)).generation).toBe(7);
    expect(fetchMock.mock.calls[2][0]).toBe("/api/workspaces/current-workspace/knowledge");
  });

  it("rejects late parsed search data after workspace changes", async () => {
    const oldJson = deferred<unknown>();
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ generation: 1 }))
      .mockResolvedValueOnce({ ok: true, json: () => oldJson.promise } as Response)
      .mockResolvedValueOnce(jsonResponse({ generation: 2 })).mockResolvedValueOnce(jsonResponse({ hits: [hit("Current source evidence")] }));
    vi.stubGlobal("fetch", fetchMock);
    const view = render(workspace("old-workspace")); await ready(); query();
    fireEvent.click(button("Search"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    view.rerender(workspace()); await ready(); query("current source");
    fireEvent.click(button("Search"));
    expect(await screen.findByText("Current source evidence")).toBeTruthy();
    await act(async () => oldJson.resolve({ hits: [hit("Obsolete source evidence")] }));
    expect(screen.queryByText("Obsolete source evidence")).toBeNull();
    expect(disabled("Search")).toBe(false);
  });

  it("suppresses same-tick duplicate commands and freezes pending fields", async () => {
    const pending = deferred<Response>();
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ generation: 1 })).mockReturnValueOnce(pending.promise);
    vi.stubGlobal("fetch", fetchMock);
    render(workspace()); await ready(); await draftFields();
    const submit = button("Create draft");
    act(() => { submit.click(); submit.click(); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).disabled).toBe(true);
    await act(async () => pending.resolve(jsonResponse({ documentId: "new-document" }, 201)));
    expect(await screen.findByText("Private draft created. Add text next.")).toBeTruthy();
    expect(disabled("Create draft")).toBe(false);
  });

  it("aborts a running command on unmount and never changes a later page URL", async () => {
    const pending = deferred<Response>();
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ generation: 1 })).mockReturnValueOnce(pending.promise);
    vi.stubGlobal("fetch", fetchMock);
    const view = render(workspace()); await ready(); await draftFields();
    fireEvent.click(button("Create draft"));
    view.unmount(); window.history.replaceState(null, "", "/later-page?keep=1");
    expect((fetchMock.mock.calls[1][1] as RequestInit).signal?.aborted).toBe(true);
    await act(async () => pending.resolve(jsonResponse({ documentId: "obsolete-document" }, 201)));
    expect(window.location.pathname + window.location.search).toBe("/later-page?keep=1");
  });

  it("clears the previous review URL when creating a new draft", async () => {
    window.history.replaceState(null, "", "/workspaces/current-workspace/knowledge?reviewDocumentId=fictional-document&reviewVersionId=fictional-version");
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ generation: 1, review }))
      .mockResolvedValueOnce(jsonResponse({ documentId: "new-document" }, 201));
    vi.stubGlobal("fetch", fetchMock);
    render(workspace()); expect(await screen.findByText(review.sourceText)).toBeTruthy();
    await ready("Title"); await draftFields(); fireEvent.click(button("Create draft"));
    expect(await screen.findByText("Private draft created. Add text next.")).toBeTruthy();
    expect(window.location.search).toBe("");
    expect(screen.queryByText(review.sourceText)).toBeNull();
    expect(screen.queryByRole("button", { name: "Publish this reviewed version" })).toBeNull();
    expect(screen.getByText("new-document")).toBeTruthy();
  });

  it("drops private review state when editing permission changes", async () => {
    window.history.replaceState(null, "", "/workspaces/current-workspace/knowledge?reviewDocumentId=fictional-document&reviewVersionId=fictional-version");
    const pending = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(jsonResponse({ generation: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    const view = render(workspace()); view.rerender(workspace("current-workspace", false)); await ready();
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/workspaces/current-workspace/knowledge");
    await act(async () => pending.resolve(jsonResponse({ generation: 1, review })));
    expect(screen.queryByText(review.sourceText)).toBeNull();
    expect(screen.queryByRole("button", { name: "Create draft" })).toBeNull();
  });

  it("recovers an initial load failure and a rejected search without losing its query", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("Mock connection failure"))
      .mockResolvedValueOnce(jsonResponse({ generation: 1 }))
      .mockResolvedValueOnce(jsonResponse({ error: "Unavailable" }, 503))
      .mockResolvedValueOnce(jsonResponse({ hits: [hit("Recovered source evidence")] }));
    vi.stubGlobal("fetch", fetchMock);
    render(workspace()); expect(await screen.findByText("Mock connection failure")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry knowledge workspace" })); await ready(); query("keep this question");
    fireEvent.click(button("Search"));
    expect(await screen.findByText("Search unavailable.")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Search text" }) as HTMLInputElement).value).toBe("keep this question");
    fireEvent.click(button("Search"));
    expect(await screen.findByText("Recovered source evidence")).toBeTruthy();
    expect(screen.queryByText("Search unavailable.")).toBeNull();
  });

  it("ignores a stale search after back navigation while the new load is running", async () => {
    const old = deferred<Response>(); const currentLoad = deferred<Response>();
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ generation: 1 })).mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(currentLoad.promise);
    vi.stubGlobal("fetch", fetchMock);
    render(workspace()); await ready(); query(); fireEvent.click(button("Search"));
    act(() => { window.history.replaceState(null, "", "/workspaces/current-workspace/knowledge?reviewDocumentId=fictional-document&reviewVersionId=fictional-version");
      window.dispatchEvent(new PopStateEvent("popstate")); });
    expect((fetchMock.mock.calls[1][1] as RequestInit).signal?.aborted).toBe(true);
    await act(async () => old.reject(new Error("Obsolete navigation failure")));
    expect(screen.queryByText("Obsolete navigation failure")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Search knowledge" }));
    expect((screen.getByRole("textbox", { name: "Search text" }) as HTMLInputElement).disabled).toBe(true);
    await act(async () => currentLoad.resolve(jsonResponse({ generation: 1, review })));
    fireEvent.click(screen.getByRole("tab", { name: "Manage knowledge" }));
    expect(await screen.findByText(review.sourceText)).toBeTruthy();
    await ready("Title");
  });
});
