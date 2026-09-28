import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import {
  demoIpDigest, isSameOriginRequest, parseDemoPersona, trustedDemoIp,
} from "@/lib/auth/demo-entry";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function back(request: NextRequest, error: string) {
  const response = NextResponse.redirect(new URL(`/demo?error=${error}`, request.url), 303);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return back(request, "denied");
  const ip = trustedDemoIp(request.headers);
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!ip || !serviceKey || !process.env.DEMO_TURNSTILE_SITE_KEY?.trim()
      || process.env.DEMO_SUPABASE_CAPTCHA_ENABLED !== "true") {
    return back(request, "unavailable");
  }

  let form: FormData;
  try { form = await request.formData(); } catch { return back(request, "invalid"); }
  const persona = parseDemoPersona(form.get("persona"));
  const token = form.get("cf-turnstile-response");
  if (!persona || typeof token !== "string" || !token || token.length > 4096) {
    return back(request, "invalid");
  }
  const session = await createServerSupabaseClient();
  const { data: existing } = await session.auth.getUser();
  if (existing.user) return back(request, "signed-in");
  const { url } = getSupabasePublicConfig();
  const service = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: admitted, error: admissionError } = await service.rpc("demo_entry_reserve", {
    p_ip_digest: demoIpDigest(ip, serviceKey),
  });
  if (admissionError || admitted !== true) return back(request, "limit");

  // Supabase Auth validates the one-use Turnstile token. Hosted CAPTCHA must
  // be enabled for this project's Auth provider before opening public entry.
  const { data: authData, error: authError } = await session.auth.signInAnonymously({
    options: { captchaToken: token },
  });
  if (authError || !authData.user || authData.user.is_anonymous !== true) {
    await session.auth.signOut();
    return back(request, "unavailable");
  }
  let workspaceId: unknown;
  let provisionFailed = false;
  try {
    const result = await service.rpc("demo_provision_user", {
      p_auth_user_id: authData.user.id,
      p_role: persona,
    });
    workspaceId = result.data;
    provisionFailed = Boolean(result.error);
  } catch {
    provisionFailed = true;
  }
  if (provisionFailed || typeof workspaceId !== "string") {
    await session.auth.signOut();
    await service.auth.admin.deleteUser(authData.user.id);
    return back(request, "unavailable");
  }
  const response = NextResponse.redirect(new URL(`/demo?workspace=${workspaceId}`, request.url), 303);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
