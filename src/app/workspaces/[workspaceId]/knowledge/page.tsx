import { notFound } from "next/navigation";

import { getWorkspaceRequestContext } from "@/lib/auth/workspace-request-context";

import { KnowledgeWorkspace } from "./workspace";

export default async function KnowledgePage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const workspaceContext = await getWorkspaceRequestContext(workspaceId);
  const actor = workspaceContext?.actor;
  if (!actor) notFound();

  const perspectiveKey = actor.preview ? `preview:${actor.preview.previewId ?? actor.preview.effectiveEmployeeProfileId ?? "role"}` : "normal";
  return <KnowledgeWorkspace key={`${workspaceId}:${actor.profileId}:${actor.membership?.role}:${perspectiveKey}:${workspaceContext?.guestVisit?.id ?? actor.sessionId ?? "formal"}`} workspaceId={workspaceId} canEdit={
    !workspaceContext?.guestVisit &&
    !actor.preview?.readOnly &&
    (actor.membership?.role === "ADMIN" || actor.membership?.role === "MANAGER")
  } isDemo={actor.membership?.kind === "DEMO"} />;
}
