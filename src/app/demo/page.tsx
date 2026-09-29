import { Alert, Button, Card, Tag } from "antd";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  createGuestServiceClient, GUEST_COOKIE_NAME, resolveGuestVisit,
} from "@/lib/auth/guest-session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ error?: string }> };
export default async function DemoPage({ searchParams }: Props) {
  const { error } = await searchParams;
  const session = await createServerSupabaseClient();
  const { data: authData } = await session.auth.getUser();
  const token = (await cookies()).get(GUEST_COOKIE_NAME)?.value;
  const service = !authData.user && token ? createGuestServiceClient() : null;
  const visit = service && token ? await resolveGuestVisit(service, token) : null;
  if (visit) redirect(`/workspaces/${visit.workspaceId}/orders`);

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
      {authData.user ? (
        <Alert className="product-note" type="info" showIcon message="This signed-in account cannot enter the public Demo." description="Sign out of your current account first." />
      ) : (
        <section>
          <form className="product-form" action="/api/demo/entry" method="post">
            <Button type="primary" htmlType="submit">Continue as Guest</Button>
          </form>
        </section>
      )}
      </Card></div>
    </main>
  );
}
