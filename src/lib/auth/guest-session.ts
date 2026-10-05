import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getSupabasePublicConfig } from "@/lib/supabase/config";

import { parseDemoPersona, type DemoPersona } from "./demo-entry";

export const GUEST_COOKIE_NAME = "sejuk_guest_visit";
export const GUEST_VISIT_SECONDS = 2 * 60 * 60;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type GuestVisit = Readonly<{
  id: string;
  workspaceId: string;
  persona: DemoPersona;
  demoGeneration: number;
  expiresAt: string;
}>;

/** The key is never returned to a browser or used in a client component. */
export function createGuestServiceClient(): SupabaseClient | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) return null;
  const { url } = getSupabasePublicConfig();
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function guestTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isGuestToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

/** Keep a short audit window without retaining expired public visits indefinitely. */
export async function pruneExpiredGuestVisits(service: SupabaseClient): Promise<void> {
  try {
    await service.from("guest_visits").delete()
      .lt("expires_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  } catch {
    // Cleanup is best effort; a valid new visit must remain usable.
  }
}

/** A fresh random bearer is kept only in the HttpOnly cookie; the DB stores its digest. */
export async function issueGuestVisit(
  service: SupabaseClient,
  persona: DemoPersona,
): Promise<{ token: string; visit: GuestVisit } | null> {
  const { data: workspace, error: workspaceError } = await service.from("workspaces")
    .select("id,generation,kind,active")
    .eq("kind", "DEMO")
    .eq("active", true)
    .maybeSingle();
  if (workspaceError || !workspace || !UUID.test(workspace.id)
    || workspace.kind !== "DEMO" || workspace.active !== true
    || !Number.isSafeInteger(workspace.generation) || workspace.generation < 1) return null;

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + GUEST_VISIT_SECONDS * 1000).toISOString();
  const { data: inserted, error: insertError } = await service.from("guest_visits")
    .insert({
      token_hash: guestTokenHash(token),
      workspace_id: workspace.id,
      persona,
      demo_generation: workspace.generation,
      expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (insertError || !inserted || !UUID.test(inserted.id)) return null;
  return {
    token,
    visit: {
      id: inserted.id,
      workspaceId: workspace.id,
      persona,
      demoGeneration: workspace.generation,
      expiresAt,
    },
  };
}

/** Always re-read revocation, expiry, workspace kind and reset generation. */
export async function resolveGuestVisit(
  service: SupabaseClient,
  token: unknown,
): Promise<GuestVisit | null> {
  if (!isGuestToken(token)) return null;
  const { data: row, error } = await service.from("guest_visits")
    .select("id,workspace_id,persona,demo_generation,expires_at,revoked_at")
    .eq("token_hash", guestTokenHash(token))
    .maybeSingle();
  if (error || !row || !UUID.test(row.id) || !UUID.test(row.workspace_id)
    || row.revoked_at !== null || !parseDemoPersona(row.persona)
    || !Number.isSafeInteger(row.demo_generation) || row.demo_generation < 1
    || typeof row.expires_at !== "string"
    || !Number.isFinite(Date.parse(row.expires_at))
    || Date.parse(row.expires_at) <= Date.now()) return null;

  const { data: workspace, error: workspaceError } = await service.from("workspaces")
    .select("id,kind,active,generation")
    .eq("id", row.workspace_id)
    .maybeSingle();
  if (workspaceError || !workspace || workspace.kind !== "DEMO" || workspace.active !== true
    || workspace.generation !== row.demo_generation) return null;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    persona: row.persona,
    demoGeneration: row.demo_generation,
    expiresAt: row.expires_at,
  };
}

/** Persona remains on the server record; the browser cannot select a role by cookie. */
export async function changeGuestPersona(
  service: SupabaseClient,
  token: string,
  visit: GuestVisit,
  persona: DemoPersona,
): Promise<boolean> {
  if (!isGuestToken(token)) return false;
  const { data, error } = await service.from("guest_visits")
    .update({ persona })
    .eq("id", visit.id)
    .eq("token_hash", guestTokenHash(token))
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("id")
    .maybeSingle();
  return !error && data?.id === visit.id;
}
