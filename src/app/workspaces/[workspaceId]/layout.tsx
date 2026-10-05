import Link from "next/link";
import { notFound } from "next/navigation";

import { getWorkspaceRequestContext } from "@/lib/auth/workspace-request-context";
import { Button, Tag } from "antd";
import { readGuestAiBudget } from "@/lib/ai/runtime/guest-ai-budget";
import { hasActorPermission } from "@/lib/auth/actor-policy";
import { formatMalaysiaDateTime } from "@/lib/time/malaysia";
import { OperationsShell } from "./operations-shell";
import { OwnerPreviewPanel } from "@/components/admin/owner-preview/owner-preview-panel";

export default async function WorkspaceLayout({ children, params }: {
  children: React.ReactNode; params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const workspaceContext = await getWorkspaceRequestContext(workspaceId);
  if (!workspaceContext) notFound();
  const actor = workspaceContext.actor;
  if (!actor?.membership) notFound();
  const base = `/workspaces/${workspaceId}`;
  const canAssign = !workspaceContext.guestVisit && hasActorPermission(actor, "order:assign");
  const allowance = workspaceContext.guestVisit
    ? await readGuestAiBudget(workspaceContext.guestVisit) : null;
  const header = <>
      <div className="workspace-header-meta"><Link href="/" className="product-brand">Sejuk<span>Ops</span></Link>
        <Tag color={actor.membership.kind === "DEMO" ? "blue" : "green"}>{actor.membership.kind} workspace</Tag>
        <Tag>{actor.membership.role}</Tag></div>
      {workspaceContext.guestVisit && <div className="workspace-header-meta">
        <form action="/api/demo/persona" method="post" className="workspace-persona-form">
          <label htmlFor="workspace-persona">Perspective</label>
          <select id="workspace-persona" name="persona" defaultValue={workspaceContext.guestVisit.persona}>
            <option value="ADMIN">Admin</option><option value="MANAGER">Manager</option><option value="TECHNICIAN">Technician</option>
          </select>
          <Button htmlType="submit">Switch</Button>
        </form>
        <form action="/api/demo/exit" method="post"><Button htmlType="submit">Leave Demo</Button></form>
        {allowance ? <>
          <Tag color={allowance.remaining === 0 ? "red" : "purple"}>
            {allowance.remaining === 0 ? "Guest AI used up today" : `Guest AI: ${allowance.remaining}/${allowance.limit} left today`}
          </Tag>
          <Tag>Resets {formatMalaysiaDateTime(allowance.resetAt)} MYT</Tag>
        </> : <Tag color="default">Guest AI allowance unavailable · Demo browsing still works</Tag>}
      </div>}
      {!workspaceContext.guestVisit && actor.platformRole === "SUPER_ADMIN" && actor.membership.kind === "OWNER" ? <OwnerPreviewPanel workspaceId={workspaceId} initialPreview={actor.preview ? { role: actor.membership.role, readOnly: true, effectiveEmployeeProfileId: actor.preview.effectiveEmployeeProfileId, effectiveEmployeeName: actor.preview.effectiveEmployeeName ?? null } : null} /> : null}
    </>;
  return <OperationsShell base={base} role={actor.membership.role} canUseAi={hasActorPermission(actor, "ai:use")}
    contextKey={`${actor.profileId}:${actor.sessionId ?? "formal"}:${workspaceContext.guestVisit?.id ?? "auth"}:${workspaceContext.guestVisit?.demoGeneration ?? "owner"}:${actor.preview?.previewId ?? "normal"}`}
    canAssign={canAssign} isGuest={Boolean(workspaceContext.guestVisit)} readOnly={Boolean(actor.preview)} header={header}>
    {children}
  </OperationsShell>;
}
