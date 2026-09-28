import { notFound } from "next/navigation";

import { getServerActorContext } from "@/lib/auth/server-actor";

import { KnowledgeWorkspace } from "./workspace";

export default async function KnowledgePage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const actor = await getServerActorContext(workspaceId);
  if (!actor) notFound();

  return <KnowledgeWorkspace workspaceId={workspaceId} canEdit={
    actor.membership?.role === "ADMIN" || actor.membership?.role === "MANAGER"
  } isDemo={actor.membership?.kind === "DEMO"} />;
}
