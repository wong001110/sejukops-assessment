// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrdersWorkspace } from "../../src/app/workspaces/[workspaceId]/workspace-client";
import { deferred, jsonResponse } from "../helpers/ui-request";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const FIRST = "22222222-2222-4222-8222-222222222222";
const SECOND = "33333333-3333-4333-8333-333333333333";
const TECH = "44444444-4444-4444-8444-444444444444";
const order = (id: string, order_no: string, status = "ASSIGNED") => ({ id, order_no, branch_id: "branch", status,
  problem_description: "Fictional request", service_type: "Inspection", scheduled_at: "2026-10-01T01:00:00Z",
  assigned_technician_id: status === "NEW" ? null : TECH, updated_at: "2026-09-30T00:00:00Z" });
const roles = (role: "ADMIN" | "MANAGER" | "TECHNICIAN", workspaceId = WORKSPACE) => <OrdersWorkspace workspaceId={workspaceId} role={role}
  canAssign={false} canImport={false} canCreate={false} isGuest canGuestAssign={role === "ADMIN"}
  canManagerReschedule={role === "MANAGER"} canAdvanceJob={role === "TECHNICIAN"} />;

beforeEach(() => window.history.replaceState(null, "", `/orders?orderId=${FIRST}`));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function focusSecond() {
  const label = await screen.findByText("MOCK-002", { selector: "td, .tech-job-card h2" });
  const record = label.closest("tr") ?? label.closest(".tech-job-card");
  // Force an external focus event to test cleanup even while the pending Drawer
  // blocks ordinary pointer navigation. This is a lifecycle invariant, not a user click journey.
  fireEvent.click(within(record as HTMLElement).getByRole("button", { name: "View details", hidden: true }));
}

async function openAction(user: ReturnType<typeof userEvent.setup>, action: "Assign order" | "Reschedule order") {
  await user.click(await screen.findByRole("button", { name: action }));
}

async function chooseTechnician(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => expect((screen.getByRole("combobox", { name: "Demo technician" }) as HTMLInputElement).disabled).toBe(false));
  await user.click(screen.getByRole("combobox", { name: "Demo technician" }));
  await user.click(await screen.findByText("Demo technician 1", { selector: ".ant-select-item-option-content" }));
}

describe("manual role command rendered interactions", () => {
  it("retries failed technician choices and freezes one concrete assignment while pending", async () => {
    const user = userEvent.setup({ delay: null }); const pending = deferred<Response>(); let technicianCalls = 0;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith("/technicians")) return Promise.resolve(++technicianCalls === 1
        ? jsonResponse({ error: "offline" }, 503) : jsonResponse({ technicians: [{ id: TECH, branch_id: "branch" }] }));
      if (init?.method === "POST") return pending.promise;
      return Promise.resolve(jsonResponse({ orders: [order(FIRST, "MOCK-001", "NEW")], generation: 4 }));
    });
    vi.stubGlobal("fetch", fetchMock); render(roles("ADMIN"));
    await openAction(user, "Assign order");
    await screen.findByText("Technicians are unavailable. Retry the choices.");
    await user.click(screen.getByRole("button", { name: "Retry technician choices" }));
    await chooseTechnician(user);
    const time = screen.getByLabelText("Scheduled time (optional)") as HTMLInputElement;
    await user.type(time, "2026-10-02 10:00");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(time.value).toBe("2026-10-02 10:00"));
    await user.click(screen.getByRole("button", { name: "close-circle" }));
    expect(time.value).toBe("");
    await user.dblClick(screen.getByRole("button", { name: "Assign this order" }));
    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0][1]?.body))).toEqual({ expectedGeneration: 4, expectedUpdatedAt: "2026-09-30T00:00:00Z", technicianId: TECH, scheduledAt: null });
    expect((screen.getByRole("combobox", { name: "Demo order to assign" }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("combobox", { name: "Demo technician" }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("Scheduled time (optional)") as HTMLInputElement).disabled).toBe(true);
    expect(within(time.closest(".ant-drawer-content") as HTMLElement).queryByRole("button", { name: "Close" })).toBeNull();
    await act(async () => pending.resolve(jsonResponse({ order: { id: FIRST } }, 201)));
    await screen.findByText("Demo order assigned. The Technician perspective can now view it.");
    expect(technicianCalls).toBe(2);
  });

  it("sends Guest assignment datetime-local input as an explicit Malaysia-time instant", async () => {
    const user = userEvent.setup({ delay: null }); const pending = deferred<Response>();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith("/technicians")) return Promise.resolve(jsonResponse({ technicians: [{ id: TECH, branch_id: "branch" }] }));
      if (init?.method === "POST") return pending.promise;
      return Promise.resolve(jsonResponse({ orders: [order(FIRST, "MOCK-001", "NEW")], generation: 4 }));
    });
    vi.stubGlobal("fetch", fetchMock); render(roles("ADMIN"));
    await openAction(user, "Assign order");
    await chooseTechnician(user);
    const time = screen.getByLabelText("Scheduled time (optional)") as HTMLInputElement;
    await waitFor(() => expect(time.disabled).toBe(false));
    await user.type(time, "2026-10-02 10:30");
    await waitFor(() => expect(time.value).toBe("2026-10-02 10:30"));
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: "Assign this order" }));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(String(post[1]?.body))).toMatchObject({ scheduledAt: "2026-10-02T02:30:00.000Z" });
    await act(async () => pending.resolve(jsonResponse({ order: { id: FIRST } }, 201)));
  });

  it("ignores an assignment response after focusing another order", async () => {
    const user = userEvent.setup({ delay: null }); const pending = deferred<Response>();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith("/technicians")) return Promise.resolve(jsonResponse({ technicians: [{ id: TECH, branch_id: "branch" }] }));
      if (init?.method === "POST") return pending.promise;
      return Promise.resolve(jsonResponse({ orders: [order(FIRST, "MOCK-001", "NEW"), order(SECOND, "MOCK-002", "NEW")], generation: 4 }));
    });
    vi.stubGlobal("fetch", fetchMock); render(roles("ADMIN"));
    await openAction(user, "Assign order");
    await chooseTechnician(user); await user.click(screen.getByRole("button", { name: "Assign this order" }));
    await focusSecond();
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(post[1]?.signal?.aborted).toBe(true);
    await act(async () => pending.resolve(jsonResponse({ order: { id: FIRST } }, 201)));
    expect(screen.queryByText("Demo order assigned. The Technician perspective can now view it.")).toBeNull();
    await openAction(user, "Assign order");
    expect(screen.getByText("MOCK-002 (NEW)", { selector: ".ant-select-selection-item" })).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/orders"))).toHaveLength(1);
  });

  it("submits one reviewed schedule and prevents edits until its response", async () => {
    const user = userEvent.setup({ delay: null }); const pending = deferred<Response>();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => init?.method === "POST" ? pending.promise
      : Promise.resolve(jsonResponse({ orders: [order(FIRST, "MOCK-001")], generation: 4 })));
    vi.stubGlobal("fetch", fetchMock); render(roles("MANAGER"));
    await openAction(user, "Reschedule order");
    const time = await screen.findByLabelText("New scheduled time");
    await waitFor(() => expect((time as HTMLInputElement).disabled).toBe(false));
    await user.type(time, "2026-10-02 10:00");
    await user.keyboard("{Enter}");
    await user.dblClick(screen.getByRole("button", { name: "Confirm new schedule" }));
    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"); expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0][1]?.body))).toEqual({ expectedGeneration: 4, expectedUpdatedAt: "2026-09-30T00:00:00Z", scheduledAt: "2026-10-02T02:00:00.000Z" });
    const review = screen.getByText(/Review MOCK-001:/).textContent ?? "";
    expect(review).toMatch(/9:00/);
    expect(review).toMatch(/10:00/);
    expect((time as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("combobox", { name: "Order to reschedule" }) as HTMLInputElement).disabled).toBe(true);
    expect(within(time.closest(".ant-drawer-content") as HTMLElement).queryByRole("button", { name: "Close" })).toBeNull();
    await act(async () => pending.resolve(jsonResponse({ order: { id: FIRST } })));
    await screen.findByText("Schedule changed. The assigned technician is unchanged.");
  });

  it("clears schedule focus and ignores old errors after switching the selected order", async () => {
    const user = userEvent.setup({ delay: null }); const pending = deferred<Response>();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => init?.method === "POST" ? pending.promise
      : Promise.resolve(jsonResponse({ orders: [order(FIRST, "MOCK-001"), order(SECOND, "MOCK-002")], generation: 4 })));
    vi.stubGlobal("fetch", fetchMock); render(roles("MANAGER"));
    await openAction(user, "Reschedule order");
    const time = await screen.findByLabelText("New scheduled time");
    await waitFor(() => expect((time as HTMLInputElement).disabled).toBe(false));
    await user.type(time, "2026-10-02 10:00");
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: "Confirm new schedule" }));
    await focusSecond();
    expect(fetchMock.mock.calls.find(([, init]) => init?.method === "POST")![1]?.signal?.aborted).toBe(true);
    await act(async () => pending.reject(new Error("Old schedule failure")));
    expect(screen.queryByText("Old schedule failure")).toBeNull();
    await openAction(user, "Reschedule order");
    expect((screen.getByLabelText("New scheduled time") as HTMLInputElement).value).toBe("");
    expect(screen.getByText("MOCK-002", { selector: ".ant-select-selection-item" })).toBeTruthy();
  });

  it("updates a Technician job once and refreshes its current status", async () => {
    const user = userEvent.setup({ delay: null }); const pending = deferred<Response>(); let status = "ASSIGNED";
    const fetchMock = vi.fn((url: string, init?: RequestInit) => init?.method === "POST" ? pending.promise
      : Promise.resolve(jsonResponse({ orders: [order(FIRST, "MOCK-001", status)], generation: 4 })));
    vi.stubGlobal("fetch", fetchMock); render(roles("TECHNICIAN"));
    await user.dblClick(await screen.findByRole("button", { name: "Start assigned job" }));
    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"); expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0][1]?.body))).toMatchObject({ expectedGeneration: 4, expectedUpdatedAt: "2026-09-30T00:00:00Z", nextStatus: "IN_PROGRESS" });
    status = "IN_PROGRESS"; await act(async () => pending.resolve(jsonResponse({ order: { id: FIRST } })));
    await screen.findByText("Job started.");
    expect(await screen.findByRole("button", { name: "Complete job" })).toBeTruthy();
  });

  it("does not apply an old Technician status response to a new focus or trigger its reload", async () => {
    const user = userEvent.setup({ delay: null }); const pending = deferred<Response>();
    const unmountPending = deferred<Response>(); let postCount = 0;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => init?.method === "POST" ? (++postCount === 1 ? pending.promise : unmountPending.promise)
      : Promise.resolve(jsonResponse({ orders: [order(FIRST, "MOCK-001"), order(SECOND, "MOCK-002")], generation: 4 })));
    vi.stubGlobal("fetch", fetchMock); const view = render(roles("TECHNICIAN"));
    await user.click(await screen.findByRole("button", { name: "Start assigned job" }));
    await focusSecond();
    expect(fetchMock.mock.calls.find(([, init]) => init?.method === "POST")![1]?.signal?.aborted).toBe(true);
    await act(async () => pending.resolve(jsonResponse({ order: { id: FIRST } })));
    expect(screen.queryByText("Job started.")).toBeNull();
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/orders"))).toHaveLength(1);
    expect((screen.getByRole("button", { name: /Start assigned job/ }) as HTMLButtonElement).disabled).toBe(false);
    await user.click(screen.getByRole("button", { name: /Start assigned job/ }));
    const latestPost = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").at(-1)!;
    view.unmount();
    expect(latestPost[1]?.signal?.aborted).toBe(true);
  });
});
