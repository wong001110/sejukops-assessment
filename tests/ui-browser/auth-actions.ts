import { useState } from 'react';
// Local UI adapter: never calls Auth, creates users or changes real passwords.
export type PasswordChangeState = { status: 'idle' | 'invalid' | 'changed' | 'failed' };
export type StaffPasswordState = PasswordChangeState;
export async function changeStaffPassword(_state: PasswordChangeState, data: FormData): Promise<PasswordChangeState> {
  const password = String(data.get('newPassword') || '');
  return { status: password.length >= 12 && password === data.get('confirmation') && password !== data.get('currentPassword') ? 'changed' : 'invalid' };
}
export const changeOwnerPassword = changeStaffPassword;
export function useMockActionState(action: typeof changeStaffPassword, initial: PasswordChangeState) {
  const [state, setState] = useState(initial);
  const [pending, setPending] = useState(false);
  const submit = async (data: FormData) => { setPending(true); try { setState(await action(state, data)); } finally { setPending(false); } };
  return [state, submit, pending] as const;
}
