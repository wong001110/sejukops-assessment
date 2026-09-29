import Script from "next/script";
import { Alert, Button, Card, Divider, Tag } from "antd";
import Link from "next/link";

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
    <main className="product-page product-form-page">
      <div className="product-form-wrap">
      <Link className="product-brand" href="/">Sejuk<span>Ops</span></Link>
      <Card className="product-form-card product-note">
      <Tag color="green">Shared Demo</Tag>
      <h1>Explore the workspace</h1>
      <p>Try service workflows with fictional data. Demo records are shared and resettable.</p>
      <Alert type="warning" showIcon message="Use fictional details only" description="Do not upload confidential information to this shared workspace." />
      {error && <Alert className="product-note" type="error" showIcon message={`Demo entry could not continue (${error}). Please try again later.`} />}
      {actor?.isAnonymous && actor.membership?.kind === "DEMO" ? (
        <section>
          <Divider />
          <p>Your anonymous session is active. Current persona: <Tag color="blue">{actor.membership.role}</Tag></p>
          <form className="product-form" action="/api/demo/persona" method="post">
            <label className="product-field" htmlFor="persona">Choose a Demo persona</label>
            <select id="persona" name="persona" defaultValue={actor.membership.role}>
              {personas.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
            </select>
            <Button type="primary" htmlType="submit">Switch persona</Button>
          </form>
          <p>Every action remains attributed to your own session. Platform settings and Owner records are unavailable here.</p>
        </section>
      ) : authData.user ? (
        <Alert className="product-note" type="info" showIcon message="This signed-in account cannot enter the public Demo." description="Sign out of your current account first." />
      ) : siteKey ? (
        <section>
          <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" />
          <form className="product-form" action="/api/demo/entry" method="post">
            <label className="product-field" htmlFor="persona">Choose a Demo persona</label>
            <select id="persona" name="persona" defaultValue="ADMIN">
              {personas.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
            </select>
            <div className="cf-turnstile" data-sitekey={siteKey} />
            <Button type="primary" htmlType="submit">Enter Demo</Button>
          </form>
        </section>
      ) : (
        <Alert className="product-note" type="info" showIcon message="Public Demo entry is not configured yet." />
      )}
      </Card></div>
    </main>
  );
}
