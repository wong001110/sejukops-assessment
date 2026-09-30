import Link from "next/link";
import { redirect } from "next/navigation";

import { DemoResetCard } from "@/components/admin/demo-reset/demo-reset-card";
import { hasActorPermission } from "@/lib/auth/actor-policy";
import { getServerActorContext } from "@/lib/auth/server-actor";

export default async function PlatformDemoPage() {
  const actor = await getServerActorContext();
  if (!actor) redirect("/owner/login");
  if (!hasActorPermission(actor, "ai_config:manage")) redirect("/access-denied");

  return <main className="desktop-content">
    <p><Link href="/owner">← Back to Owner account</Link></p>
    <h1>Demo management</h1>
    <DemoResetCard />
  </main>;
}
