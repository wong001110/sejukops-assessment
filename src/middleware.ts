import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabasePublicConfig } from "@/lib/supabase/config";

/** Refresh Auth cookies before protected Server Components read the session. */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, anonKey } = getSupabasePublicConfig();
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
        response.headers.set("Cache-Control", "private, no-store");
      },
    },
  });

  // Refresh only. Each page/action/API rechecks its own actor and permission.
  await supabase.auth.getClaims();
  return response;
}

export const config = {
  matcher: [
    "/demo/:path*",
    "/api/demo/:path*",
    "/owner/:path*",
    "/platform/:path*",
    "/diagnostics/:path*",
    "/api/workspaces/:path*",
    "/api/diagnostics/:path*",
  ],
};
