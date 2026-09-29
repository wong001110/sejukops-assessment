import Link from "next/link";
import { notFound } from "next/navigation";

import { getServerActorContext } from "@/lib/auth/server-actor";
import { AppstoreOutlined, BookOutlined, HomeOutlined, RobotOutlined, ScheduleOutlined } from "@ant-design/icons";
import { Tag } from "antd";

export default async function WorkspaceLayout({ children, params }: {
  children: React.ReactNode; params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const actor = await getServerActorContext(workspaceId);
  if (!actor?.membership) notFound();
  const base = `/workspaces/${workspaceId}`;
  const canAssign = actor.membership.role === "ADMIN" || actor.membership.role === "MANAGER";
  return <div className="workspace-shell">
    <header className="workspace-header"><div className="workspace-header-inner">
      <div className="workspace-header-meta"><Link href="/" className="product-brand">Sejuk<span>Ops</span></Link>
        <Tag color={actor.membership.kind === "DEMO" ? "blue" : "green"}>{actor.membership.kind} workspace</Tag>
        <Tag>{actor.membership.role}</Tag></div>
      <nav aria-label="Workspace" className="workspace-nav">
        <Link href={`${base}/orders`}><AppstoreOutlined /> Orders</Link>
        <Link href={`${base}/agent`}><RobotOutlined /> Agent</Link>
        {canAssign && <Link href={`${base}/assignment`}><ScheduleOutlined /> Assignment</Link>}
        <Link href={`${base}/knowledge`}><BookOutlined /> Knowledge</Link>
        <Link href="/"><HomeOutlined /> Home</Link>
      </nav>
    </div></header>
    {children}
  </div>;
}
