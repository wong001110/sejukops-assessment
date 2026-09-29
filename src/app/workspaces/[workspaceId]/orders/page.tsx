import { OrdersWorkspace } from "../workspace-client";
import { getWorkspaceRequestContext } from "@/lib/auth/workspace-request-context";

export default async function OrdersPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const workspaceContext = await getWorkspaceRequestContext(workspaceId);
  const actor = workspaceContext?.actor;
  const canAssign = !workspaceContext?.guestVisit &&
    (actor?.membership?.role === "ADMIN" || actor?.membership?.role === "MANAGER");
  const canImport = !workspaceContext?.guestVisit && actor?.membership?.role === "ADMIN";
  const canCreate = actor?.membership?.role === "ADMIN";
  return <OrdersWorkspace workspaceId={workspaceId} canAssign={canAssign} canImport={canImport} canCreate={canCreate} isGuest={Boolean(workspaceContext?.guestVisit)} canGuestAssign={Boolean(workspaceContext?.guestVisit && actor?.membership?.role === "ADMIN")} canAdvanceJob={actor?.membership?.role === "TECHNICIAN"} />;
}
