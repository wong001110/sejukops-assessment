import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve("supabase/migrations/202608130002_receipt_supporting_document.sql"), "utf8");

describe("receipt supporting document migration", () => {
  it("allows standalone attached documents", () => {
    expect(migration).toContain("drop constraint if exists attached_receipt_has_payment");
    expect(migration).toContain("status = 'ATTACHED' or payment_id is null");
    expect(migration).not.toContain("RECEIPT_REQUIRES_PAYMENT");
  });

  it("auto-selects a confirmed receipt when payment is omitted", () => {
    expect(migration).toContain("v_selected_receipt_id uuid := p_receipt_upload_id");
    expect(migration).toContain("if v_selected_receipt_id is null then");
    expect(migration).toContain("and r.status = 'UPLOADED'");
  });
});
