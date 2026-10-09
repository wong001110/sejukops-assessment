import { redirect } from "next/navigation";

import { hasActorPermission } from "@/lib/auth/actor-policy";
import { getServerActorContext } from "@/lib/auth/server-actor";
import { readOwnerWorkspaceEntry } from "@/lib/services/workspaces/owner-entry";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { OwnerConsole, type OwnerConsoleView } from "./owner-console";

export default async function OwnerConsolePage({ searchParams }: {
  searchParams: Promise<{ view?: string }>;
}) {
  const actor = await getServerActorContext();
  if (!actor || actor.isAnonymous || actor.platformRole !== "SUPER_ADMIN" || actor.businessReady === false) {
    redirect("/owner/login");
  }
  const { view } = await searchParams;
  const initialView: OwnerConsoleView = view === "sessions" || view === "settings" ? view : "workspace";
  let nativeWorkspace: { workspaceId: string; contextKey: string; canAssign: boolean; manualTask: "reschedule" | null } | null = null;
  let workspaceMessage = "Your active Owner workspace membership is unavailable. Retry or check your account controls.";
  try {
    const workspaceId = await readOwnerWorkspaceEntry(actor, await createServerSupabaseClient());
    const scopedActor = workspaceId ? await getServerActorContext(workspaceId) : null;
    if (scopedActor?.preview) {
      workspaceMessage = "Exit the read-only perspective from account controls before opening My Workspace.";
    } else if (workspaceId && scopedActor && !scopedActor.isAnonymous && scopedActor.platformRole === "SUPER_ADMIN" &&
      scopedActor.membership?.workspaceId === workspaceId && scopedActor.membership.kind === "OWNER" && hasActorPermission(scopedActor, "ai:use")) {
      nativeWorkspace = { workspaceId, contextKey: `${scopedActor.profileId}:${scopedActor.sessionId ?? "formal"}:${scopedActor.membership.role}:owner-console`,
        canAssign: hasActorPermission(scopedActor, "order:assign"), manualTask: scopedActor.membership.role === "MANAGER" ? "reschedule" : null };
    }
  } catch {
    workspaceMessage = "Your Owner workspace could not be checked. Retry when the connection is available.";
  }
  return <OwnerConsole initialView={initialView} nativeWorkspace={nativeWorkspace} workspaceMessage={workspaceMessage} />;
}
