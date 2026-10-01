import { notFound } from "next/navigation";

import { getWorkspaceRequestContext } from "@/lib/auth/workspace-request-context";
import { hasActorPermission } from "@/lib/auth/actor-policy";

export default async function AssignmentLayout({ children, params }: {
  children: React.ReactNode;
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const context = await getWorkspaceRequestContext(workspaceId);
  if (!context || context.guestVisit || !hasActorPermission(context.actor, "order:assign")) notFound();
  return children;
}
