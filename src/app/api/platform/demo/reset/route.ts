import { NextResponse, type NextRequest } from "next/server";

import { isSameOriginRequest } from "@/lib/auth/demo-entry";
import { readDemoResetStatus, resetDemoWorkspace } from "@/lib/services/demo-reset/service";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "private, no-store" };

export async function GET() {
  try {
    return NextResponse.json(await readDemoResetStatus(), { headers: noStore });
  } catch (error) {
    const forbidden = error && typeof error === "object" && Reflect.get(error, "code") === "PERMISSION_DENIED";
    return NextResponse.json({ error: forbidden ? "Forbidden" : "Demo status unavailable" },
      { status: forbidden ? 403 : 503, headers: noStore });
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  let input: unknown;
  try { input = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid reset request" }, { status: 400 });
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return NextResponse.json({ error: "Invalid reset request" }, { status: 400 });
  }
  const body = input as Record<string, unknown>;
  if (body.confirm !== "RESET DEMO" ||
      !Number.isSafeInteger(body.expectedGeneration) ||
      typeof body.expectedGeneration !== "number" || body.expectedGeneration < 1) {
    return NextResponse.json({ error: "Invalid reset request" }, { status: 400 });
  }
  try {
    const generation = await resetDemoWorkspace(body.expectedGeneration);
    return NextResponse.json({ generation }, { headers: noStore });
  } catch (error) {
    if (error && typeof error === "object" && Reflect.get(error, "code") === "PERMISSION_DENIED") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "Demo reset unavailable" }, { status: 503 });
  }
}
