import { aiHistoryResponse } from "@/app/api/_shared/ai-session-history";
export async function GET(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  return aiHistoryResponse(request, { owner: true, sessionId: (await context.params).sessionId });
}
