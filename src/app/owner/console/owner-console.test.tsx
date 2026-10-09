// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), ownerEntry: vi.fn(), client: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`Redirect ${path}`); } }));
vi.mock("@/lib/auth/server-actor", () => ({ getServerActorContext: mocks.actor }));
vi.mock("@/lib/services/workspaces/owner-entry", () => ({ readOwnerWorkspaceEntry: mocks.ownerEntry }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.client }));
vi.mock("@/components/admin/ai-settings/ai-settings-workspace", () => ({ AISettingsWorkspace: () => <div>Existing AI settings component</div> }));
vi.mock("@/app/workspaces/[workspaceId]/native-agent-workspace", () => ({ NativeAgentWorkspace: (props: { presentation: string; isGuest: boolean; canAssign: boolean; workspaceId: string }) =>
  <div data-presentation={props.presentation} data-workspace={props.workspaceId} data-guest={String(props.isGuest)} data-assign={String(props.canAssign)}>Existing native workspace component</div> }));
vi.mock("./owner-sessions", () => ({ OwnerSessions: () => <div>Sessions browsing component</div> }));
import { OwnerConsole } from "./owner-console";
import OwnerConsolePage from "./page";
const workspaceId = "10000000-0000-4000-8000-000000000001";
const entry = { workspaceId, contextKey: "formal-owner", canAssign: true, manualTask: null };
const actor = { profileId: workspaceId, authUserId: workspaceId, platformRole: "SUPER_ADMIN", isAnonymous: false, businessReady: true };
const scoped = { ...actor, membership: { workspaceId, kind: "OWNER", role: "ADMIN" } };
const user = () => userEvent.setup({ delay: null });
beforeEach(() => { vi.resetAllMocks(); window.history.replaceState({}, "", "/owner/console"); mocks.actor.mockResolvedValueOnce(actor).mockResolvedValueOnce(scoped); mocks.ownerEntry.mockResolvedValue(workspaceId); });
afterEach(cleanup);

describe("Owner Console navigation and server boundary", () => {
  it("renders the Owner studio workspace and switches among three selected views", async () => {
    render(<OwnerConsole nativeWorkspace={entry} workspaceMessage="Unavailable" />);
    const workspace = screen.getByText("Existing native workspace component");
    expect(workspace.getAttribute("data-presentation")).toBe("studio");
    expect(workspace.getAttribute("data-guest")).toBe("false");
    const navigation = screen.getByRole("navigation", { name: "Owner Console navigation" });
    expect(navigation).toBeTruthy();
    for (const label of ["My Workspace", "Sessions", "AI Settings"]) {
      const navButton = screen.getByRole("button", { name: label });
      expect(navButton.getAttribute("aria-label")).toBe(label);
      expect(navButton.getAttribute("title")).toBe(label);
    }
    await user().click(screen.getByRole("button", { name: "Sessions" }));
    expect(screen.queryByText("Existing native workspace component")).toBeNull();
    expect(screen.getByText("Sessions browsing component")).toBeTruthy();
    expect(window.location.search).toBe("?view=sessions");
    await user().click(screen.getByRole("button", { name: "AI Settings" }));
    expect(screen.getByText("Existing AI settings component")).toBeTruthy();
    expect(screen.queryByText("Sessions browsing component")).toBeNull();
    expect(screen.getByRole("button", { name: "AI Settings" }).getAttribute("aria-current")).toBe("page");
    await user().click(screen.getByRole("button", { name: "My Workspace" }));
    expect(window.location.search).toBe("");
  });
  it("opens and closes mobile navigation on selecting a view", async () => {
    render(<OwnerConsole nativeWorkspace={entry} workspaceMessage="Unavailable" />);
    const toggle = screen.getByRole("button", { name: "Toggle console navigation" });
    await user().click(toggle); expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await user().click(screen.getByRole("button", { name: "Sessions" }));
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("link", { name: "Account controls" }).getAttribute("href")).toBe("/owner");
    expect(screen.getByRole("link", { name: "Staff accounts" }).getAttribute("href")).toBe("/platform/staff");
    expect(screen.getByRole("link", { name: "Demo management" }).getAttribute("href")).toBe("/platform/demo");
  });
  it("uses a compact task header while keeping the complete heading in the document", () => {
    render(<OwnerConsole nativeWorkspace={entry} workspaceMessage="Unavailable" />);
    expect(screen.getByRole("heading", { name: "My Workspace" })).toBeTruthy();
    expect(screen.getByText("Work with your agent and review the task canvas.")).toBeTruthy();
  });
  it.each([null, { ...actor, isAnonymous: true }, { ...actor, platformRole: "USER" }, { ...actor, businessReady: false }])("redirects an unauthorized actor before membership lookup", async (unauthorized) => {
    mocks.actor.mockReset().mockResolvedValue(unauthorized);
    await expect(OwnerConsolePage({ searchParams: Promise.resolve({}) })).rejects.toThrow("Redirect /owner/login");
    expect(mocks.ownerEntry).not.toHaveBeenCalled();
  });
  it("uses actual scoped membership for native entry", async () => {
    render(await OwnerConsolePage({ searchParams: Promise.resolve({}) }));
    expect(mocks.actor).toHaveBeenCalledWith(workspaceId);
    expect(screen.getByText("Existing native workspace component").getAttribute("data-assign")).toBe("true");
  });
  it.each([
    null,
    { ...scoped, membership: { workspaceId, kind: "OWNER", role: "TECHNICIAN" } },
    { ...scoped, membership: { workspaceId, kind: "DEMO", role: "ADMIN" } },
    { ...scoped, preview: { readOnly: true, effectiveEmployeeProfileId: null } },
  ])("does not grant native access to missing, Technician, wrong-workspace or preview membership", async (membershipActor) => {
    mocks.actor.mockReset().mockResolvedValueOnce(actor).mockResolvedValueOnce(membershipActor);
    render(await OwnerConsolePage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("My Workspace is unavailable")).toBeTruthy();
    expect(screen.queryByText("Existing native workspace component")).toBeNull();
    await user().click(screen.getByRole("button", { name: "AI Settings" }));
    expect(screen.getByText("Existing AI settings component")).toBeTruthy();
  });
  it("keeps settings reachable during Owner membership lookup failure", async () => {
    mocks.ownerEntry.mockRejectedValue(new Error("Internal unavailable"));
    render(await OwnerConsolePage({ searchParams: Promise.resolve({ view: "settings" }) }));
    expect(screen.getByText("Existing AI settings component")).toBeTruthy();
    expect(screen.queryByText("Internal unavailable")).toBeNull();
  });
});
