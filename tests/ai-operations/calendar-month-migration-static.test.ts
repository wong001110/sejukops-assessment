import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260902093210_ai_operations_calendar_month.sql",
  "utf8",
);

describe("AI Operations calendar-month database boundary", () => {
  it("adds one shared Malaysia-time range resolver instead of a new query surface", () => {
    expect(migration).toContain("create or replace function public.manager_ai_period_bounds");
    expect(migration).toContain("'Asia/Kuala_Lumpur'");
    expect(migration).toContain("when 'last_month'");
    expect(migration).toContain("'^month:(20[0-9]{2}|21[0-9]{2})-(0[1-9]|1[0-2])$'");
    expect(migration).toContain("pg_catalog.make_date");
    expect(migration).not.toContain("execute immediate");
    expect(migration).not.toContain("security definer");
  });
});
