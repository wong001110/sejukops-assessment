// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const action = vi.hoisted(() => vi.fn());
vi.mock("./actions",() => ({ changeStaffPassword: action }));
import { StaffPasswordForm } from "./password-form";

function fill() {
  fireEvent.change(screen.getByLabelText("Current password"),{ target: { value: "synthetic-old-password" } });
  fireEvent.change(screen.getByLabelText("New password",{ exact: true }),{ target: { value: "synthetic-new-password" } });
  fireEvent.change(screen.getByLabelText("Confirm new password"),{ target: { value: "synthetic-new-password" } });
}
describe("actual staff onboarding form with synthetic server responses",() => {
  afterEach(cleanup);
  beforeEach(() => { action.mockReset(); });
  it("handles an invalid submission without falsely reporting success",async () => {
    action.mockResolvedValue({ status: "invalid" }); render(<StaffPasswordForm />); fill();
    fireEvent.click(screen.getByRole("button",{ name: /Change password/ }));
    await screen.findByText(/matching, different new passwords/);
    expect(screen.getByLabelText("Current password")).toBeTruthy();
  });
  it("guards duplicate submits while a slow response is pending",async () => {
    let finish!: (value: { status: string }) => void;
    action.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { container } = render(<StaffPasswordForm />); fill();
    fireEvent.submit(container.querySelector("form")!); fireEvent.submit(container.querySelector("form")!);
    expect(action).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ status: "changed" }); });
    await screen.findByText("Password changed. Sign in again to open your workspace.");
    expect(screen.queryByLabelText("Current password")).toBeNull();
    expect(container.innerHTML).not.toContain("synthetic-old-password");
  });
  it("explains partial completion and allows retry with the current password",async () => {
    action.mockResolvedValueOnce({ status: "failed" }).mockResolvedValueOnce({ status: "changed" });
    render(<StaffPasswordForm />); fill(); fireEvent.click(screen.getByRole("button",{ name: "Change password" }));
    await screen.findByText(/If it already changed, enter the new password/);
    fireEvent.change(screen.getByLabelText("Current password"),{ target: { value: "synthetic-new-password" } });
    fireEvent.change(screen.getByLabelText("New password",{ exact: true }),{ target: { value: "synthetic-next-password" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"),{ target: { value: "synthetic-next-password" } });
    await waitFor(() => expect(screen.getByRole("button",{ name: "Change password" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button",{ name: "Change password" }));
    await screen.findByText("Password changed. Sign in again to open your workspace.");
    expect(action).toHaveBeenCalledTimes(2);
  });
  it("handles transport errors and ignores a completion after unmount",async () => {
    action.mockRejectedValueOnce(new Error("synthetic transport"));
    const view = render(<StaffPasswordForm />); fill(); fireEvent.click(screen.getByRole("button",{ name: "Change password" }));
    await screen.findByText(/Password setup could not finish/);
    let finish!: (value: { status: string }) => void;
    action.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await waitFor(() => expect(screen.getByRole("button",{ name: "Change password" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button",{ name: "Change password" }));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
    view.unmount(); await act(async () => { finish({ status: "changed" }); });
    expect(screen.queryByText("Password changed. Sign in again to open your workspace.")).toBeNull();
  });
});
