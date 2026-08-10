import { z } from "zod";

import {
  parseWhatsAppOpenInput,
  whatsappOpenResponse,
} from "@/app/api/_shared/whatsapp-open";
import { openCompletionWhatsApp } from "@/lib/services/completion-notifications/service";
import { managerApiError } from "@/app/api/manager/_shared/responses";

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id: candidate } = await context.params;
    const id = z.string().uuid().parse(candidate);
    const input = await parseWhatsAppOpenInput(request);
    const notification = await openCompletionWhatsApp(
      id,
      input,
      "order:view",
      ["ADMIN"],
    );
    return whatsappOpenResponse(request, notification);
  } catch (error) {
    return managerApiError(error);
  }
}
