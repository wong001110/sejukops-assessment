// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfigProvider } from "antd";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AISettingsWorkspace } from "../../src/components/admin/ai-settings/ai-settings-workspace";
import { settingsFixture } from "../fixtures/ui/workspace";
import { deferred, jsonResponse } from "../helpers/ui-request";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("rendered provider editor lifecycle", () => {
  it("blocks another provider test until the active saved-profile test finishes", async () => {
    const pending = deferred<Response>();
    const second = { ...settingsFixture.providers[0], id: "80000000-0000-4000-8000-000000000002", name: "Second mock provider" };
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ ...settingsFixture, providers: [...settingsFixture.providers, second] }))
      .mockReturnValueOnce(pending.promise).mockResolvedValueOnce(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup({ delay: null });
    render(<ConfigProvider theme={{ token: { motion: false } }}><AISettingsWorkspace /></ConfigProvider>);
    const firstCard = (await screen.findByText("Mock operations provider")).closest(".ai-provider-card") as HTMLElement;
    const secondCard = screen.getByText(second.name).closest(".ai-provider-card") as HTMLElement;
    const secondTest = within(secondCard).getByRole("button", { name: /Test$/ }) as HTMLButtonElement;
    await user.dblClick(within(firstCard).getByRole("button", { name: /Test$/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(secondTest.disabled).toBe(true);
    await user.click(secondTest);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => { pending.resolve(jsonResponse({})); });
    await waitFor(() => expect(secondTest.disabled).toBe(false));
    await user.click(secondTest);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[2][0]).toBe(`/api/admin/ai-settings/providers/${second.id}/test`);
  });

  it("freezes routing selections and submits one canonical routing request", async () => {
    const pending = deferred<Response>();
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(settingsFixture)).mockReturnValueOnce(pending.promise);
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup({ delay: null });
    render(<ConfigProvider theme={{ token: { motion: false } }}><AISettingsWorkspace /></ConfigProvider>);
    await user.dblClick(await screen.findByRole("button", { name: "Save routing" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect((screen.getByRole("combobox") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("radio", { name: "Task-based Routing" }) as HTMLInputElement).disabled).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ routingMode: "SINGLE_MODEL", defaultProviderConfigId: settingsFixture.providers[0].id });
    await act(async () => { pending.resolve(jsonResponse(settingsFixture)); });
    await screen.findByText("AI routing was saved atomically. SejukOps will not silently switch providers after a failure.");
    expect((screen.getByRole("combobox") as HTMLInputElement).disabled).toBe(false);
  });

  it("ignores a cancelled editor's late connection failure while a reopened test remains pending", async () => {
    const pending = deferred<Response>();
    const reopenedPending = deferred<Response>();
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(settingsFixture)).mockReturnValueOnce(pending.promise).mockReturnValueOnce(reopenedPending.promise);
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup({ delay: null });
    render(<ConfigProvider theme={{ token: { motion: false } }}><AISettingsWorkspace /></ConfigProvider>);
    await user.click(await screen.findByRole("button", { name: /Edit/ }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect((within(dialog).getByRole("textbox", { name: "Profile name" }) as HTMLInputElement).value).toBe("Mock operations provider"));
    await user.type(within(dialog).getByLabelText(/API key/), "fictional-key-only");
    await user.click(within(dialog).getByRole("button", { name: /Test saved profile/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect((within(dialog).getByRole("textbox", { name: "Model" }) as HTMLInputElement).disabled).toBe(true);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await user.click(screen.getByRole("button", { name: /Edit/ }));
    const reopened = await screen.findByRole("dialog");
    await waitFor(() => expect((within(reopened).getByRole("textbox", { name: "Model" }) as HTMLInputElement).disabled).toBe(false));
    expect((within(reopened).getByLabelText(/API key/) as HTMLInputElement).value).toBe("");
    await user.click(within(reopened).getByRole("button", { name: /Test saved profile/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    await act(async () => { pending.resolve(jsonResponse({ error: { message: "Old editor connection failed" } }, 503)); });
    expect(within(reopened).queryByText("Old editor connection failed")).toBeNull();
    expect((within(reopened).getByRole("textbox", { name: "Model" }) as HTMLInputElement).disabled).toBe(true);
    await act(async () => { reopenedPending.resolve(jsonResponse({})); });
    await within(reopened).findByText(/Connection test passed/);
    expect((within(reopened).getByRole("textbox", { name: "Model" }) as HTMLInputElement).disabled).toBe(false);
  }, 15_000);

  it("freezes an in-flight save, preserves the saved key on blank input and clears credentials on reopen", async () => {
    const pending = deferred<Response>();
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(settingsFixture)).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(jsonResponse(settingsFixture));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup({ delay: null });
    render(<ConfigProvider theme={{ token: { motion: false } }}><AISettingsWorkspace /></ConfigProvider>);
    await user.click(await screen.findByRole("button", { name: /Edit/ }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect((within(dialog).getByRole("textbox", { name: "Profile name" }) as HTMLInputElement).value).toBe("Mock operations provider"));
    await user.dblClick(within(dialog).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect((within(dialog).getByRole("textbox", { name: "Profile name" }) as HTMLInputElement).disabled).toBe(true);
    expect((within(dialog).getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).not.toHaveProperty("apiKey");
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeTruthy();
    await act(async () => { pending.resolve(jsonResponse({})); });
    await screen.findByText("Mock operations provider was updated. The plaintext credential was cleared from this form.");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await user.click(screen.getByRole("button", { name: /Edit/ }));
    const reopened = await screen.findByRole("dialog");
    expect((within(reopened).getByLabelText(/API key/) as HTMLInputElement).value).toBe("");
  }, 15_000);
});
