import Link from "next/link";
import { redirect } from "next/navigation";

import { AIObservabilityWorkspace } from "@/components/diagnostics/ai-observability-workspace";
import { RoleSwitcher } from "@/components/role-switcher";
import { hasPermission } from "@/lib/auth/permissions";
import { getCurrentDemoIdentity } from "@/lib/auth/server";

export default async function AIObservabilityPage() {
  const identity = await getCurrentDemoIdentity();
  if (!identity) redirect("/");
  if (!hasPermission(identity.role, "diagnostics:view")) {
    redirect("/access-denied");
  }

  const workspaceHref =
    identity.role === "MANAGER" ? "/manager/ai-operations" : "/admin/ai-settings";

  return (
    <div className="diagnostics-page">
      <header className="diagnostics-topbar">
        <div className="diagnostics-brand">
          <Link
            href="/"
            className="diagnostics-brand-link"
            aria-label="Back to SejukOps"
          >
            <span className="brand-mark" aria-hidden>
              S
            </span>
            <span>
              <strong>SejukOps</strong>
              <small>Technical review</small>
            </span>
          </Link>
          <span className="diagnostics-context-copy">
            Assessment diagnostics · not a business role
          </span>
        </div>
        <div className="diagnostics-topbar-actions">
          <Link className="diagnostics-back-link" href={workspaceHref}>
            ← Back to workspace
          </Link>
          <RoleSwitcher currentIdentityId={identity.id} />
        </div>
      </header>
      <AIObservabilityWorkspace />
    </div>
  );
}
