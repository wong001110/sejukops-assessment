import { NextResponse } from "next/server";

import { listAIObservations } from "@/lib/observability/ai-observation-store";

export const runtime = "nodejs";

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = Reflect.get(error, "code");
  return typeof code === "string" ? code : null;
}

export async function GET() {
  try {
    return NextResponse.json(await listAIObservations());
  } catch (error) {
    const code = errorCode(error);
    if (code === "PERMISSION_DENIED" || code === "DEMO_SESSION_REQUIRED") {
      return NextResponse.json(
        { error: { code: "DIAGNOSTICS_PERMISSION_DENIED", message: "Technical diagnostics are available to Admin and Manager demo sessions." } },
        { status: 403 },
      );
    }
    if (code === "SUPABASE_SERVICE_ROLE_CONFIGURATION_MISSING") {
      return NextResponse.json(
        { error: { code: "DIAGNOSTICS_UNAVAILABLE", message: "Central AI observability requires the configured server data connection." } },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: { code: "DIAGNOSTICS_UNAVAILABLE", message: "AI observability is temporarily unavailable." } },
      { status: 503 },
    );
  }
}
