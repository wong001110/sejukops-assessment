import { aiHistoryResponse } from "@/app/api/_shared/ai-session-history";
export async function GET(request: Request, context: { params: Promise<{ workspaceId: string; sessionId: string }> }) {
  const { workspaceId, sessionId } = await context.params;
  return aiHistoryResponse(request, { workspaceId, sessionId });
}
