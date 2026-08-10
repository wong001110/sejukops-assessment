import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("supabase/migrations/202608100008_ai_configuration.sql"),
  "utf8",
);

describe("Phase 6 AI configuration migration", () => {
  it("stores an explicit complete authenticated-encryption envelope only", () => {
    expect(migration).toContain("add column api_key_iv text");
    expect(migration).toContain("add column api_key_auth_tag text");
    expect(migration).toContain("add column encryption_version smallint");
    expect(migration).toContain("ai_provider_encrypted_credential_complete");
    expect(migration).toContain("encryption_version = 1");
    expect(migration).not.toMatch(/p_(?:plain|raw)_?api_key/i);
  });

  it("idempotently replays provider creation and conflicts on changed payload", () => {
    expect(migration).toContain("add column create_request_key uuid unique");
    expect(migration).toContain("add column create_payload_signature text");
    expect(migration).toContain("ai_provider_create_idempotency_complete");
    expect(migration).toContain("'ai-provider:create:' || p_create_request_key::text");
    expect(migration).toContain("pg_catalog.pg_advisory_xact_lock");
    expect(migration).toContain(
      "v_replay_payload_signature is distinct from p_create_payload_signature",
    );
    expect(migration).toContain("IDEMPOTENCY_KEY_CONFLICT");
    expect(migration).toContain("return query select v_replay_provider_config_id, false");
  });

  it("removes browser/authenticated table access and exposes mutations only to service role", () => {
    expect(migration).toContain(
      "drop policy if exists ai_provider_configs_admin_only",
    );
    expect(migration).toContain(
      "revoke all on table public.ai_provider_configs from public, anon, authenticated",
    );
    expect(migration).toContain("grant execute on function public.admin_upsert_ai_provider");
    expect(migration).toContain("to service_role;");
  });

  it("validates an active database Admin before every configuration mutation", () => {
    expect(migration).toContain("p.role = 'ADMIN' and p.active");
    expect(migration.match(/perform public\.ai_assert_config_actor/g)).toHaveLength(3);
  });

  it("deletes provider/default/routes atomically in one RPC", () => {
    const deletion = migration.slice(
      migration.indexOf("function public.admin_delete_ai_provider"),
      migration.indexOf("function public.admin_update_ai_routing"),
    );
    expect(deletion).toContain("delete from public.ai_task_routes");
    expect(deletion).toContain("set default_provider_config_id = null");
    expect(deletion).toContain("delete from public.ai_provider_configs");
  });

  it("fully replaces routing and validates every non-null route capability", () => {
    expect(migration).toContain("pg_catalog.jsonb_object_length(p_routes) <> 4");
    expect(migration).toContain("delete from public.ai_task_routes;");
    expect(migration).toContain("where routes.value <> 'null'::jsonb");
    expect(migration).toContain("public.ai_profile_supports_task");
    expect(migration).toContain("AI_CAPABILITY_MISMATCH");
  });
});
