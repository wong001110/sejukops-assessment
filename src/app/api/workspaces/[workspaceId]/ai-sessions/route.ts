import { aiHistoryResponse } from "@/app/api/_shared/ai-session-history";
export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  return aiHistoryResponse(request, { workspaceId: (await context.params).workspaceId });
}
