import "server-only";

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import {
  getSupabaseConfigStatus,
  getSupabasePublicConfig,
  type SupabaseConfigStatus,
} from "./config";

export function getServerSupabaseConfigStatus(): SupabaseConfigStatus {
  return getSupabaseConfigStatus();
}

/**
 * Creates a request-scoped server client using the public anon key and the
 * caller's auth cookies. This intentionally does not provide a service-role
 * client or an RLS bypass.
 */
export async function createServerSupabaseClient(): Promise<SupabaseClient> {
  const config = getSupabasePublicConfig();
  const cookieStore = await cookies();

  return createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(
        cookiesToSet: Array<{
          name: string;
          value: string;
          options: CookieOptions;
        }>,
      ) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot write cookies. Middleware or a Route
          // Handler is responsible for refreshing sessions in that context.
        }
      },
    },
  });
}
