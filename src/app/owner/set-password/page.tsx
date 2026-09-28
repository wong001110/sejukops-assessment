import { redirect } from "next/navigation";

import { getServerActorContext } from "@/lib/auth/server-actor";

import { setOwnerPassword } from "./actions";

type Props = { searchParams: Promise<{ error?: string }> };

export default async function SetOwnerPasswordPage({ searchParams }: Props) {
  const actor = await getServerActorContext();
  if (!actor || actor.isAnonymous || actor.platformRole !== "SUPER_ADMIN") {
    redirect("/owner/login");
  }

  const { error } = await searchParams;
  return (
    <main style={{ maxWidth: 420, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Set your Owner password</h1>
      <p>Choose a password for future email sign-in. Use at least 12 characters.</p>
      {error === "invalid" && <p role="alert">The password could not be set. Check both entries and try again.</p>}
      <form action={setOwnerPassword} style={{ display: "grid", gap: "1rem" }}>
        <label>
          Password
          <input name="password" type="password" autoComplete="new-password" minLength={12} required style={{ display: "block", width: "100%" }} />
        </label>
        <label>
          Confirm password
          <input name="confirmation" type="password" autoComplete="new-password" minLength={12} required style={{ display: "block", width: "100%" }} />
        </label>
        <button type="submit">Save password</button>
      </form>
    </main>
  );
}
