import Link from "next/link";
import { redirect } from "next/navigation";

import { AISettingsWorkspace } from "@/components/admin/ai-settings/ai-settings-workspace";
import { hasActorPermission } from "@/lib/auth/actor-policy";
import { getServerActorContext } from "@/lib/auth/server-actor";

export default async function PlatformAISettingsPage() {
  const actor = await getServerActorContext();
  if (!actor) redirect("/");
  if (!hasActorPermission(actor, "ai_config:view")) redirect("/access-denied");

  return (
    <main className="desktop-content">
      <p><Link href="/">← Back to SejukOps</Link></p>
      <AISettingsWorkspace />
    </main>
  );
}
