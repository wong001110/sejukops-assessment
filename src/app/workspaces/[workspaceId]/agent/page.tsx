import { AgentWorkspace } from "../workspace-client";
import { getWorkspaceRequestContext } from "@/lib/auth/workspace-request-context";
import { hasActorPermission } from "@/lib/auth/actor-policy";
import { notFound } from "next/navigation";

export default async function AgentPage({ params, searchParams }: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ orderId?: string }>;
}) {
  const { workspaceId } = await params;
  const { orderId } = await searchParams;
  const focusOrderId = typeof orderId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(orderId)
    ? orderId : undefined;
  const workspaceContext = await getWorkspaceRequestContext(workspaceId);
  const actor = workspaceContext?.actor;
  if (!actor || !hasActorPermission(actor, "ai:use")) notFound();
  const canAssign = !workspaceContext.guestVisit && actor.membership?.role === "ADMIN";
  const manualTask = actor.membership?.role === "MANAGER" ? "reschedule"
    : workspaceContext.guestVisit && actor.membership?.role === "ADMIN" ? "assign" : null;
  return <AgentWorkspace workspaceId={workspaceId} focusOrderId={focusOrderId} canAssign={canAssign} manualTask={manualTask} isGuest={Boolean(workspaceContext.guestVisit)} />;
}
