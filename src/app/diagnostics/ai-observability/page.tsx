import Link from "next/link";
import { redirect } from "next/navigation";

import { AIObservabilityPagedWorkspace } from "@/components/diagnostics/ai-observability-paged-workspace";
import { hasActorPermission } from "@/lib/auth/actor-policy";
import { getServerActorContext } from "@/lib/auth/server-actor";

export default async function AIObservabilityPage() {
  const actor = await getServerActorContext();
  if (!actor) redirect("/");
  if (!hasActorPermission(actor, "diagnostics:view")) redirect("/access-denied");

  return (
    <div className="diagnostics-page">
      <header className="diagnostics-topbar">
        <div className="diagnostics-brand">
          <Link href="/" className="diagnostics-brand-link" aria-label="Back to SejukOps">
            <span className="brand-mark" aria-hidden>S</span>
            <span><strong>SejukOps</strong><small>Technical review</small></span>
          </Link>
          <span className="diagnostics-context-copy">Platform diagnostics</span>
        </div>
        <div className="diagnostics-topbar-actions">
          <Link className="diagnostics-back-link" href="/platform/ai-settings">
            ← Platform settings
          </Link>
        </div>
      </header>
      <AIObservabilityPagedWorkspace />
    </div>
  );
}
