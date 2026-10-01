// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfigProvider } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffAccountSummary, StaffImportDraft } from "@/domain/staff/contracts";
import { StaffAccountsWorkspace } from "./staff-accounts-workspace";
import { staffApi } from "./staff-api";

vi.mock("./staff-api", () => ({ staffApi: { list: vi.fn(), create: vi.fn(), update: vi.fn(), resetPassword: vi.fn(), preview: vi.fn(), confirm: vi.fn() } }));
const mock = vi.mocked(staffApi);
const account: StaffAccountSummary = { profileId: "fictional-staff", name: "Synthetic Employee", email: "synthetic@example.invalid", role: "ADMIN", branchCode: null, active: true, passwordChangeRequired: true, authRevision: "2026-10-01T00:00:00Z" };
const branches = [{ code: "MOCK", name: "Synthetic branch" }];
const credential = { email: account.email, password: "Synthetic-only-password-12" };
const draft: StaffImportDraft = { importId: "synthetic-import", expiresAt: "2099-10-01T00:00:00Z", validCount: 2, invalidCount: 0, rows: [{ row: 2, input: { name: "Employee A", email: "a@example.invalid", role: "ADMIN", branchCode: null }, errors: [] }, { row: 3, input: { name: "Employee B", email: "b@example.invalid", role: "MANAGER", branchCode: null }, errors: [] }] };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const tree = (id = "synthetic-workspace") => <ConfigProvider theme={{ token: { motion: false } }}><StaffAccountsWorkspace workspaceId={id} /></ConfigProvider>;
const start = async () => { const user = userEvent.setup({ delay: null }); render(tree()); await screen.findByText(account.name); return user; };
const createForm = async (user: ReturnType<typeof userEvent.setup>) => { await user.click(await screen.findByRole("button", { name: "Create staff account" })); const dialog = await screen.findByRole("dialog"); await user.type(within(dialog).getByLabelText("Employee name"), account.name); await user.type(within(dialog).getByLabelText("Employee email"), account.email); return dialog; };
const upload = async (user: ReturnType<typeof userEvent.setup>, file = new File(["synthetic workbook"], "staff.xlsx")) => { await user.upload(screen.getByLabelText("Staff workbook (.xlsx)"), file); return screen.findByRole("dialog", { name: "Review staff import" }); };
// rc-util deliberately returns the same "test-id" for every Modal in NODE_ENV=test.
// Locate stacked dialogs by their rendered title without replacing actual components.
const dialogWithTitle = async (title: string) => (await screen.findByText(title, { selector: ".ant-modal-title" })).closest('[role="dialog"]') as HTMLElement;
beforeEach(() => { vi.resetAllMocks(); mock.list.mockResolvedValue({ accounts: [account], branches }); mock.preview.mockResolvedValue(draft); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("actual staff workspace with deterministic synthetic API", () => {
  it("shows slow loading, a safe load failure, retry and empty accounts", async () => {
    const pending = deferred<{ accounts: StaffAccountSummary[]; branches: typeof branches }>();
    mock.list.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ accounts: [], branches });
    const user = userEvent.setup({ delay: null }); render(tree());
    expect(screen.getByRole("status", { name: "Loading staff accounts" })).toBeTruthy();
    await act(async () => pending.reject(new Error("Staff access could not be verified.")));
    await screen.findByText("Staff access could not be verified.");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("No staff accounts yet");
    expect(mock.list).toHaveBeenCalledTimes(2);
  });

  it("validates required fields and discards cancelled form values on reopen", async () => {
    const user = await start(); await user.click(screen.getByRole("button", { name: "Create staff account" }));
    let dialog = screen.getByRole("dialog"); await user.click(within(dialog).getByRole("button", { name: "Create account" }));
    await within(dialog).findByText("Please enter Employee name");
    expect(mock.create).not.toHaveBeenCalled();
    await user.type(within(dialog).getByLabelText("Employee name"), "Cancelled person");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await user.click(screen.getByRole("button", { name: "Create staff account" })); dialog = screen.getByRole("dialog");
    expect((within(dialog).getByLabelText("Employee name") as HTMLInputElement).value).toBe("");
  });

  it("guards double create and close while pending, then clears one-time credentials", async () => {
    const pending = deferred<Awaited<ReturnType<typeof staffApi.create>>>(); mock.create.mockReturnValue(pending.promise);
    const user = await start(); const dialog = await createForm(user);
    await user.dblClick(within(dialog).getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(mock.create).toHaveBeenCalledTimes(1));
    expect((within(dialog).getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(dialog).getByLabelText("Employee name") as HTMLInputElement).disabled).toBe(true);
    await user.keyboard("{Escape}"); expect(screen.getByRole("dialog")).toBeTruthy();
    await act(async () => pending.resolve({ status: "CREATED", account, credential }));
    const secrets = await screen.findByRole("dialog", { name: "Temporary login credentials" });
    expect(within(secrets).getByText(credential.password)).toBeTruthy();
    expect(screen.getByText("Staff account created.").textContent).not.toContain(credential.password);
    await user.click(within(secrets).getByRole("button", { name: "Close and clear passwords" }));
    await waitFor(() => expect(screen.queryByText(credential.password)).toBeNull());
    await user.click(screen.getByRole("button", { name: "Create staff account" }));
    expect(screen.queryByText(credential.password)).toBeNull();
  });

  it("reuses a create request key on failure and changes it for changed input", async () => {
    mock.create.mockRejectedValue(new Error("Synthetic network interruption"));
    const user = await start(); const dialog = await createForm(user);
    await user.click(within(dialog).getByRole("button", { name: "Create account" })); await within(dialog).findByText("Synthetic network interruption");
    await user.click(within(dialog).getByRole("button", { name: "Create account" })); await waitFor(() => expect(mock.create).toHaveBeenCalledTimes(2));
    expect(mock.create.mock.calls[0][1]).toBe(mock.create.mock.calls[1][1]);
    await user.type(within(dialog).getByLabelText("Employee name"), " amended");
    await user.click(within(dialog).getByRole("button", { name: "Create account" })); await waitFor(() => expect(mock.create).toHaveBeenCalledTimes(3));
    expect(mock.create.mock.calls[2][1]).not.toBe(mock.create.mock.calls[1][1]);
  });

  it("explains how to recover login credentials when creation succeeded without a retrievable password", async () => {
    mock.create.mockResolvedValue({ status: "CREATED", account, credential: null });
    const user = await start(); const dialog = await createForm(user);
    await user.click(within(dialog).getByRole("button", { name: "Create account" }));
    await screen.findByText("Staff account is available. Its temporary password is no longer available; use Reset temporary password to provide login credentials.");
    expect(screen.queryByRole("dialog", { name: "Temporary login credentials" })).toBeNull();
  });

  it("requires Technician branch selection and clears branch for other roles", async () => {
    mock.create.mockResolvedValue({ status: "ALREADY_CREATED", account, credential: null });
    const user = await start(); const dialog = await createForm(user);
    await user.click(within(dialog).getByLabelText("Business role")); await user.click(screen.getByText("Technician", { selector: ".ant-select-item-option-content" }));
    await user.click(within(dialog).getByRole("button", { name: "Create account" })); await within(dialog).findByText("Choose a branch for this Technician.");
    expect(mock.create).not.toHaveBeenCalled();
    await user.click(within(dialog).getByLabelText("Technician branch")); await user.click(screen.getByText("Synthetic branch (MOCK)", { selector: ".ant-select-item-option-content" }));
    await user.click(within(dialog).getByLabelText("Business role")); await user.click(screen.getByText("Manager", { selector: ".ant-select-item-option-content" }));
    expect(within(dialog).queryByLabelText("Technician branch")).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Create account" })); await waitFor(() => expect(mock.create).toHaveBeenCalledTimes(1));
    expect(mock.create.mock.calls[0][2]).toMatchObject({ role: "MANAGER", branchCode: null });
    expect(screen.queryByText(credential.password)).toBeNull();
  });

  it("requires a second explicit disable confirmation and sends the observed revision", async () => {
    mock.update.mockResolvedValue({ account: { ...account, active: false, authRevision: "next-revision" } });
    const user = await start(); await user.click(screen.getByRole("button", { name: `Edit ${account.name}` }));
    const dialog = screen.getByRole("dialog"); await user.click(within(dialog).getByRole("switch", { name: "Account active" }));
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
    const confirmation = await dialogWithTitle("Disable employee access?"); expect(mock.update).not.toHaveBeenCalled();
    await user.click(within(confirmation).getByRole("button", { name: "Confirm disable" }));
    await screen.findByText("Disabled"); expect(mock.update).toHaveBeenCalledWith("synthetic-workspace", account, { role: "ADMIN", branchCode: null, active: false });
  });

  it("explains reset before execution, guards duplicates, and clears password on workspace navigation", async () => {
    const pending = deferred<Awaited<ReturnType<typeof staffApi.resetPassword>>>(); mock.resetPassword.mockReturnValue(pending.promise);
    const user = userEvent.setup({ delay: null }); const view = render(tree());
    await user.click(await screen.findByRole("button", { name: `Reset temporary password for ${account.name}` }));
    const dialog = screen.getByRole("dialog"); expect(within(dialog).getByText(/All previous sessions become invalid/)).toBeTruthy(); expect(mock.resetPassword).not.toHaveBeenCalled();
    await user.dblClick(within(dialog).getByRole("button", { name: "Reset password" })); await waitFor(() => expect(mock.resetPassword).toHaveBeenCalledTimes(1));
    await act(async () => pending.resolve({ status: "RESET", account, credential })); await screen.findByText(credential.password);
    mock.list.mockResolvedValueOnce({ accounts: [{ ...account, name: "Different workspace employee" }], branches });
    view.rerender(tree("other-workspace")); await screen.findByText("Different workspace employee");
    expect(screen.queryByText(credential.password)).toBeNull();
    expect(mock.list.mock.calls.at(-1)?.[0]).toBe("other-workspace");
  });

  it("aborts and ignores an old workspace load", async () => {
    const pending = deferred<Awaited<ReturnType<typeof staffApi.list>>>(); mock.list.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ accounts: [{ ...account, name: "New workspace employee" }], branches });
    const view = render(tree()); view.rerender(tree("other-workspace")); await screen.findByText("New workspace employee");
    expect(mock.list.mock.calls[0][1]?.aborted).toBe(true);
    await act(async () => pending.resolve({ accounts: [account], branches })); expect(screen.queryByText(account.name)).toBeNull();
  });

  it("does not expose a late create credential after leaving its workspace", async () => {
    const pending = deferred<Awaited<ReturnType<typeof staffApi.create>>>(); mock.create.mockReturnValue(pending.promise);
    const user = userEvent.setup({ delay: null }); const view = render(tree()); await screen.findByText(account.name);
    const dialog = await createForm(user); await user.click(within(dialog).getByRole("button", { name: "Create account" })); await waitFor(() => expect(mock.create).toHaveBeenCalledTimes(1));
    view.rerender(tree("other-workspace")); await screen.findByText(account.name);
    await act(async () => pending.resolve({ status: "CREATED", account, credential }));
    expect(screen.queryByText(credential.password)).toBeNull(); expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not allow a stale refresh to overwrite an updated employee", async () => {
    const refresh = deferred<Awaited<ReturnType<typeof staffApi.list>>>(); mock.list.mockResolvedValueOnce({ accounts: [account], branches }).mockReturnValueOnce(refresh.promise);
    mock.update.mockResolvedValue({ account: { ...account, role: "MANAGER", authRevision: "new-revision" } });
    const user = await start(); await user.click(screen.getByRole("button", { name: "Refresh" }));
    await user.click(screen.getByRole("button", { name: `Edit ${account.name}` })); const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByLabelText("Business role")); await user.click(screen.getByText("Manager", { selector: ".ant-select-item-option-content" })); await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
    await screen.findByText("MANAGER");
    await act(async () => refresh.resolve({ accounts: [account], branches })); expect(screen.queryByText("ADMIN")).toBeNull(); expect(screen.getByText("MANAGER")).toBeTruthy();
    expect(mock.list.mock.calls[1][1]?.aborted).toBe(true);
  });

  it("keeps long employee labels inside a horizontally scrollable table at narrow width", async () => {
    const long = "Synthetic long employee label ".repeat(8); mock.list.mockResolvedValue({ accounts: [{ ...account, name: long, branchCode: null, passwordChangeRequired: false }], branches });
    vi.stubGlobal("innerWidth", 375); render(tree()); await screen.findByText(long.trim());
    expect(screen.getByText("Ready")).toBeTruthy(); expect(screen.getByText("—")).toBeTruthy();
    expect(document.querySelector(".ant-table-content")?.getAttribute("style")).toContain("overflow-x: auto");
  });
});

describe("actual Excel preview and explicit batched confirmation", () => {
  it("rejects oversized workbooks before upload and lets validation failure retry", async () => {
    const user = await start(); await user.upload(screen.getByLabelText("Staff workbook (.xlsx)"), new File([new Uint8Array(1024 * 1024 + 1)], "large.xlsx")); await screen.findByText("The workbook must be 1 MB or smaller."); expect(mock.preview).not.toHaveBeenCalled();
    mock.preview.mockRejectedValueOnce(new Error("Synthetic validation temporarily unavailable")).mockResolvedValueOnce(draft);
    await user.upload(screen.getByLabelText("Staff workbook (.xlsx)"), new File(["synthetic"], "staff.xlsx")); await screen.findByText("Synthetic validation temporarily unavailable");
    await user.click(screen.getByRole("button", { name: "Retry validation" })); await screen.findByRole("dialog", { name: "Review staff import" }); expect(mock.preview).toHaveBeenCalledTimes(2); expect(mock.confirm).not.toHaveBeenCalled();
  });
  it("rejects unsupported files locally and invalid rows before confirmation", async () => {
    const user = userEvent.setup({ delay: null, applyAccept: false }); render(tree()); await screen.findByText(account.name);
    await user.upload(screen.getByLabelText("Staff workbook (.xlsx)"), new File(["bad"], "staff.csv")); await screen.findByText("Choose an .xlsx staff workbook."); expect(mock.preview).not.toHaveBeenCalled();
    mock.preview.mockResolvedValue({ ...draft, validCount: 1, invalidCount: 1, rows: [{ row: 2, input: null, errors: ["Technicians need a branch code."] }] });
    const dialog = await upload(user); expect(within(dialog).getByText("Technicians need a branch code.")).toBeTruthy();
    expect((within(dialog).getByRole("button", { name: "Confirm import" }) as HTMLButtonElement).disabled).toBe(true); expect(mock.confirm).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Cancel import" })); await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("cancels validation and ignores its late preview", async () => {
    const pending = deferred<StaffImportDraft>(); mock.preview.mockReturnValue(pending.promise);
    const user = await start(); await user.upload(screen.getByLabelText("Staff workbook (.xlsx)"), new File(["mock"], "staff.xlsx"));
    await screen.findByText("Validating workbook…"); await user.click(screen.getByRole("button", { name: "Cancel validation" }));
    expect(mock.preview.mock.calls[0][2]?.aborted).toBe(true);
    await act(async () => pending.resolve(draft)); expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not confirm on preview, stops after an in-flight batch and preserves its one-time password", async () => {
    const pending = deferred<Awaited<ReturnType<typeof staffApi.confirm>>>(); mock.confirm.mockReturnValue(pending.promise);
    const user = await start(); const dialog = await upload(user); expect(mock.confirm).not.toHaveBeenCalled();
    await user.dblClick(within(dialog).getByRole("button", { name: "Confirm import" })); await waitFor(() => expect(mock.confirm).toHaveBeenCalledTimes(1));
    expect(within(dialog).getByRole("status")).toBeTruthy(); await user.click(within(dialog).getByRole("button", { name: "Stop after current batch" }));
    await act(async () => pending.resolve({ results: [{ row: 2, status: "CREATED", profileId: account.profileId, credential }], complete: false }));
    const secrets = await dialogWithTitle("Temporary login credentials"); expect(within(secrets).getByText(credential.password)).toBeTruthy(); expect(mock.confirm).toHaveBeenCalledTimes(1);
    expect(within(dialog).queryByText(credential.password)).toBeNull(); await user.click(within(secrets).getByRole("button", { name: "Close and clear passwords" }));
    await within(dialog).findByText("Import stopped after the current batch. Completed accounts remain created.");
    expect((within(dialog).getByRole("button", { name: "Resume import" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(credential.password)).toBeNull();
  });

  it("runs sequential batches, displays partial failure, and retries only after explicit failed-row action", async () => {
    mock.confirm.mockResolvedValueOnce({ results: [{ row: 2, status: "CREATED", credential }], complete: false }).mockResolvedValueOnce({ results: [{ row: 3, status: "FAILED", error: "Synthetic identity service unavailable" }], complete: true }).mockResolvedValueOnce({ results: [{ row: 3, status: "CREATED" }], complete: true });
    const user = await start(); const dialog = await upload(user); await user.click(within(dialog).getByRole("button", { name: "Confirm import" }));
    const secrets = await dialogWithTitle("Temporary login credentials"); await user.click(within(secrets).getByRole("button", { name: "Close and clear passwords" }));
    await within(dialog).findByText("Import finished: 1 successful · 1 failed."); expect(mock.confirm).toHaveBeenCalledTimes(2);
    expect(mock.confirm.mock.calls[0]).toEqual(["synthetic-workspace", draft.importId, false]); expect(mock.confirm.mock.calls[1][2]).toBe(false);
    await user.click(within(dialog).getByRole("button", { name: "Retry failed rows" })); await within(dialog).findByText("Import finished: 2 successful · 0 failed."); expect(mock.confirm.mock.calls[2][2]).toBe(true);
  });

  it("pauses on request error and resumes the persisted import after an explicit retry", async () => {
    mock.confirm.mockRejectedValueOnce(new Error("Synthetic batch conflict. Retry later.")).mockResolvedValueOnce({ results: [{ row: 2, status: "ALREADY_CREATED" }, { row: 3, status: "CREATED" }], complete: true });
    const user = await start(); const dialog = await upload(user); await user.click(within(dialog).getByRole("button", { name: "Confirm import" })); await within(dialog).findByText("Synthetic batch conflict. Retry later."); expect(mock.confirm).toHaveBeenCalledTimes(1);
    await user.click(within(dialog).getByRole("button", { name: "Resume import" })); await within(dialog).findByText("Import finished: 2 successful · 0 failed."); expect(mock.confirm.mock.calls[1][1]).toBe(draft.importId);
  });
});
