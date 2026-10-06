// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActorContext } from "@/lib/auth/actor-policy";
const mocks = vi.hoisted(() => ({ context: vi.fn() }));
vi.mock("@/lib/auth/workspace-request-context", () => ({ getWorkspaceRequestContext: mocks.context }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }), notFound: () => { throw new Error("Not found"); } }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a> }));
import OrdersPage from "./orders/page";
import KnowledgePage from "./knowledge/page";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const params = Promise.resolve({ workspaceId });
const order = { id, order_no: "MOCK-ASSIGNED", branch_id: id, status: "ASSIGNED", problem_description: "Synthetic assignment", service_type: "Synthetic service", scheduled_at: null, assigned_technician_id: id, updated_at: "2026-10-01T00:00:00Z" };
function actor(role: "ADMIN" | "MANAGER" | "TECHNICIAN"): ActorContext { return { authUserId: id, profileId: id, platformRole: "SUPER_ADMIN", isAnonymous: false, membership: { workspaceId, kind: "OWNER", role }, preview: { readOnly: true, effectiveEmployeeProfileId: role === "TECHNICIAN" ? id : null, effectiveEmployeeName: role === "TECHNICIAN" ? "Synthetic Selected Technician" : null } }; }
beforeEach(() => { vi.resetAllMocks(); window.history.replaceState({}, "", "/"); vi.stubGlobal("fetch", vi.fn(async () => Response.json({ generation: 1, orders: [order], hits: [] }))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("actual workspace pages under Owner read-only preview", () => {
  it.each(["ADMIN", "MANAGER", "TECHNICIAN"] as const)("renders readable %s orders without business mutation or AI controls", async (role) => {
    mocks.context.mockResolvedValue({ actor: actor(role), guestVisit: null }); render(await OrdersPage({ params }));
    await screen.findByText(order.order_no); await userEvent.setup({ delay: null }).click(screen.getByRole("button", { name: "View details" })); expect(within(screen.getByRole("dialog")).getByText("Synthetic assignment", { exact: true })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Start assigned job|Complete job|Create order|Reschedule|Upload/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Prepare an assignment|AI Workspace/ })).toBeNull();
    expect(screen.queryByText("AI Assist", { exact: false })).toBeNull();
    expect(screen.queryByText("Manual order", { exact: false })).toBeNull();
    expect(screen.queryByLabelText("New scheduled time")).toBeNull();
    expect(screen.queryByLabelText("Order workbook")).toBeNull();
    if (role === "TECHNICIAN") expect(screen.getByText("Synthetic Selected Technician", { exact: true })).toBeTruthy();
    expect(vi.mocked(fetch)).toHaveBeenCalledExactlyOnceWith(`/api/workspaces/${workspaceId}/orders`, expect.objectContaining({ cache: "no-store" }));
  });
  it.each(["ADMIN", "MANAGER", "TECHNICIAN"] as const)("renders %s knowledge search without upload/edit/publish controls", async (role) => {
    mocks.context.mockResolvedValue({ actor: actor(role), guestVisit: null }); render(await KnowledgePage({ params })); await screen.findByRole("button", { name: "Search" });
    expect(screen.queryByRole("button", { name: /Create document|Stage|Publish|Index|Upload/ })).toBeNull(); expect(screen.queryByLabelText("Source text")).toBeNull(); expect(screen.queryByLabelText("PDF file")).toBeNull();
  });
});
