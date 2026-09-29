import { NextResponse, type NextRequest } from "next/server";

import { isSameOriginRequest } from "@/lib/auth/demo-entry";
import { createGuestServiceClient, GUEST_COOKIE_NAME, guestTokenHash, isGuestToken } from "@/lib/auth/guest-session";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const token = request.cookies.get(GUEST_COOKIE_NAME)?.value;
  if (isGuestToken(token)) {
    const service = createGuestServiceClient();
    if (!service) return NextResponse.json({ error: "Unavailable" }, { status: 503 });
    const { error } = await service.from("guest_visits")
      .update({ revoked_at: new Date().toISOString() })
      .eq("token_hash", guestTokenHash(token)).is("revoked_at", null);
    if (error) return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  }
  const response = NextResponse.redirect(new URL("/demo", request.headers.get("origin") ?? request.url), 303);
  response.headers.set("Cache-Control", "private, no-store");
  response.cookies.delete(GUEST_COOKIE_NAME);
  return response;
}
