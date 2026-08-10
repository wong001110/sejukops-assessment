import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getCompletionWhatsApp,
  prepareCompletionWhatsApp,
} from "@/lib/services/completion-notifications/service";

import { technicianCompletionApiError } from "../evidence/_shared/responses";

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id: candidate } = await context.params;
    const id = z.string().uuid().parse(candidate);
    const notification = await getCompletionWhatsApp(
      id,
      "job:view_assigned",
      ["TECHNICIAN"],
    );
    return NextResponse.json({ notification });
  } catch (error) {
    return technicianCompletionApiError(error);
  }
}

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id: candidate } = await context.params;
    const id = z.string().uuid().parse(candidate);
    const notification = await prepareCompletionWhatsApp(
      id,
      "job:view_assigned",
      ["TECHNICIAN"],
    );
    return NextResponse.json({ notification });
  } catch (error) {
    return technicianCompletionApiError(error);
  }
}
