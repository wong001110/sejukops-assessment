import { AgentWorkspace } from "../workspace-client";
import { getWorkspaceRequestContext } from "@/lib/auth/workspace-request-context";
import { hasActorPermission } from "@/lib/auth/actor-policy";
import { notFound } from "next/navigation";
import { parseOrderFocusId } from "./order-focus";

export default async function AgentPage({ params, searchParams }: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ orderId?: string }>;
}) {
  const { workspaceId } = await params;
  const { orderId } = await searchParams;
  const focusOrderId = parseOrderFocusId(orderId);
  const workspaceContext = await getWorkspaceRequestContext(workspaceId);
  const actor = workspaceContext?.actor;
  if (!actor || !hasActorPermission(actor, "ai:use")) notFound();
  const canAssign = !workspaceContext.guestVisit && actor.membership?.role === "ADMIN";
  const manualTask = actor.membership?.role === "MANAGER" ? "reschedule"
    : workspaceContext.guestVisit && actor.membership?.role === "ADMIN" ? "assign" : null;
  const contextKey = `${actor.profileId}:${actor.membership?.role}:${workspaceContext.guestVisit?.id ?? "auth"}:${workspaceContext.guestVisit?.demoGeneration ?? "owner"}`;
  return <AgentWorkspace workspaceId={workspaceId} contextKey={contextKey} focusOrderId={focusOrderId} canAssign={canAssign} manualTask={manualTask} isGuest={Boolean(workspaceContext.guestVisit)} />;
}
