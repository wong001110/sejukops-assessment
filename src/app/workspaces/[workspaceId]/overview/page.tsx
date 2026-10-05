import { notFound } from "next/navigation";
import { getWorkspaceRequestContext } from "@/lib/auth/workspace-request-context";
import { hasActorPermission } from "@/lib/auth/actor-policy";
import { OperationsOverview } from "../operations-overview";

export default async function OverviewPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const context = await getWorkspaceRequestContext(workspaceId);
  const actor = context?.actor;
  if (!actor?.membership || actor.membership.workspaceId !== workspaceId ||
      (!hasActorPermission(actor, "order:view") && !hasActorPermission(actor, "job:view_assigned"))) notFound();
  const perspectiveKey = actor.preview ? `preview:${actor.preview.previewId ?? actor.preview.effectiveEmployeeProfileId ?? "role"}` : "normal";
  return <OperationsOverview key={`${workspaceId}:${actor.profileId}:${actor.membership.role}:${perspectiveKey}:${context?.guestVisit?.id ?? actor.sessionId ?? "formal"}`}
    workspaceId={workspaceId} role={actor.membership.role} readOnly={Boolean(actor.preview)}
    canAssign={Boolean(!context?.guestVisit && hasActorPermission(actor, "order:assign"))}
    isGuest={Boolean(context?.guestVisit)} />;
}
