import { OrdersWorkspace } from "../workspace-client";
import { getServerActorContext } from "@/lib/auth/server-actor";

export default async function OrdersPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const actor = await getServerActorContext(workspaceId);
  const canAssign = actor?.membership?.role === "ADMIN" || actor?.membership?.role === "MANAGER";
  const canImport = actor?.membership?.role === "ADMIN";
  return <OrdersWorkspace workspaceId={workspaceId} canAssign={canAssign} canImport={canImport} />;
}
