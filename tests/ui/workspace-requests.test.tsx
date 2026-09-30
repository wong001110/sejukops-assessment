// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentWorkspace, OrdersWorkspace } from "../../src/app/workspaces/[workspaceId]/workspace-client";
import { KnowledgeAssistPanel } from "../../src/app/workspaces/[workspaceId]/knowledge-assist-panel";
import { deferred, jsonResponse } from "../helpers/ui-request";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

const order = (id: string, label = id) => ({ id, order_no: label, branch_id: "branch", status: "NEW", problem_description: "Fictional service request", service_type: "Inspection", scheduled_at: null, assigned_technician_id: null, updated_at: "2026-09-30T00:00:00Z" });
const answer = (label: string) => ({ answer: label, orders: [order(label)], activity: [{ type: "RECENT_ORDERS_READ", orderCount: 1 }], traceId: "mock-trace" });
const agent = (focusOrderId?: string) => <AgentWorkspace workspaceId="mock-workspace" focusOrderId={focusOrderId} canAssign={false} manualTask={null} isGuest={false} />;

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("rendered workspace request lifecycle with synthetic responses", () => {
  it("selects an order through application history without replaying private router state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ orders: [order("selected-order")], generation: 1 })));
    const replace = vi.spyOn(window.history, "replaceState");
    window.history.replaceState({ __NA: true }, "", "/");
    replace.mockClear();
    render(<OrdersWorkspace workspaceId="mock-workspace" canAssign={false} canImport={false} canCreate={false} isGuest={false} canGuestAssign={false} canManagerReschedule={false} canAdvanceJob={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "View details" }));
    expect(window.location.search).toBe("?orderId=selected-order");
    // Next.js treats its private marker as an internal navigation and skips URL synchronization.
    const data = replace.mock.calls.at(-1)?.[0];
    expect(data?.__NA).not.toBe(true);
    expect(data?._N).not.toBe(true);
    expect(screen.getByRole("button", { name: "Selected" }).getAttribute("aria-pressed")).toBe("true");
    replace.mockRestore();
    window.history.replaceState(null, "", "/");
  });

  it("ignores a cancelled request's late error while its retry is running", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    vi.stubGlobal("fetch", fetchMock);
    render(agent());
    fireEvent.click(screen.getByRole("button", { name: /Check orders/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Check orders/ }));
    await act(async () => first.reject(new Error("Old request failed")));
    expect(screen.getByText("Checking your workspace orders…")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Check orders/ }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => second.resolve(jsonResponse(answer("Current evidence"))));
    expect(await screen.findByText("Current evidence", { selector: ".ant-alert-message" })).toBeTruthy();
    expect(screen.queryByText("Old request failed")).toBeNull();
  });

  it("clears the old order focus and aborts its request before rendering another focus", async () => {
    const first = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce(jsonResponse(answer("Second focus evidence")));
    vi.stubGlobal("fetch", fetchMock);
    const view = render(agent("first-order"));
    fireEvent.click(screen.getByRole("button", { name: /Check orders/ }));
    view.rerender(agent("second-order"));
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    expect(screen.queryByText("first-order")).toBeNull();
    expect(screen.getByText("second-order")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Check orders/ }));
    expect(await screen.findByText("Second focus evidence", { selector: ".ant-alert-message" })).toBeTruthy();
    expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body)).focusOrderId).toBe("second-order");
    await act(async () => first.resolve(jsonResponse(answer("Obsolete focus evidence"))));
    expect(screen.queryByText("Obsolete focus evidence")).toBeNull();
  });

  it("aborts paid-entry requests when leaving the rendered component", () => {
    const response = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValue(response.promise);
    vi.stubGlobal("fetch", fetchMock);
    const view = render(agent());
    fireEvent.click(screen.getByRole("button", { name: /Check orders/ }));
    view.unmount();
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
  });

  it("keeps knowledge retry active when the cancelled attempt settles late", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise));
    render(<KnowledgeAssistPanel workspaceId="mock-workspace" isGuest={false} />);
    fireEvent.change(screen.getByLabelText("Question"), { target: { value: "Fictional filter replacement" } });
    fireEvent.click(screen.getByRole("button", { name: /Find cited excerpts/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: /Find cited excerpts/ }));
    await act(async () => first.reject(new Error("Old knowledge failure")));
    expect(screen.getByText("Searching published knowledge…")).toBeTruthy();
    await act(async () => second.resolve(jsonResponse({ status: "INSUFFICIENT", answer: "No supported source yet", excerpts: [], activity: [{ type: "KNOWLEDGE_SEARCH", hitCount: 0 }], traceId: "mock-trace" })));
    expect(await screen.findByText("No supported source yet")).toBeTruthy();
    expect(screen.queryByText("Old knowledge failure")).toBeNull();
  });

  it("keeps the newest Orders refresh and hides detail actions while loading", async () => {
    const old = deferred<Response>();
    const newest = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ orders: [order("initial")], generation: 1 }))
      .mockReturnValueOnce(old.promise).mockReturnValueOnce(newest.promise));
    render(<OrdersWorkspace workspaceId="mock-workspace" canAssign={false} canImport={false} canCreate={false} isGuest={false} canGuestAssign={false} canManagerReschedule={false} canAdvanceJob={false} />);
    expect(await screen.findByText("initial")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Refresh/ }));
    fireEvent.click(screen.getByRole("button", { name: /Refresh/ }));
    expect(screen.queryByText("AI Assist for this order")).toBeNull();
    await act(async () => newest.resolve(jsonResponse({ orders: [order("newest")], generation: 2 })));
    await waitFor(() => expect(screen.getAllByText("newest").length).toBeGreaterThan(0));
    await act(async () => old.resolve(jsonResponse({ orders: [order("obsolete")], generation: 1 })));
    expect(screen.queryByText("obsolete")).toBeNull();
  });
});
