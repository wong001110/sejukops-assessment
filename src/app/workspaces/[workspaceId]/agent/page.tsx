import { AgentWorkspace } from "../workspace-client";
import { getWorkspaceRequestContext } from "@/lib/auth/workspace-request-context";

export default async function AgentPage({ params, searchParams }: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ orderId?: string }>;
}) {
  const { workspaceId } = await params;
  const { orderId } = await searchParams;
  const workspaceContext = await getWorkspaceRequestContext(workspaceId);
  const actor = workspaceContext?.actor;
  const canAssign = !workspaceContext?.guestVisit &&
    (actor?.membership?.role === "ADMIN" || actor?.membership?.role === "MANAGER");
  return <AgentWorkspace workspaceId={workspaceId} focusOrderId={orderId} canAssign={canAssign} />;
}
