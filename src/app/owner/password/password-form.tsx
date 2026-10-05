"use client";

import { Alert, Button, Input } from "antd";
import { useActionState } from "react";

import { changeOwnerPassword, type PasswordChangeState } from "./actions";

const initialState: PasswordChangeState = { status: "idle" };

export function OwnerPasswordForm() {
  const [state, submit, pending] = useActionState(changeOwnerPassword, initialState);
  return <>
    {state.status === "invalid" && <Alert type="error" showIcon
      message="Enter your current password and matching new passwords of at least 12 characters." />}
    {state.status === "failed" && <Alert type="error" showIcon
      message="Password change failed. Check your current password or try again later." />}
    {state.status === "changed" && <Alert type="success" showIcon
      message="Password changed. Use the new password the next time you sign in." />}
    {state.status !== "changed" && <form action={submit} className="product-form">
      <label className="product-field">Current password
        <Input.Password name="currentPassword" autoComplete="current-password" required size="large" maxLength={1024} />
      </label>
      <label className="product-field">New password
        <Input.Password name="newPassword" autoComplete="new-password" required size="large" minLength={12} maxLength={128} />
      </label>
      <label className="product-field">Confirm new password
        <Input.Password name="confirmation" autoComplete="new-password" required size="large" minLength={12} maxLength={128} />
      </label>
      <Button type="primary" htmlType="submit" size="large" loading={pending}>Change password</Button>
    </form>}
  </>;
}
