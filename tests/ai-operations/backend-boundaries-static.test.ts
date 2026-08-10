import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

import { describe, expect, it } from "vitest";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const migration = read(
  "../../supabase/migrations/202608100011_ai_operations.sql",
);
const tools = read("../../src/lib/services/ai-operations/tools.ts");
const orchestrator = read(
  "../../src/lib/ai/runtime/operations-orchestrator.ts",
);
const insight = read(
  "../../src/lib/services/ai-operations/operational-insight.ts",
);

describe("AI Operations backend security and truth boundaries", () => {
  it("requires an active DB Manager in every approved data RPC", () => {
    expect(migration.match(/p\.role = 'MANAGER' and p\.active/g)).toHaveLength(4);
    expect(migration).toContain("security definer");
    expect(migration).toContain("grant execute on function public.manager_ai_get_jobs");
    expect(migration).not.toContain("execute immediate");
    expect(tools).toContain('createAuthorizedDataContext("ai:use")');
    expect(tools).toContain('context.identity.role !== "MANAGER"');
    expect(tools).toContain("INVALID_AI_RUNTIME_ACTOR");
  });

  it("clamps every result limit and exposes no generic table/query tool", () => {
    expect(migration.match(/least\(greatest\(coalesce\(p_limit, 20\), 1\), 25\)/g)).toHaveLength(3);
    expect(migration.match(/limit v_limit/g)).toHaveLength(3);
    expect(tools).not.toContain("rawSql");
    expect(tools).not.toContain("queryText");
    expect(orchestrator).toContain("toolRounds: 0 | 1");
    expect(orchestrator).not.toContain("MAX_TOOL_ROUNDS = 2");
  });

  it("uses current lifecycle truth and excludes clarified IN_PROGRESS reports", () => {
    expect(
      (migration.match(/o\.status in \('JOB_DONE', 'REVIEWED', 'CLOSED'\)/g) ?? [])
        .length,
    ).toBeGreaterThanOrEqual(5);
    expect(migration).toContain("when o.status in ('JOB_DONE', 'REVIEWED', 'CLOSED')");
    expect(migration).toContain("else coalesce(o.scheduled_at, o.created_at)");
    expect(migration).toContain("and o.status in ('JOB_DONE', 'REVIEWED', 'CLOSED')");
  });

  it("keeps conversation request-scoped and caches insight only by metric identity", () => {
    expect(migration).toContain("primary key (period, metrics_version)");
    expect(migration).not.toMatch(
      /create table public\.(?:ai_)?conversation/i,
    );
    expect(insight).toContain('.eq("period", request.period)');
    expect(insight).toContain('.eq("metrics_version", request.metricsVersion)');
    expect(insight).toContain("const winner = await readCache");
    expect(insight).toContain("matchAll");
  });
});
