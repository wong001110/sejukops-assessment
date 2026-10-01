import { OrdersWorkspace } from "../workspace-client";
import { getWorkspaceRequestContext } from "@/lib/auth/workspace-request-context";
import { hasActorPermission } from "@/lib/auth/actor-policy";

export default async function OrdersPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const workspaceContext = await getWorkspaceRequestContext(workspaceId);
  const actor = workspaceContext?.actor;
  const canAssign = Boolean(actor && !workspaceContext?.guestVisit && hasActorPermission(actor, "order:assign"));
  const canCreate = Boolean(actor && hasActorPermission(actor, "order:create"));
  return <OrdersWorkspace workspaceId={workspaceId} canAssign={canAssign} canImport={canCreate} canCreate={canCreate} canUseAi={Boolean(actor && hasActorPermission(actor, "ai:use"))} technicianLabel={actor?.preview && actor.membership?.role === "TECHNICIAN" ? actor.preview.effectiveEmployeeName ?? undefined : undefined} isGuest={Boolean(workspaceContext?.guestVisit)} canGuestAssign={Boolean(workspaceContext?.guestVisit && actor?.membership?.role === "ADMIN" && hasActorPermission(actor, "order:assign"))} canManagerReschedule={Boolean(actor?.membership?.role === "MANAGER" && hasActorPermission(actor, "order:reschedule"))} canAdvanceJob={Boolean(actor?.membership?.role === "TECHNICIAN" && hasActorPermission(actor, "job:start_assigned"))} />;
}
