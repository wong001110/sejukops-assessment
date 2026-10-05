// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActorContext } from "@/lib/auth/actor-policy";
const mocks = vi.hoisted(() => ({ context: vi.fn() }));
vi.mock("@/lib/auth/workspace-request-context", () => ({ getWorkspaceRequestContext: mocks.context }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("Not found"); } }));
vi.mock("next/link", () => ({ default: ({ children, href, ...props }: { children: ReactNode; href: string }) => <a href={href} {...props}>{children}</a> }));
import { OperationsOverview } from "./operations-overview";
import OverviewPage from "./overview/page";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const params = Promise.resolve({ workspaceId });
const order = { id, order_no: "MOCK-OVERVIEW", status: "ASSIGNED", service_type: "Synthetic service", problem_description: "Synthetic request", scheduled_at: null, assigned_technician_id: id };
const actor = (role: "ADMIN" | "MANAGER" | "TECHNICIAN", preview = false): ActorContext => ({ authUserId: id, profileId: id, platformRole: "SUPER_ADMIN", isAnonymous: false, membership: { workspaceId, kind: "OWNER", role }, ...(preview ? { preview: { readOnly: true, effectiveEmployeeProfileId: role === "TECHNICIAN" ? id : null } } : {}) });
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("fetch", vi.fn(async () => Response.json({ generation: 1, orders: [order] }))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("actual role overview page", () => {
  it.each(["ADMIN", "MANAGER", "TECHNICIAN"] as const)("renders %s preview reads without assignment/mutation controls", async (role) => {
    mocks.context.mockResolvedValue({ actor: actor(role, true), guestVisit: null });
    render(await OverviewPage({ params }));
    await screen.findByText(order.order_no);
    expect(screen.getByText("Read-only perspective")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Assignment/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Open schedule/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Create|Assign|Reschedule|Start|Complete/ })).toBeNull();
    expect(screen.getByText(/Counts cover only the recent/).textContent).toContain("up to 20");
    expect(vi.mocked(fetch)).toHaveBeenCalledExactlyOnceWith(`/api/workspaces/${workspaceId}/orders`, expect.objectContaining({ cache: "no-store" }));
  });
  it("denies missing, mismatched and onboarding actors before rendering", async () => {
    for (const context of [null, { actor: { ...actor("ADMIN"), membership: undefined } }, { actor: { ...actor("ADMIN"), membership: { ...actor("ADMIN").membership!, workspaceId: id } } }, { actor: { ...actor("ADMIN"), businessReady: false } }]) {
      mocks.context.mockResolvedValue(context);
      await expect(OverviewPage({ params })).rejects.toThrow("Not found");
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it("shows failure without stale counts, retries, then handles empty data", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({}, { status: 500 })).mockResolvedValueOnce(Response.json({ orders: [] }));
    render(<OperationsOverview workspaceId={workspaceId} role="ADMIN" readOnly={false} canAssign={true} isGuest={false} />);
    await screen.findByText("Overview could not be loaded.");
    expect(screen.queryByLabelText("Visible recent order counts")).toBeNull();
    await userEvent.setup({ delay: null }).click(screen.getByRole("button", { name: "Refresh overview" }));
    await screen.findByText("No recent orders are visible.");
    expect(screen.queryByText("Overview could not be loaded.")).toBeNull();
  });
  it("ignores an old scope response after workspace change", async () => {
    let finishOld!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; })).mockResolvedValueOnce(Response.json({ orders: [] }));
    const view = render(<OperationsOverview workspaceId={workspaceId} role="TECHNICIAN" readOnly={false} canAssign={false} isGuest={false} />);
    view.rerender(<OperationsOverview workspaceId={id} role="TECHNICIAN" readOnly={false} canAssign={false} isGuest={false} />);
    await screen.findByText("No recent assigned jobs are visible.");
    finishOld(Response.json({ orders: [order] }));
    await waitFor(() => expect(screen.queryByText(order.order_no)).toBeNull());
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
});
