"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  getSupabaseConfigStatus,
  getSupabasePublicConfig,
  type SupabaseConfigStatus,
} from "./config";

let browserClient: SupabaseClient | undefined;

export function getBrowserSupabaseConfigStatus(): SupabaseConfigStatus {
  return getSupabaseConfigStatus();
}

export function createBrowserSupabaseClient(): SupabaseClient {
  if (browserClient) {
    return browserClient;
  }

  const config = getSupabasePublicConfig();
  browserClient = createBrowserClient(config.url, config.anonKey);
  return browserClient;
}
