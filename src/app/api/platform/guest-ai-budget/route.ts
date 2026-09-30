import { NextResponse, type NextRequest } from "next/server";

import { readGuestAiBudgetForAdmin, setGuestAiDailyLimit } from "@/lib/ai/runtime/guest-ai-budget";
import { isSameOriginRequest } from "@/lib/auth/demo-entry";

export const runtime = "nodejs";

const noStore = { "Cache-Control": "private, no-store" };

function unavailable(error: unknown) {
  if (error && typeof error === "object" && Reflect.get(error, "code") === "PERMISSION_DENIED") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: noStore });
  }
  return NextResponse.json({ error: "Guest AI allowance unavailable" }, { status: 503, headers: noStore });
}

export async function GET() {
  try {
    const budget = await readGuestAiBudgetForAdmin();
    if (!budget) return unavailable(null);
    return NextResponse.json(budget, { headers: noStore });
  } catch (error) {
    return unavailable(error);
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: noStore });
  }

  let input: unknown;
  try { input = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid daily limit" }, { status: 400, headers: noStore });
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return NextResponse.json({ error: "Invalid daily limit" }, { status: 400, headers: noStore });
  }
  const limit = (input as Record<string, unknown>).limit;
  if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
    return NextResponse.json({ error: "Daily limit must be an integer from 1 to 1000" }, { status: 400, headers: noStore });
  }

  try {
    return NextResponse.json({ limit: await setGuestAiDailyLimit(limit) }, { headers: noStore });
  } catch (error) {
    return unavailable(error);
  }
}
