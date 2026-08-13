import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/202608130001_ai_operations_multi_filters.sql",
  "utf8",
);
const tools = readFileSync("src/lib/services/ai-operations/tools.ts", "utf8");
const planner = readFileSync("src/lib/ai/runtime/operations-planner.ts", "utf8");

describe("AI Operations bounded multi-value filters", () => {
  it("keeps the same small tool surface while accepting bounded arrays", () => {
    expect(planner).toContain("You may select exactly one approved tool");
    expect(planner).toContain("Multiple values inside one filter mean OR");
    expect(planner).toContain("different filters combine with AND");
    expect(planner).toContain('"ORD-2026-0038","ORD-2026-0037"');
    expect(tools).toContain("p_order_numbers: args.orderNumbers ?? null");
    expect(tools).toContain("p_technician_names: args.technicianNames ?? null");
    expect(tools).toContain("p_statuses: args.statuses ?? null");
    expect(tools).toContain("p_service_types: args.serviceTypes ?? null");
  });

  it("bounds arrays independently at the database boundary", () => {
    expect(migration.match(/cardinality\(p_technician_names\) not between 1 and 10/g)).toHaveLength(3);
    expect(migration).toContain("cardinality(p_order_numbers) not between 1 and 10");
    expect(migration).toContain("cardinality(p_statuses) not between 1 and 10");
    expect(migration).toContain("cardinality(p_service_types) not between 1 and 10");
    expect(migration.match(/limit v_limit/g)).toHaveLength(3);
  });

  it("implements OR within each filter without enabling generic SQL", () => {
    expect(migration).toContain("unnest(p_order_numbers)");
    expect(migration).toContain("unnest(p_technician_names)");
    expect(migration).toContain("o.status::text = any(p_statuses)");
    expect(migration).toContain("unnest(p_service_types)");
    expect(migration).not.toContain("execute immediate");
    expect(migration).not.toContain("rawSql");
  });
});
