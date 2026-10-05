// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deferred, jsonResponse } from "../helpers/ui-request";
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
import { OrderIntakeCard } from "../../src/app/workspaces/[workspaceId]/order-intake";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const BRANCH = "22222222-2222-4222-8222-222222222222";
const CUSTOMER = "33333333-3333-4333-8333-333333333333";
const options = { branches: [{ id: BRANCH, code: "HQ", name: "Fictional Hub" }], customers: [{ id: CUSTOMER, name: "Fictional Customer", address: "Fictional Street" }] };
const field = (value: string) => ({ value, confidence: 1, issues: [] });
const extracted = { generation: 4, sourceSha256: "fictional-source-hash", draft: { customerName: field("Fictional Customer"),
  serviceType: field("Filter service"), serviceDetails: field("Inspect fictional filter"), amount: field("100"), date: field("2026-09-30") } };

afterEach(() => { cleanup(); vi.unstubAllGlobals(); refresh.mockClear(); });

async function extract(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(screen.getByLabelText("Source file"), new File(["fictional source"], "fictional.txt", { type: "text/plain" }));
  await user.click(screen.getByRole("button", { name: "Extract draft" }));
}

async function choose(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(await screen.findByText(option, { selector: ".ant-select-item-option-content" }));
}

async function review(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText("Extracted reference");
  await user.type(screen.getByRole("textbox", { name: "Order number" }), "DOC-MOCK-001");
  await choose(user, "Existing branch", "HQ · Fictional Hub");
  await choose(user, "Existing customer", "Fictional Customer · Fictional Street");
}

describe("document order intake rendered state", () => {
  it("freezes reviewed fields while submitting once and labels the immutable completed record", async () => {
    const user = userEvent.setup({ delay: null }); const confirmed = deferred<Response>();
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(options)).mockResolvedValueOnce(jsonResponse(extracted)).mockReturnValueOnce(confirmed.promise);
    vi.stubGlobal("fetch", fetchMock); const onCreated = vi.fn();
    render(<OrderIntakeCard workspaceId={WORKSPACE} isGuest={false} onCreated={onCreated} />);
    await extract(user); await review(user);
    await user.dblClick(screen.getByRole("button", { name: "Confirm and create this order" }));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect((screen.getByRole("textbox", { name: "Order number" }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("combobox", { name: "Customer mode" }) as HTMLInputElement).disabled).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toMatchObject({ confirmed: true, expectedGeneration: 4, orderNo: "DOC-MOCK-001", customer: { mode: "EXISTING", customerId: CUSTOMER } });
    await act(async () => confirmed.resolve(jsonResponse({ order: { id: "created" } }, 201)));
    await screen.findByText("Order created from your reviewed fields.");
    expect(screen.getByText("Order created", { selector: ".ant-tag" })).toBeTruthy();
    expect(screen.queryByText("Draft only")).toBeNull();
    expect((screen.getByRole("textbox", { name: "Problem description" }) as HTMLInputElement).disabled).toBe(true);
    expect(onCreated).toHaveBeenCalledTimes(1);
  }, 15_000);

  it("cancels extraction, retries, and ignores the old extraction completion", async () => {
    const user = userEvent.setup({ delay: null }); const oldExtract = deferred<Response>();
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(options)).mockReturnValueOnce(oldExtract.promise).mockResolvedValueOnce(jsonResponse(extracted));
    vi.stubGlobal("fetch", fetchMock);
    render(<OrderIntakeCard workspaceId={WORKSPACE} isGuest onCreated={vi.fn()} />);
    await extract(user);
    await user.click(screen.getByRole("button", { name: "Cancel extraction" }));
    expect((fetchMock.mock.calls[1][1].signal as AbortSignal).aborted).toBe(true);
    await user.click(screen.getByRole("button", { name: /Extract draft/ }));
    await screen.findByText("fictional-source-hash", { exact: false });
    await act(async () => oldExtract.resolve(jsonResponse({ ...extracted, sourceSha256: "old-source-hash" })));
    expect(screen.queryByText("old-source-hash", { exact: false })).toBeNull();
    expect(screen.getByText("fictional-source-hash", { exact: false })).toBeTruthy();
  });

  it("retries failed choices and preserves reviewed input on rejected confirmation", async () => {
    const user = userEvent.setup({ delay: null });
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(jsonResponse(extracted))
      .mockResolvedValueOnce(jsonResponse(options)).mockResolvedValueOnce(jsonResponse({ error: "stale" }, 409));
    vi.stubGlobal("fetch", fetchMock);
    render(<OrderIntakeCard workspaceId={WORKSPACE} isGuest={false} onCreated={vi.fn()} />);
    await extract(user);
    await screen.findByText("Branch and customer choices could not be loaded. Retry before confirming.");
    await user.click(screen.getByRole("button", { name: "Retry choices" }));
    await review(user);
    await user.click(screen.getByRole("button", { name: "Confirm and create this order" }));
    await screen.findByText("Order creation was rejected. Check the fields and workspace state before retrying.");
    expect((screen.getByRole("textbox", { name: "Order number" }) as HTMLInputElement).value).toBe("DOC-MOCK-001");
    expect((screen.getByRole("textbox", { name: "Order number" }) as HTMLInputElement).disabled).toBe(false);
  });

  it("ignores old confirmation completion after changing workspace", async () => {
    const user = userEvent.setup({ delay: null }); const confirmed = deferred<Response>();
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(options)).mockResolvedValueOnce(jsonResponse(extracted))
      .mockReturnValueOnce(confirmed.promise).mockResolvedValueOnce(jsonResponse(options));
    vi.stubGlobal("fetch", fetchMock); const onCreated = vi.fn();
    const view = render(<OrderIntakeCard workspaceId={WORKSPACE} isGuest={false} onCreated={onCreated} />);
    await extract(user); await review(user);
    await user.click(screen.getByRole("button", { name: "Confirm and create this order" }));
    view.rerender(<OrderIntakeCard workspaceId="44444444-4444-4444-8444-444444444444" isGuest={false} onCreated={onCreated} />);
    await act(async () => confirmed.resolve(jsonResponse({ order: { id: "old-order" } }, 201)));
    expect(screen.queryByText("Order created from your reviewed fields.")).toBeNull();
    expect(screen.queryByText("Extracted reference")).toBeNull();
    expect(onCreated).not.toHaveBeenCalled();
  });
});
