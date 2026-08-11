import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("supabase/migrations/202608100014_admin_order_customer_reuse.sql"),
  "utf8",
);
const replayAuthorizationMigration = readFileSync(
  resolve("supabase/migrations/202608110015_admin_order_replay_authorization.sql"),
  "utf8",
);
const documentMigration = readFileSync(
  resolve("supabase/migrations/202608100013_document_understanding.sql"),
  "utf8",
);

describe("Admin order customer reuse repair migration", () => {
  it("authenticates before replay and binds the key to its original actor", () => {
    const advisoryLock = replayAuthorizationMigration.indexOf(
      "perform pg_catalog.pg_advisory_xact_lock",
    );
    const activeAdminLock = replayAuthorizationMigration.indexOf("for share;");
    const replayLookup = replayAuthorizationMigration.indexOf("from public.audit_logs a");
    const replayReturn = replayAuthorizationMigration.indexOf(
      "return query select v_order_id, v_customer_reused;",
    );

    expect(advisoryLock).toBeGreaterThan(-1);
    expect(advisoryLock).toBeLessThan(activeAdminLock);
    expect(activeAdminLock).toBeLessThan(replayLookup);
    expect(replayLookup).toBeLessThan(replayReturn);
    expect(replayAuthorizationMigration).toMatch(
      /perform 1[\s\S]*?where p\.id = p_actor_profile_id and p\.role = 'ADMIN' and p\.active[\s\S]*?for share;[\s\S]*?if not found then[\s\S]*?INVALID_ADMIN_ACTOR/,
    );
    expect(replayAuthorizationMigration).toContain("a.actor_profile_id");
    expect(replayAuthorizationMigration).toContain(
      "v_existing_actor_profile_id is distinct from p_actor_profile_id",
    );
    expect(replayAuthorizationMigration).toContain(
      "from public, anon, authenticated;",
    );
    expect(replayAuthorizationMigration).toContain("to service_role;");
  });

  it("resets the new-request outcome after a no-row idempotency lookup", () => {
    expect(migration).toMatch(
      /if v_order_id is not null then[\s\S]*?return;\r?\n\s+end if;\r?\n\r?\n\s+-- SELECT INTO clears targets[\s\S]*?v_customer_reused := false;/,
    );
  });

  it("returns false for a newly inserted customer", () => {
    const newCustomerPath = migration.match(
      /else\r?\n\s+v_customer_id := gen_random_uuid\(\);([\s\S]*?)exception when unique_violation/,
    )?.[1] ?? "";

    expect(newCustomerPath).toContain("insert into public.customers");
    expect(newCustomerPath).not.toContain("v_customer_reused := true");
    expect(migration).toContain("return query select v_order_id, v_customer_reused;");
  });

  it("preserves reuse and exact idempotency replay semantics", () => {
    expect(migration.match(/v_customer_reused := true;/g)).toHaveLength(3);
    expect(migration).toContain("v_existing_signature is distinct from v_payload_signature");
    expect(migration).toContain("raise exception 'IDEMPOTENCY_KEY_CONFLICT'");
    expect(migration).toMatch(
      /if v_order_id is not null then[\s\S]*?return query select v_order_id, v_customer_reused;[\s\S]*?return;/,
    );
  });

  it("normalizes only explicit historical ORDER_CREATED JSON nulls", () => {
    expect(migration).toContain("where event_type = 'ORDER_CREATED'");
    expect(migration).toContain("metadata_json ? 'customerReused'");
    expect(migration).toContain("metadata_json -> 'customerReused' = 'null'::jsonb");
    expect(migration).toContain("'false'::jsonb");
  });

  it("keeps document confirmation strict and reasserts the RPC grants", () => {
    expect(documentMigration).toMatch(
      /extraction_status = 'CONFIRMED'[\s\S]*?confirmation_customer_reused is not null/,
    );
    expect(migration).not.toContain("alter table public.document_imports");
    expect(migration).toContain(
      "from public, anon, authenticated;",
    );
    expect(migration).toContain("to service_role;");
  });
});
