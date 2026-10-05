import { notFound } from "next/navigation";

import { getWorkspaceRequestContext } from "@/lib/auth/workspace-request-context";

import { KnowledgeWorkspace } from "./workspace";

export default async function KnowledgePage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const workspaceContext = await getWorkspaceRequestContext(workspaceId);
  const actor = workspaceContext?.actor;
  if (!actor) notFound();

  return <KnowledgeWorkspace workspaceId={workspaceId} canEdit={
    !workspaceContext?.guestVisit &&
    !actor.preview?.readOnly &&
    (actor.membership?.role === "ADMIN" || actor.membership?.role === "MANAGER")
  } isDemo={actor.membership?.kind === "DEMO"} />;
}
