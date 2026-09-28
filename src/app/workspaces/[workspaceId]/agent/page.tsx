import { AgentWorkspace } from "../workspace-client";
import { getServerActorContext } from "@/lib/auth/server-actor";

export default async function AgentPage({ params, searchParams }: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ orderId?: string }>;
}) {
  const { workspaceId } = await params;
  const { orderId } = await searchParams;
  const actor = await getServerActorContext(workspaceId);
  const canAssign = actor?.membership?.role === "ADMIN" || actor?.membership?.role === "MANAGER";
  return <AgentWorkspace workspaceId={workspaceId} focusOrderId={orderId} canAssign={canAssign} />;
}
