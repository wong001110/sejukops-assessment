// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrdersWorkspace } from "../../src/app/workspaces/[workspaceId]/workspace-client";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const workspaceId = "11111111-1111-4111-8111-111111111111";
function view(canImport: boolean) {
  return <OrdersWorkspace workspaceId={workspaceId} role="ADMIN" canImport={canImport}
    canAssign={false} canCreate={false} isGuest canGuestAssign={false} canManagerReschedule={false} canAdvanceJob={false} canUseAi={false} />;
}
beforeEach(() => {
  window.history.replaceState(null, "", "/orders");
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.endsWith("/options")
    ? { branches: [], customers: [] } : { orders: [], generation: 1 })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/"); });
describe("sidebar document import handoff", () => {
  it("opens and reopens the import drawer on an already mounted Orders page", async () => {
    const user = userEvent.setup({ delay: null });
    render(view(true)); await screen.findByText("No recent orders are visible in this workspace.");
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => window.dispatchEvent(new Event("workspace:import-document")));
    expect(await screen.findByRole("dialog", { name: "Import document" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    act(() => window.dispatchEvent(new Event("workspace:import-document")));
    expect(await screen.findByRole("dialog", { name: "Import document" })).toBeTruthy();
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith("/options"))).toHaveLength(2);
  });
  it("accepts the initial import hash after navigation from another page", async () => {
    window.history.replaceState(null, "", "/orders#import-document"); render(view(true));
    expect(await screen.findByRole("dialog", { name: "Import document" })).toBeTruthy();
  });
  it("ignores event and hash attempts when import is forbidden", async () => {
    window.history.replaceState(null, "", "/orders#import-document"); render(view(false));
    await screen.findByText("No recent orders are visible in this workspace.");
    act(() => window.dispatchEvent(new Event("workspace:import-document")));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith("/options"))).toBe(false);
  });
});
