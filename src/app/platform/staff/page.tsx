import { redirect } from "next/navigation";
import Link from "next/link";
import { Alert } from "antd";
import { getServerActorContext } from "@/lib/auth/server-actor";
import { hasActorPermission } from "@/lib/auth/actor-policy";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { readOwnerWorkspaceEntry } from "@/lib/services/workspaces/owner-entry";
import { StaffAccountsWorkspace } from "@/components/admin/staff-accounts/staff-accounts-workspace";

export default async function StaffAccountsPage() {
  const actor = await getServerActorContext().catch(() => null);
  if (!actor || !hasActorPermission(actor,"ai_config:manage")) redirect("/owner/login");
  const workspaceId = await readOwnerWorkspaceEntry(actor,await createServerSupabaseClient());
  return <main className="product-page"><div className="product-container">
    <Link href="/owner">Back to Owner</Link><h1>Staff accounts</h1>
    {workspaceId ? <StaffAccountsWorkspace workspaceId={workspaceId} /> : <Alert type="warning" message="An active Owner workspace is required." />}
  </div></main>;
}
