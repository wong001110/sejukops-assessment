import { aiHistoryResponse } from "@/app/api/_shared/ai-session-history";
export function GET(request: Request) { return aiHistoryResponse(request, { owner: true }); }
