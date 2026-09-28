import Link from "next/link";
import { notFound } from "next/navigation";

import { getServerActorContext } from "@/lib/auth/server-actor";

export default async function WorkspaceLayout({ children, params }: {
  children: React.ReactNode; params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const actor = await getServerActorContext(workspaceId);
  if (!actor?.membership) notFound();
  const base = `/workspaces/${workspaceId}`;
  const canAssign = actor.membership.role === "ADMIN" || actor.membership.role === "MANAGER";
  return <>
    <header className="border-b bg-white px-4 py-3">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
        <div><strong>Sejuk Ops</strong><span className="ml-2 text-sm text-slate-600">{actor.membership.kind} workspace</span></div>
        <nav aria-label="Workspace" className="flex flex-wrap gap-3 text-sm">
          <Link href={`${base}/orders`}>Orders</Link>
          <Link href={`${base}/agent`}>Agent Workspace</Link>
          {canAssign && <Link href={`${base}/assignment`}>Assignment</Link>}
          <Link href={`${base}/knowledge`}>Knowledge</Link>
        </nav>
      </div>
    </header>
    {children}
  </>;
}
