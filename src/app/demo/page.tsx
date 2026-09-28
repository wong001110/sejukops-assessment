import Script from "next/script";

import { getServerActorContext } from "@/lib/auth/server-actor";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ error?: string; workspace?: string }> };
const personas = [
  { value: "ADMIN", label: "Dispatcher / Admin" },
  { value: "MANAGER", label: "Manager" },
  { value: "TECHNICIAN", label: "Technician" },
] as const;

export default async function DemoPage({ searchParams }: Props) {
  const { error, workspace } = await searchParams;
  const session = await createServerSupabaseClient();
  const { data: authData } = await session.auth.getUser();
  let workspaceId = workspace;
  if (authData.user?.is_anonymous && !workspaceId) {
    const { data: profile } = await session.from("profiles")
      .select("id").eq("auth_user_id", authData.user.id).maybeSingle();
    if (profile) {
      const { data: membership } = await session.from("workspace_memberships")
        .select("workspace_id").eq("profile_id", profile.id).eq("active", true).maybeSingle();
      workspaceId = membership?.workspace_id;
    }
  }
  const actor = workspaceId ? await getServerActorContext(workspaceId) : null;
  const siteKey = process.env.DEMO_SUPABASE_CAPTCHA_ENABLED === "true"
    ? process.env.DEMO_TURNSTILE_SITE_KEY?.trim()
    : undefined;

  return (
    <main style={{ maxWidth: 620, margin: "3rem auto", padding: "0 1rem" }}>
      <h1>Shared Demo workspace</h1>
      <p>Demo business records are shared and resettable. Use fictional details only; do not upload confidential information.</p>
      {error && <p role="alert">Demo entry could not continue ({error}). Please try again later.</p>}
      {actor?.isAnonymous && actor.membership?.kind === "DEMO" ? (
        <section>
          <p>Your distinct anonymous session is active. Current persona: <strong>{actor.membership.role}</strong>.</p>
          <form action="/api/demo/persona" method="post">
            <label htmlFor="persona">Choose a Demo persona</label>
            <select id="persona" name="persona" defaultValue={actor.membership.role}>
              {personas.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
            </select>
            <button type="submit">Switch persona</button>
          </form>
          <p>Every action remains attributed to your own session. Platform settings and Owner records are unavailable here.</p>
        </section>
      ) : authData.user ? (
        <p>This signed-in account cannot enter the public Demo. Sign out of your current account first.</p>
      ) : siteKey ? (
        <section>
          <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" />
          <form action="/api/demo/entry" method="post">
            <label htmlFor="persona">Choose a Demo persona</label>
            <select id="persona" name="persona" defaultValue="ADMIN">
              {personas.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
            </select>
            <div className="cf-turnstile" data-sitekey={siteKey} />
            <button type="submit">Enter Demo</button>
          </form>
        </section>
      ) : (
        <p role="status">Public Demo entry is not configured yet.</p>
      )}
    </main>
  );
}
