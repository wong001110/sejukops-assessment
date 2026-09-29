import { NextResponse, type NextRequest } from "next/server";

import { isSameOriginRequest, parseDemoPersona } from "@/lib/auth/demo-entry";
import { guestPersonaReturnUrl } from "@/lib/auth/guest-persona-return";
import {
  changeGuestPersona, createGuestServiceClient, GUEST_COOKIE_NAME, resolveGuestVisit,
} from "@/lib/auth/guest-session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const token = request.cookies.get(GUEST_COOKIE_NAME)?.value;
  const service = createGuestServiceClient();
  if (!service || !token) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const visit = await resolveGuestVisit(service, token);
  if (!visit) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const session = await createServerSupabaseClient();
  const { data: authData, error: authError } = await session.auth.getUser();
  if (authData.user || (authError && authError.name !== "AuthSessionMissingError")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  let form: FormData;
  try { form = await request.formData(); } catch {
    return NextResponse.json({ error: "Invalid form" }, { status: 400 });
  }
  const persona = parseDemoPersona(form.get("persona"));
  if (!persona) return NextResponse.json({ error: "Invalid persona" }, { status: 400 });
  if (!(await changeGuestPersona(service, token, visit, persona))) {
    return NextResponse.json({ error: "Persona selection failed" }, { status: 403 });
  }
  const origin = new URL(request.headers.get("origin") ?? request.url).origin;
  const response = NextResponse.redirect(guestPersonaReturnUrl(
    origin, request.headers.get("referer"), visit.workspaceId, persona,
  ), 303);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
