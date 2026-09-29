import Link from "next/link";
import { notFound } from "next/navigation";

import { getWorkspaceRequestContext } from "@/lib/auth/workspace-request-context";
import { AppstoreOutlined, BookOutlined, HomeOutlined, RobotOutlined, ScheduleOutlined } from "@ant-design/icons";
import { Button, Tag } from "antd";
import { readGuestAiBudget } from "@/lib/ai/runtime/guest-ai-budget";
import { hasActorPermission } from "@/lib/auth/actor-policy";

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
        <form action="/api/demo/persona" method="post" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label htmlFor="workspace-persona">Perspective</label>
          <select id="workspace-persona" name="persona" defaultValue={workspaceContext.guestVisit.persona}>
            <option value="ADMIN">Admin</option><option value="MANAGER">Manager</option><option value="TECHNICIAN">Technician</option>
          </select>
          <Button size="small" htmlType="submit">Switch</Button>
        </form>
        <form action="/api/demo/exit" method="post"><Button size="small" htmlType="submit">Leave Demo</Button></form>
        {allowance && <Tag color="purple">Guest AI: {allowance.remaining}/{allowance.limit} left today</Tag>}
      </div>}
      <nav aria-label="Workspace" className="workspace-nav">
        <Link href={`${base}/orders`}><AppstoreOutlined /> Orders</Link>
        {hasActorPermission(actor, "ai:use") && <Link href={`${base}/agent`}><RobotOutlined /> Agent</Link>}
        {canAssign && <Link href={`${base}/assignment`}><ScheduleOutlined /> Assignment</Link>}
        <Link href={`${base}/knowledge`}><BookOutlined /> Knowledge</Link>
        <Link href={workspaceContext.guestVisit ? "/demo" : "/"}><HomeOutlined /> {workspaceContext.guestVisit ? "Demo" : "Home"}</Link>
      </nav>
    </div></header>
    {children}
  </div>;
}
