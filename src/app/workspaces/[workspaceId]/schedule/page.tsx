import { notFound } from "next/navigation";
import { getWorkspaceRequestContext } from "@/lib/auth/workspace-request-context";
import { hasActorPermission } from "@/lib/auth/actor-policy";
import { OrdersWorkspace } from "../workspace-client";

export default async function SchedulePage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const context = await getWorkspaceRequestContext(workspaceId);
  if (!context || context.actor.membership?.role !== "MANAGER" || !hasActorPermission(context.actor, "order:reschedule")) notFound();
  return <OrdersWorkspace key={`${workspaceId}:${context.actor.profileId}:${context.guestVisit?.id ?? context.actor.sessionId ?? "formal"}`} role="MANAGER" workspaceId={workspaceId} presentation="schedule" canAssign={false} canCreate={false} canImport={false}
    canGuestAssign={false} canManagerReschedule canAdvanceJob={false} canUseAi={hasActorPermission(context.actor, "ai:use")} isGuest={Boolean(context.guestVisit)} />;
}
