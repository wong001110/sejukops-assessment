import { redirect } from "next/navigation";

export default async function WorkspaceHome({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  redirect(`/workspaces/${workspaceId}/overview`);
}
