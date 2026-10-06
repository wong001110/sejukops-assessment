import { notFound } from "next/navigation";
import { getWorkspaceRequestContext } from "@/lib/auth/workspace-request-context";
import { hasActorPermission } from "@/lib/auth/actor-policy";
import AssignmentProposalPage from "./workspace";

export default async function AssignmentPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const context = await getWorkspaceRequestContext(workspaceId);
  if (!context || context.guestVisit || context.actor.membership?.role !== "ADMIN" || !hasActorPermission(context.actor, "order:assign")) notFound();
  return <AssignmentProposalPage key={`${workspaceId}:${context.actor.profileId}:${context.actor.sessionId ?? "formal"}`} />;
}
