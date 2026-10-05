import { redirect } from "next/navigation";

import { getServerActorContext } from "@/lib/auth/server-actor";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { readOwnerWorkspaceEntry } from "@/lib/services/workspaces/owner-entry";

import { signOutOwner } from "./login/actions";
import { Alert, Button, Card, Tag } from "antd";
import Link from "next/link";
import { OwnerPreviewPanel } from "@/components/admin/owner-preview/owner-preview-panel";

export default async function OwnerPage() {
  const actor = await getServerActorContext();
  if (!actor || actor.isAnonymous || actor.platformRole !== "SUPER_ADMIN") {
    redirect("/owner/login");
  }
  let workspaceId: string | null = null;
  try {
    workspaceId = await readOwnerWorkspaceEntry(actor, await createServerSupabaseClient());
  } catch {
    // Keep account controls usable when the membership lookup is temporarily unavailable.
  }

  return (
    <main className="product-page product-form-page"><div className="product-form-wrap">
      <Link className="product-brand" href="/">Sejuk<span>Ops</span></Link>
      <Card className="product-form-card product-note">
        <Tag color="green">Verified Owner</Tag>
        <h1>Owner account</h1>
        <p>Your session is verified. Platform settings and diagnostics are available to your Super Admin account.</p>
        {workspaceId ? <p className="product-note"><Button type="primary" href={`/workspaces/${workspaceId}`}>Open Owner workspace</Button></p>
          : <Alert className="product-note" type="warning" showIcon message="Owner workspace could not be opened."
            description="Check your active workspace membership or retry the lookup. Account controls are still available."
            action={<Button href="/owner">Retry</Button>} />}
        <div className="workspace-action-row product-note">
          <Button href="/platform/staff">Manage staff accounts</Button>
          <Button href="/platform/ai-settings">AI settings</Button>
          <Button href="/diagnostics/ai-observability">AI observability</Button>
          <Button href="/platform/demo">Demo management</Button>
          <Button href="/owner/password">Change password</Button>
        </div>
        {workspaceId ? <div className="product-note"><OwnerPreviewPanel workspaceId={workspaceId} /></div> : null}
        <form action={signOutOwner} className="product-form"><Button htmlType="submit">Sign out</Button></form>
      </Card></div>
    </main>
  );
}
