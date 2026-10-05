import { NextResponse, type NextRequest } from "next/server";

import { isSameOriginRequest } from "@/lib/auth/demo-entry";
import {
  createGuestServiceClient, GUEST_COOKIE_NAME, GUEST_VISIT_SECONDS,
  issueGuestVisit, pruneExpiredGuestVisits,
} from "@/lib/auth/guest-session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function back(request: NextRequest, error: string) {
  const response = NextResponse.redirect(new URL(`/demo?error=${error}`, request.headers.get("origin") ?? request.url), 303);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return back(request, "denied");
  // Permanent Owner sessions must not be turned into a Guest session.
  const session = await createServerSupabaseClient();
  const { data: existing, error: authError } = await session.auth.getUser();
  if (existing.user) return back(request, "signed-in");
  if (authError && authError.name !== "AuthSessionMissingError") return back(request, "unavailable");

  const service = createGuestServiceClient();
  if (!service) return back(request, "unavailable");
  const issued = await issueGuestVisit(service, "ADMIN");
  if (!issued) return back(request, "unavailable");
  await pruneExpiredGuestVisits(service);

  const response = NextResponse.redirect(
    new URL(`/workspaces/${issued.visit.workspaceId}/overview`, request.headers.get("origin") ?? request.url), 303,
  );
  response.headers.set("Cache-Control", "private, no-store");
  response.cookies.set(GUEST_COOKIE_NAME, issued.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:"
      || request.headers.get("x-forwarded-proto") === "https",
    path: "/",
    maxAge: GUEST_VISIT_SECONDS,
  });
  return response;
}
