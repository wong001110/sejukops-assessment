import { ArrowLeftOutlined } from "@ant-design/icons";
import { Button, Typography } from "antd";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AIObservabilityWorkspace } from "@/components/diagnostics/ai-observability-workspace";
import { RoleSwitcher } from "@/components/role-switcher";
import { hasPermission } from "@/lib/auth/permissions";
import { getCurrentDemoIdentity } from "@/lib/auth/server";

export default async function AIObservabilityPage() {
  const identity = await getCurrentDemoIdentity();
  if (!identity) redirect("/");
  if (!hasPermission(identity.role, "diagnostics:view")) redirect("/access-denied");

  return (
    <div className="diagnostics-page">
      <header className="diagnostics-topbar">
        <div className="diagnostics-brand">
          <Link href="/" className="diagnostics-brand-link" aria-label="Back to SejukOps">
            <span className="brand-mark" aria-hidden>S</span>
            <span>
              <strong>SejukOps</strong>
              <small>Technical review</small>
            </span>
          </Link>
          <Typography.Text type="secondary">Assessment diagnostics · not a business role</Typography.Text>
        </div>
        <div className="diagnostics-topbar-actions">
          <Link href={identity.role === "MANAGER" ? "/manager/ai-operations" : "/admin/ai-settings"}>
            <Button icon={<ArrowLeftOutlined />}>Back to workspace</Button>
          </Link>
          <RoleSwitcher currentIdentityId={identity.id} />
        </div>
      </header>
      <AIObservabilityWorkspace />
    </div>
  );
}
