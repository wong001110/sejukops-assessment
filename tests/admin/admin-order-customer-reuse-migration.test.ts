import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("supabase/migrations/202608100014_admin_order_customer_reuse.sql"),
  "utf8",
);
const documentMigration = readFileSync(
  resolve("supabase/migrations/202608100013_document_understanding.sql"),
  "utf8",
);

describe("Admin order customer reuse repair migration", () => {
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
