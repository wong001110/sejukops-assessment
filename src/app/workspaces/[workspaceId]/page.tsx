import { getWorkspaceRequestContext } from "@/lib/auth/workspace-request-context";
import { workspaceEntryPage } from "@/lib/auth/workspace-entry-path";
import { redirect } from "next/navigation";

export default async function WorkspaceHome({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const context = await getWorkspaceRequestContext(workspaceId);
  redirect(`/workspaces/${workspaceId}/${workspaceEntryPage(context?.actor.membership?.role)}`);
}
