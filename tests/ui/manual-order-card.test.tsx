// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManualOrderCard } from "../../src/app/workspaces/[workspaceId]/manual-order-card";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const BRANCH = "22222222-2222-4222-8222-222222222222";
const CUSTOMER = "33333333-3333-4333-8333-333333333333";
const base = `/api/workspaces/${WORKSPACE}`;
const choices = { generation: 4, branches: [{ id: BRANCH, code: "HQ", name: "Fictional Hub" }], customers: [] as { id: string; name: string }[] };
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function choose(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(await screen.findByText(option, { selector: ".ant-select-item-option-content" }));
}

async function orderFields(user: ReturnType<typeof userEvent.setup>) {
  await choose(user, "Branch", "HQ Fictional Hub");
  await user.type(screen.getByRole("textbox", { name: "Order number" }), "MOCK-001");
  await user.type(screen.getByRole("textbox", { name: "Service type" }), "Filter service");
  await user.type(screen.getByRole("textbox", { name: "Problem description" }), "Fictional filter requires review");
}

describe("manual order creation rendered interactions", () => {
  it("creates the first customer and order without extraction, freezes pending fields and submits once", async () => {
    const user = userEvent.setup({ delay: null });
    let finish!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => { finish = resolve; });
    const fetchMock = vi.fn().mockResolvedValueOnce(response(choices)).mockReturnValueOnce(pending).mockResolvedValueOnce(response(choices));
    vi.stubGlobal("fetch", fetchMock);
    const onCreated = vi.fn();
    render(<ManualOrderCard workspaceId={WORKSPACE} isGuest={false} onCreated={onCreated} />);
    await screen.findByText("No existing customers yet. Create a new customer with this order to continue.");
    await orderFields(user);
    await user.type(screen.getByRole("textbox", { name: "Customer name" }), "Fictional Owner Customer");
    await user.type(screen.getByRole("textbox", { name: "Customer address" }), "12 Fictional Street");
    const submit = screen.getByRole("button", { name: "Create order" });
    await user.dblClick(submit);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((screen.getByRole("textbox", { name: "Order number" }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("textbox", { name: "Customer name" }) as HTMLInputElement).disabled).toBe(true);
    expect(fetchMock.mock.calls[1][0]).toBe(`${base}/order-intake/confirm`);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ confirmed: true, expectedGeneration: 4, branchId: BRANCH,
      orderNo: "MOCK-001", serviceType: "Filter service", problemDescription: "Fictional filter requires review",
      customer: { mode: "NEW", name: "Fictional Owner Customer", phone: null, address: "12 Fictional Street" } });
    await act(async () => { finish(response({ order: { id: "created" } }, 201)); });
    await screen.findByText("Order created in this workspace.");
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/draft"))).toBe(false);
  }, 15_000);

  it("preserves the existing-customer endpoint and shows a recoverable rejection", async () => {
    const user = userEvent.setup({ delay: null });
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ ...choices, customers: [{ id: CUSTOMER, name: "Existing fictional customer" }] }))
      .mockResolvedValueOnce(response({ error: "rejected" }, 409));
    vi.stubGlobal("fetch", fetchMock);
    render(<ManualOrderCard workspaceId={WORKSPACE} isGuest onCreated={vi.fn()} />);
    await waitFor(() => expect(screen.queryByText("Loading branch and customer choices…")).toBeNull());
    await orderFields(user);
    await choose(user, "Existing customer", "Existing fictional customer");
    await user.click(screen.getByRole("button", { name: "Create order" }));
    await screen.findByText("The order or workspace data changed. Retry the options, review the details, and submit again.");
    expect(fetchMock.mock.calls[1][0]).toBe(`${base}/orders`);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).customerId).toBe(CUSTOMER);
    expect((screen.getByRole("textbox", { name: "Order number" }) as HTMLInputElement).value).toBe("MOCK-001");
    expect((screen.getByRole("textbox", { name: "Order number" }) as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByRole("button", { name: "Retry options" })).toBeTruthy();
  });

  it("retries options after a network error and validates the optional phone", async () => {
    const user = userEvent.setup({ delay: null });
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(response(choices));
    vi.stubGlobal("fetch", fetchMock);
    render(<ManualOrderCard workspaceId={WORKSPACE} isGuest={false} onCreated={vi.fn()} />);
    await screen.findByText("Order options are unavailable. Retry to load the current branch and customer choices.");
    await user.click(screen.getByRole("button", { name: "Retry options" }));
    await screen.findByText("No existing customers yet. Create a new customer with this order to continue.");
    await orderFields(user);
    await user.type(screen.getByRole("textbox", { name: "Customer name" }), "Fictional person");
    await user.type(screen.getByRole("textbox", { name: "Customer address" }), "Fictional place");
    await user.type(screen.getByRole("textbox", { name: "Customer phone (optional)" }), "invalid");
    expect((screen.getByRole("button", { name: "Create order" }) as HTMLButtonElement).disabled).toBe(true);
    await user.clear(screen.getByRole("textbox", { name: "Customer phone (optional)" }));
    expect((screen.getByRole("button", { name: "Create order" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("ignores old workspace options after context changes", async () => {
    let finishOptions!: (value: Response) => void;
    const oldOptions = new Promise<Response>((resolve) => { finishOptions = resolve; });
    const fetchMock = vi.fn().mockReturnValueOnce(oldOptions).mockResolvedValueOnce(response({ ...choices, branches: [{ id: BRANCH, name: "Current workspace branch" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<ManualOrderCard workspaceId={WORKSPACE} isGuest={false} onCreated={vi.fn()} />);
    view.rerender(<ManualOrderCard workspaceId="44444444-4444-4444-8444-444444444444" isGuest={false} onCreated={vi.fn()} />);
    await screen.findByText("No existing customers yet. Create a new customer with this order to continue.");
    await act(async () => { finishOptions(response(choices)); });
    await userEvent.setup().click(screen.getByRole("combobox", { name: "Branch" }));
    expect(await screen.findByText("Current workspace branch", { selector: ".ant-select-item-option-content" })).toBeTruthy();
    expect(screen.queryByText("HQ Fictional Hub", { selector: ".ant-select-item-option-content" })).toBeNull();
    expect(within(view.container).queryByText("Order created in this workspace.")).toBeNull();
  });

  it("ignores an old workspace write completion after navigation", async () => {
    const user = userEvent.setup({ delay: null });
    let finish!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => { finish = resolve; });
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ ...choices, customers: [{ id: CUSTOMER, name: "Existing fictional customer" }] }))
      .mockReturnValueOnce(pending).mockResolvedValueOnce(response(choices));
    vi.stubGlobal("fetch", fetchMock);
    const onCreated = vi.fn();
    const view = render(<ManualOrderCard workspaceId={WORKSPACE} isGuest={false} onCreated={onCreated} />);
    await waitFor(() => expect(screen.queryByText("Loading branch and customer choices…")).toBeNull());
    await orderFields(user);
    await choose(user, "Existing customer", "Existing fictional customer");
    await user.click(screen.getByRole("button", { name: "Create order" }));
    view.rerender(<ManualOrderCard workspaceId="44444444-4444-4444-8444-444444444444" isGuest={false} onCreated={onCreated} />);
    await screen.findByText("No existing customers yet. Create a new customer with this order to continue.");
    await act(async () => { finish(response({ order: { id: "old-context-order" } }, 201)); });
    expect(screen.queryByText("Order created in this workspace.")).toBeNull();
    expect(onCreated).not.toHaveBeenCalled();
  });
});
