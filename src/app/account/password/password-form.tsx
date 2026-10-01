"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Alert, Button, Input } from "antd";
import { changeStaffPassword, type StaffPasswordState } from "./actions";

const initial: StaffPasswordState = { status: "idle" };
export function StaffPasswordForm() {
  const [state, setState] = useState(initial);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    submitting.current = true;
    setPending(true);
    try {
      const next = await changeStaffPassword(initial, data);
      if (mounted.current) {
        if (next.status === "changed") form.reset();
        setState(next);
      }
    } catch { if (mounted.current) setState({ status: "failed" }); }
    finally { submitting.current = false; if (mounted.current) setPending(false); }
  }
  return <>
    {state.status === "invalid" && <Alert type="error" showIcon message="Enter your current password and matching, different new passwords of at least 12 characters." />}
    {state.status === "failed" && <Alert type="error" showIcon message="Password setup could not finish. Retry using your current password. If it already changed, enter the new password as your current password; business access remains locked until setup completes." />}
    {state.status === "changed" ? <Alert type="success" showIcon message="Password changed. Sign in again to open your workspace." action={<Button href="/login">Sign in</Button>} /> :
      <form onSubmit={submit} className="product-form">
        <label className="product-field">Current password<Input.Password name="currentPassword" autoComplete="current-password" maxLength={128} required size="large" /></label>
        <label className="product-field">New password<Input.Password name="newPassword" autoComplete="new-password" minLength={12} maxLength={128} required size="large" /></label>
        <label className="product-field">Confirm new password<Input.Password name="confirmation" autoComplete="new-password" minLength={12} maxLength={128} required size="large" /></label>
        <Button type="primary" htmlType="submit" aria-label="Change password" aria-busy={pending} disabled={pending} loading={pending}>Change password</Button>
      </form>}
  </>;
}
