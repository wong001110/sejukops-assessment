import { signInOwner } from "./actions";

type Props = { searchParams: Promise<{ error?: string }> };

export default async function OwnerLoginPage({ searchParams }: Props) {
  const { error } = await searchParams;

  return (
    <main style={{ maxWidth: 420, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Owner sign in</h1>
      <p>Use your permanent Sejuk Ops account.</p>
      {error === "invalid" && <p role="alert">Sign in failed or this account is not authorized.</p>}
      <form action={signInOwner} style={{ display: "grid", gap: "1rem" }}>
        <label>
          Email
          <input name="email" type="email" autoComplete="username" required style={{ display: "block", width: "100%" }} />
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete="current-password" required style={{ display: "block", width: "100%" }} />
        </label>
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}
