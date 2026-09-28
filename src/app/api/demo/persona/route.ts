import { NextResponse, type NextRequest } from "next/server";

import { isSameOrigin, parseDemoPersona } from "@/lib/auth/demo-entry";
import { getServerActorContext } from "@/lib/auth/server-actor";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request.headers.get("origin"), request.nextUrl)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const actor = await getServerActorContext();
  if (!actor?.isAnonymous || actor.platformRole !== "USER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  let form: FormData;
  try { form = await request.formData(); } catch {
    return NextResponse.json({ error: "Invalid form" }, { status: 400 });
  }
  const persona = parseDemoPersona(form.get("persona"));
  if (!persona) return NextResponse.json({ error: "Invalid persona" }, { status: 400 });
  const supabase = await createServerSupabaseClient();
  const { data: workspaceId, error } = await supabase.rpc("demo_select_persona", { p_role: persona });
  if (error || typeof workspaceId !== "string") {
    return NextResponse.json({ error: "Persona selection failed" }, { status: 403 });
  }
  const response = NextResponse.redirect(new URL(`/demo?workspace=${workspaceId}`, request.url), 303);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
