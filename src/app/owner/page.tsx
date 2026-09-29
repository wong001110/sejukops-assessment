import { redirect } from "next/navigation";

import { getServerActorContext } from "@/lib/auth/server-actor";

import { signOutOwner } from "./login/actions";
import { Button, Card, Tag } from "antd";
import Link from "next/link";

export default async function OwnerPage() {
  const actor = await getServerActorContext();
  if (!actor || actor.isAnonymous || actor.platformRole !== "SUPER_ADMIN") {
    redirect("/owner/login");
  }

  return (
    <main className="product-page product-form-page"><div className="product-form-wrap">
      <Link className="product-brand" href="/">Sejuk<span>Ops</span></Link>
      <Card className="product-form-card product-note">
        <Tag color="green">Verified Owner</Tag>
        <h1>Owner account</h1>
        <p>Your session is verified. Platform settings and diagnostics are available to your Super Admin account.</p>
        <div className="workspace-action-row product-note">
          <Button href="/platform/ai-settings">AI settings</Button>
          <Button href="/diagnostics/ai-observability">AI observability</Button>
          <Button href="/platform/demo">Demo management</Button>
        </div>
        <form action={signOutOwner} className="product-form"><Button htmlType="submit">Sign out</Button></form>
      </Card></div>
    </main>
  );
}
