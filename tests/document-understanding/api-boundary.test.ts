import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Admin document import API boundary", () => {
  it.each([
    ["reservations/route.ts", "reserveDocumentImportSchema"],
    ["[id]/source/confirm/route.ts", "confirmDocumentSourceSchema"],
    ["[id]/extract/route.ts", "extractDocumentImportSchema"],
    ["[id]/confirm/route.ts", "confirmDocumentImportSchema"],
  ])("parses the %s request body with its shared schema", (suffix, schema) => {
    const source = read(`src/app/api/admin/document-imports/${suffix}`);
    expect(source).toContain(`${schema}.parse(await request.json())`);
  });

  it.each([
    "[id]/route.ts",
    "[id]/source/confirm/route.ts",
    "[id]/extract/route.ts",
    "[id]/confirm/route.ts",
  ])("validates the route UUID in %s", (suffix) => {
    expect(read(`src/app/api/admin/document-imports/${suffix}`))
      .toContain("z.string().uuid().parse(candidate)");
  });

  it("returns safe stable errors without serializing raw causes", () => {
    const response = read("src/app/api/admin/document-imports/_shared/responses.ts");
    expect(response).toContain("{ error: { code: error.code, message: error.message } }");
    expect(response).not.toContain("error.cause");
    expect(response).not.toContain("error.stack");
  });

  it("requires a saved selected profile and has no environment fallback branch", () => {
    const service = read("src/lib/services/document-understanding/service.ts");
    expect(service).toContain("if (!provider.providerConfigId)");
    expect(service).toContain('"AI_NOT_CONFIGURED"');
    expect(service).not.toContain("getOpenRouterEnvironmentFallback");
  });

  it("hydrates a browser-safe canonical confirmation summary for lost responses", () => {
    const service = read("src/lib/services/document-understanding/service.ts");
    expect(service).toContain("confirmation_customer_reused");
    expect(service).toContain("confirmed_order:orders!document_imports_confirmed_order_id_fkey(id,order_no,status)");
    expect(service).toContain("customerReused: Boolean(row.confirmation_customer_reused)");
  });
});
