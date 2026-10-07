import { NextResponse } from "next/server";
import { isSameOriginRequest } from "@/lib/auth/demo-entry";

/** Request intent is separate from the fresh platform identity checked by every mutation. */
export function aiSettingsMutationError(request: Request, jsonBody = true): NextResponse | null {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: {
      code: "AI_CONFIG_PERMISSION_DENIED", message: "AI settings requests must come from this application.",
    } }, { status: 403 });
  }
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (jsonBody && mediaType !== "application/json") {
    return NextResponse.json({ error: {
      code: "AI_CONFIG_VALIDATION_FAILED", message: "Use application/json for AI settings requests.",
    } }, { status: 415 });
  }
  return null;
}
