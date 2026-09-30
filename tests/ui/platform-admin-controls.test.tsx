// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfigProvider } from "antd";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DemoResetCard } from "../../src/components/admin/demo-reset/demo-reset-card";
import { GuestAiBudgetCard } from "../../src/components/admin/guest-ai-budget/guest-ai-budget-card";

const response = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
}) as Response;

const demoStatus = (generation: number, orderCount = 4) => ({ generation, orderCount });
const budgetStatus = (limit: number) => ({ used: 4, limit, remaining: limit - 4, resetAt: "2026-10-01T16:00:00.000Z" });

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function renderCard(card: ReactNode) {
  return render(<ConfigProvider theme={{ token: { motion: false } }}>{card}</ConfigProvider>);
}

async function confirmDemoReset(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText(/Type RESET DEMO to confirm/), "RESET DEMO");
  const trigger = screen.getByRole("button", { name: "Reset Demo" });
  await user.click(trigger);
  const buttons = await screen.findAllByRole("button", { name: "Reset Demo" });
  await user.click(buttons[buttons.length - 1]);
}

describe("rendered platform controls", () => {
  it("confirms Demo reset with the displayed generation, reloads status, and blocks duplicate submission", async () => {
    let finishReset!: (result: Response) => void;
    const pendingReset = new Promise<Response>((resolve) => { finishReset = resolve; });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(demoStatus(3)))
      .mockReturnValueOnce(pendingReset)
      .mockResolvedValueOnce(response(demoStatus(4)));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup({ delay: null });
    renderCard(<DemoResetCard />);
    const card = screen.getByText("Reset shared Demo data").closest(".ant-card") as HTMLElement;
    expect(await within(card).findByText("Current generation")).toBeTruthy();

    await confirmDemoReset(user);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe("/api/platform/demo/reset");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ confirm: "RESET DEMO", expectedGeneration: 3 });
    const resetButton = within(card).getByRole("button", { name: /Reset Demo/ });
    expect((resetButton as HTMLButtonElement).disabled).toBe(true);
    await user.click(resetButton);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => { finishReset(response({ generation: 4 })); });
    expect(await within(card).findByText("Demo reset complete. Open a new Guest visit to view the starter orders.")).toBeTruthy();
    expect(await within(card).findByText("Current generation")).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[2][0]).toBe("/api/platform/demo/reset");
  });

  it("reports an unknown reset result and refreshes generation before offering another attempt", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(demoStatus(5, 3)))
      .mockResolvedValueOnce(response({ error: "unknown" }, 503))
      .mockResolvedValueOnce(response(demoStatus(6, 4)));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup({ delay: null });
    renderCard(<DemoResetCard />);
    const card = screen.getByText("Reset shared Demo data").closest(".ant-card") as HTMLElement;
    await within(card).findByText("Current generation");
    await confirmDemoReset(user);

    expect(await within(card).findByText("Demo generation changed. Check the current orders before another reset.")).toBeTruthy();
    expect((within(card).getByLabelText(/Type RESET DEMO to confirm/) as HTMLInputElement).value).toBe("");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ confirm: "RESET DEMO", expectedGeneration: 5 });
    const generationStat = within(card).getByText("Current generation").closest(".ant-statistic") as HTMLElement;
    expect(within(generationStat).getByText("6")).toBeTruthy();
  });

  it("saves a changed Guest AI limit once and refreshes the shared snapshot", async () => {
    let finishSave!: (result: Response) => void;
    const pendingSave = new Promise<Response>((resolve) => { finishSave = resolve; });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(budgetStatus(10)))
      .mockReturnValueOnce(pendingSave)
      .mockResolvedValueOnce(response(budgetStatus(12)));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup({ delay: null });
    renderCard(<GuestAiBudgetCard />);
    const card = screen.getByText("Shared Guest AI allowance").closest(".ant-card") as HTMLElement;
    await within(card).findByText("Used today");
    const limitInput = await within(card).findByLabelText("Daily paid AI call limit");
    expect((limitInput as HTMLInputElement).value).toBe("10");
    const usedStat = within(card).getByText("Used today").closest(".ant-statistic") as HTMLElement;
    const remainingStat = within(card).getByText("Remaining").closest(".ant-statistic") as HTMLElement;
    expect(within(usedStat).getByText("4")).toBeTruthy();
    expect(within(remainingStat).getByText("6")).toBeTruthy();
    expect((within(card).getByRole("button", { name: "Save limit" }) as HTMLButtonElement).disabled).toBe(true);

    await user.clear(limitInput);
    await user.type(limitInput, "12");
    const saveButton = within(card).getByRole("button", { name: "Save limit" });
    await user.click(saveButton);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect((saveButton as HTMLButtonElement).disabled).toBe(true);
    await user.click(saveButton);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => { finishSave(response({ limit: 12 })); });
    await within(card).findByText("Guest AI daily allowance saved.");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/platform/guest-ai-budget");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ limit: 12 });
    const dailyLimit = within(card).getByText("Daily limit").closest(".ant-statistic") as HTMLElement;
    expect(within(dailyLimit).getByText("12")).toBeTruthy();
    expect(within(usedStat).getByText("4")).toBeTruthy();
    expect(within(remainingStat).getByText("8")).toBeTruthy();
    expect(within(card).getByText(/Resets .* \(Malaysia time\)/)).toBeTruthy();
  });

  it("keeps the current Guest budget visible and gives a retryable error when saving fails", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(budgetStatus(10)))
      .mockResolvedValueOnce(response({ error: "unavailable" }, 503));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup({ delay: null });
    renderCard(<GuestAiBudgetCard />);
    const card = screen.getByText("Shared Guest AI allowance").closest(".ant-card") as HTMLElement;
    await within(card).findByText("Used today");
    const limitInput = await within(card).findByLabelText("Daily paid AI call limit");
    await user.clear(limitInput);
    await user.type(limitInput, "12");
    await user.click(within(card).getByRole("button", { name: "Save limit" }));

    expect(await within(card).findByText("Guest AI allowance could not be saved. Please retry.")).toBeTruthy();
    const dailyLimit = within(card).getByText("Daily limit").closest(".ant-statistic") as HTMLElement;
    expect(within(dailyLimit).getByText("10")).toBeTruthy();
    expect((within(card).getByRole("button", { name: "Save limit" }) as HTMLButtonElement).disabled).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
