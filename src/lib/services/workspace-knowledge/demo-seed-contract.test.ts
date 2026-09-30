import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(),
  "supabase/migrations/20260929160000_p3_demo_knowledge_seed.sql"), "utf8");
const resetMigration = readFileSync(resolve(process.cwd(),
  "supabase/migrations/20260929032756_p6_fictional_demo_seed.sql"), "utf8");
const evaluation = JSON.parse(readFileSync(resolve(process.cwd(),
  "scripts/fixtures/p3-demo-knowledge-evaluation.json"), "utf8")) as {
  sourceLabel: string;
  cases: { query: string; expectedTitle: string | null; expectedSnippet: string | null }[];
};

describe("fictional Demo knowledge seed contract", () => {
  it("keeps the fixture service-only, Demo-scoped, generation-bound and independently idempotent", () => {
    expect(migration).toContain("create function private.demo_seed_knowledge()");
    expect(migration).toContain("where w.kind = 'DEMO' and w.active for update");
    expect(migration).toContain("p.demo_principal and p.platform_role = 'USER'");
    expect(migration).toContain("if v_admin_count <> 1 then");
    expect(migration).toContain("if exists (select 1 from public.knowledge_documents d");
    expect(migration).toContain("where d.workspace_id = v_workspace_id) then return false;");
    expect(migration).toContain("revoke execute on function private.demo_seed_knowledge()");
    expect(migration).toContain("from public, anon, authenticated, service_role;");
    expect(migration).toContain("grant execute on function private.demo_seed_knowledge() to service_role;");
  });

  it("makes current empty KB and reset reseed without overwriting existing orders", () => {
    const kbCall = migration.indexOf("perform private.demo_seed_knowledge();");
    const orderGuard = migration.indexOf("if exists (select 1 from public.workspace_customers");
    expect(kbCall).toBeGreaterThan(0);
    expect(orderGuard).toBeGreaterThan(kbCall);
    expect(migration).toContain("select private.demo_seed_knowledge();");
    expect(resetMigration).toContain("delete from public.knowledge_versions where workspace_id = v_workspace_id;");
    expect(resetMigration).toContain("delete from public.knowledge_documents where workspace_id = v_workspace_id;");
    expect(resetMigration).toContain("perform private.demo_seed();");
  });

  it("persists page, chunk and publication pointers for two bounded fictional sources", () => {
    expect(migration).toContain("'TEXT', 'READY', 1, v_admin_profile_id");
    expect(migration).toContain("insert into public.knowledge_version_pages");
    expect(migration).toContain("insert into public.knowledge_chunks");
    expect(migration).toContain("set state = 'PUBLISHED', published_version_id = v_version_id");
    expect(migration).toContain("v_generation, v_item.source_text");
    expect(migration).toContain(evaluation.sourceLabel);
    const sourceTexts = [...migration.matchAll(/\('Fictional [^']+',\s*'([^']+)'\)/g)]
      .map((match) => match[1]);
    expect(sourceTexts).toHaveLength(2);
    expect(sourceTexts.every((source) => source.length > 0 && source.length <= 1_800 &&
      source === source.normalize("NFC"))).toBe(true);
    const positives = evaluation.cases.filter((item) => item.expectedTitle !== null);
    expect(new Set(positives.map((item) => item.expectedTitle)).size).toBe(2);
    for (const item of positives) {
      expect(item.query.length).toBeLessThanOrEqual(120);
      expect(migration).toContain(item.expectedTitle);
      expect(migration).toContain(item.expectedSnippet);
    }
    expect(migration).not.toContain("ZX-999");
  });
});
