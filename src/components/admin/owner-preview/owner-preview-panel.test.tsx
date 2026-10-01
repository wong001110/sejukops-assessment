// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfigProvider } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OwnerPreviewStatus } from "@/domain/staff/owner-preview-contracts";
const navigation = vi.hoisted(() => ({ openOwnerPreviewWorkspace: vi.fn(), returnToOwnerAccount: vi.fn() }));
vi.mock("./owner-preview-navigation", () => navigation);
vi.mock("./owner-preview-api", () => ({ ownerPreviewApi: { get: vi.fn(), set: vi.fn(), exit: vi.fn() } }));
import { ownerPreviewApi } from "./owner-preview-api";
import { OwnerPreviewPanel } from "./owner-preview-panel";
const mock = vi.mocked(ownerPreviewApi);
const workspaceId = "11111111-1111-4111-8111-111111111111";
const employeeId = "22222222-2222-4222-8222-222222222222";
const preview: OwnerPreviewStatus = { previewId: "33333333-3333-4333-8333-333333333333", role: "TECHNICIAN", effectiveEmployeeProfileId: employeeId, effectiveEmployeeName: "Synthetic Technician", readOnly: true };
const options = { technicians: [{ profileId: employeeId, name: "Synthetic Technician", branchCode: "MOCK" }], preview: null };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const tree = (id = workspaceId) => <ConfigProvider theme={{ token: { motion: false } }}><OwnerPreviewPanel workspaceId={id} /></ConfigProvider>;
const choose = async (user: ReturnType<typeof userEvent.setup>, label: string, value: string) => { await user.click(screen.getByRole("combobox", { name: label })); await user.click(await screen.findByText(value, { selector: ".ant-select-item-option-content" })); };
const start = async () => { const user = userEvent.setup({ delay: null }); render(tree()); await waitFor(() => expect((screen.getByRole("button", { name: "Open read-only preview" }) as HTMLButtonElement).disabled).toBe(false)); return user; };
beforeEach(() => { vi.resetAllMocks(); mock.get.mockResolvedValue(options); mock.exit.mockResolvedValue({ preview: null }); mock.set.mockResolvedValue({ preview }); });
afterEach(cleanup);
describe("actual Owner preview panel with synthetic adapter", () => {
  it("shows loading, safe error, retry and empty Technician options", async () => {
    const pending = deferred<typeof options>(); mock.get.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ technicians: [], preview: null });
    const user = userEvent.setup({ delay: null }); render(tree()); expect(screen.getByRole("status").textContent).toContain("Loading preview options");
    await act(async () => pending.reject(new Error("Synthetic preview unavailable"))); await screen.findByText("Synthetic preview unavailable"); await user.click(screen.getByRole("button", { name: "Retry preview options" }));
    await choose(user, "Business perspective", "Technician"); await screen.findByText("No active Technicians are available."); expect((screen.getByRole("button", { name: "Open read-only preview" }) as HTMLButtonElement).disabled).toBe(true); expect(mock.set).not.toHaveBeenCalled();
  });
  it("requires an actual Technician, guards duplicate start and renders the persisted read-only identity", async () => {
    const pending = deferred<{ preview: OwnerPreviewStatus }>(); mock.set.mockReturnValue(pending.promise); const user = await start();
    await choose(user, "Business perspective", "Technician"); const button = screen.getByRole("button", { name: "Open read-only preview" }); expect((button as HTMLButtonElement).disabled).toBe(true);
    await choose(user, "Technician employee", "Synthetic Technician (MOCK)"); await user.dblClick(button); expect(mock.set).toHaveBeenCalledExactlyOnceWith({ workspaceId, role: "TECHNICIAN", employeeProfileId: employeeId }); expect((screen.getByRole("button", { name: "Return to Owner" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => pending.resolve({ preview })); await screen.findByText("Read-only Technician preview · Synthetic Technician"); expect(screen.getByText(/You remain signed in as Owner/)).toBeTruthy(); expect(navigation.openOwnerPreviewWorkspace).toHaveBeenCalledExactlyOnceWith(workspaceId);
    await user.dblClick(button); expect(mock.set).toHaveBeenCalledTimes(1); expect(navigation.openOwnerPreviewWorkspace).toHaveBeenCalledTimes(1);
  });
  it("clears an employee when changing role and sends no employee authority for Manager", async () => {
    const user = await start(); await choose(user, "Business perspective", "Technician"); await choose(user, "Technician employee", "Synthetic Technician (MOCK)"); await choose(user, "Business perspective", "Manager"); expect(screen.queryByLabelText("Technician employee")).toBeNull(); await user.click(screen.getByRole("button", { name: "Open read-only preview" })); expect(mock.set).toHaveBeenCalledWith({ workspaceId, role: "MANAGER", employeeProfileId: null });
  });
  it("keeps persisted preview visible after failed exit and clears it only after an explicit retry succeeds", async () => {
    mock.get.mockResolvedValue({ ...options, preview }); mock.exit.mockRejectedValueOnce(new Error("Synthetic exit interrupted")).mockResolvedValueOnce({ preview: null }); const user = await start(); await screen.findByText("Read-only Technician preview · Synthetic Technician");
    await user.click(screen.getByRole("button", { name: "Return to Owner" })); await screen.findByText("Synthetic exit interrupted"); expect(navigation.returnToOwnerAccount).not.toHaveBeenCalled(); expect(screen.getByText("Read-only Technician preview · Synthetic Technician")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Return to Owner" })); await waitFor(() => expect(navigation.returnToOwnerAccount).toHaveBeenCalledTimes(1)); expect(screen.queryByText("Read-only Technician preview · Synthetic Technician")).toBeNull();
    await user.dblClick(screen.getByRole("button", { name: "Return to Owner" })); expect(mock.exit).toHaveBeenCalledTimes(2); expect(navigation.returnToOwnerAccount).toHaveBeenCalledTimes(1);
  });
  it("allows explicit exit while expired options are unavailable and ignores cancelled late loading", async () => {
    const pending = deferred<typeof options>(); mock.get.mockReturnValue(pending.promise); const user = userEvent.setup({ delay: null }); render(tree());
    await user.click(screen.getByRole("button", { name: "Return to Owner" })); await waitFor(() => expect(navigation.returnToOwnerAccount).toHaveBeenCalledTimes(1)); await act(async () => pending.resolve({ ...options, preview: null })); expect(screen.queryByRole("status")).toBeNull(); expect(mock.exit).toHaveBeenCalledTimes(1);
  });
  it("does not apply options or late mutations from a previous workspace", async () => {
    const pending = deferred<{ preview: OwnerPreviewStatus }>(); mock.set.mockReturnValue(pending.promise); const user = userEvent.setup({ delay: null }); const view = render(tree()); await waitFor(() => expect((screen.getByRole("button", { name: "Open read-only preview" }) as HTMLButtonElement).disabled).toBe(false)); await user.click(screen.getByRole("button", { name: "Open read-only preview" }));
    view.rerender(tree("44444444-4444-4444-8444-444444444444")); await waitFor(() => expect(mock.get).toHaveBeenCalledTimes(2)); await act(async () => pending.resolve({ preview })); expect(screen.queryByText("Read-only Technician preview · Synthetic Technician")).toBeNull(); expect(navigation.openOwnerPreviewWorkspace).not.toHaveBeenCalled();
  });
  it("keeps the current context when preview creation fails and allows retry", async () => {
    mock.set.mockRejectedValueOnce(new Error("Synthetic entry interrupted")); const user = await start();
    await user.click(screen.getByRole("button", { name: "Open read-only preview" })); await screen.findByText("Synthetic entry interrupted"); expect(navigation.openOwnerPreviewWorkspace).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Open read-only preview" })); await waitFor(() => expect(navigation.openOwnerPreviewWorkspace).toHaveBeenCalledExactlyOnceWith(workspaceId));
  });
});
