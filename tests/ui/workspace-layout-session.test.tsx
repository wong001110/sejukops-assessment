// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceRequestContext } from "@/lib/auth/workspace-request-context";
import WorkspaceLayout from "../../src/app/workspaces/[workspaceId]/layout";
import { jsonResponse } from "../helpers/ui-request";

const mocks = vi.hoisted(() => ({ context: vi.fn(), budget: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/auth/workspace-request-context", () => ({ getWorkspaceRequestContext: mocks.context }));
vi.mock("@/lib/ai/runtime/guest-ai-budget", () => ({ readGuestAiBudget: mocks.budget }));
vi.mock("next/navigation", () => ({ usePathname: () => "/workspaces/current/overview", useRouter: () => ({ refresh: mocks.refresh, push: vi.fn() }), notFound: () => { throw new Error("not found"); } }));
vi.mock("../../src/app/workspaces/[workspaceId]/workspace-nav", () => ({ WorkspaceNav: () => <span>Modes</span> }));
vi.mock("@/components/admin/owner-preview/owner-preview-panel", () => ({ OwnerPreviewPanel: () => null }));

function context(guest = true): WorkspaceRequestContext {
  return {
    actor: { authUserId: "auth", profileId: "profile", platformRole: "USER", isAnonymous: false, sessionId: "session-a", membership: { workspaceId: "current", kind: "DEMO", role: "MANAGER" } },
    client: {} as WorkspaceRequestContext["client"],
    guestVisit: guest ? { id: "visit-a", workspaceId: "current", persona: "MANAGER", demoGeneration: 1, expiresAt: "2030-01-01T00:00:00Z" } : null,
  };
}
async function layout(value: WorkspaceRequestContext) {
  mocks.context.mockResolvedValue(value); mocks.budget.mockResolvedValue({ remaining: 3, limit: 20, resetAt: "2030-01-01T00:00:00Z" });
  return WorkspaceLayout({ children: <p>Dashboard</p>, params: Promise.resolve({ workspaceId: "current" }) });
}
function openAndAsk() {
  fireEvent.click(screen.getByRole("button", { name: "Open Operations Ask AI" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Question" }), { target: { value: "Show my jobs" } });
  fireEvent.click(screen.getByRole("button", { name: "Ask AI" }));
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("resolved workspace layout assistant session lifecycle", () => {
  it("keeps Guest results after server refresh creates a new internal principal Auth session", async () => {
    const value = context();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ status: "INSUFFICIENT", answer: "MOCK verified state stays visible", orders: [], excerpts: [], activity: [], traceId: "mock" })));
    const view = render(await layout(value)); openAndAsk();
    expect(await screen.findByText("MOCK verified state stays visible")).toBeTruthy();
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    view.rerender(await layout({ ...value, actor: { ...value.actor, sessionId: "session-b" } }));
    expect(screen.getByText("MOCK verified state stays visible")).toBeTruthy();
    expect(screen.getByText("Show my jobs")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Question" }) as HTMLTextAreaElement).value).toBe("");
  });
  it.each(["visit", "generation", "formal-session"])("aborts and clears the assistant when %s changes", async (change) => {
    const value = context(change !== "formal-session");
    const fetchMock = vi.fn().mockReturnValue(new Promise<Response>(() => {})); vi.stubGlobal("fetch", fetchMock);
    const view = render(await layout(value)); openAndAsk(); await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const changed = change === "formal-session" ? { ...value, actor: { ...value.actor, sessionId: "session-b" } }
      : { ...value, guestVisit: { ...value.guestVisit!, ...(change === "visit" ? { id: "visit-b" } : { demoGeneration: 2 }) } };
    view.rerender(await layout(changed));
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    expect(screen.queryByRole("textbox", { name: "Question" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open Operations Ask AI" }));
    expect((screen.getByRole("textbox", { name: "Question" }) as HTMLTextAreaElement).value).toBe("");
  });
});
