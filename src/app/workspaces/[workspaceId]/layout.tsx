import Link from "next/link";
import { notFound } from "next/navigation";

import { getWorkspaceRequestContext } from "@/lib/auth/workspace-request-context";
import { Button, Tag } from "antd";
import { readGuestAiBudget } from "@/lib/ai/runtime/guest-ai-budget";
import { hasActorPermission } from "@/lib/auth/actor-policy";
import { WorkspaceNav } from "./workspace-nav";

export default async function WorkspaceLayout({ children, params }: {
  children: React.ReactNode; params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const workspaceContext = await getWorkspaceRequestContext(workspaceId);
  if (!workspaceContext) notFound();
  const actor = workspaceContext.actor;
  if (!actor?.membership) notFound();
  const base = `/workspaces/${workspaceId}`;
  const canAssign = !workspaceContext.guestVisit && actor.membership.role === "ADMIN";
  const allowance = workspaceContext.guestVisit
    ? await readGuestAiBudget(workspaceContext.guestVisit) : null;
  return <div className="workspace-shell">
    <header className="workspace-header"><div className="workspace-header-inner">
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
        {allowance && <Tag color="purple">Guest AI: {allowance.remaining}/{allowance.limit} left today</Tag>}
      </div>}
      <WorkspaceNav base={base} canUseAi={hasActorPermission(actor, "ai:use")}
        canAssign={canAssign} isGuest={Boolean(workspaceContext.guestVisit)} />
    </div></header>
    {children}
  </div>;
}
