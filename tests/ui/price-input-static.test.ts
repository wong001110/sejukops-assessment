import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const shared = readFileSync("src/components/shared/price-input.tsx", "utf8");
const adminOrders = readFileSync("src/components/admin/order-workspace.tsx", "utf8");
const documentImport = readFileSync("src/components/admin/document-import/document-import-workspace.tsx", "utf8");
const technicianCompletion = readFileSync("src/components/technician/completion-form.tsx", "utf8");
const sizing = readFileSync("src/styles/ui-form-sizing.css", "utf8");

describe("shared price input", () => {
  it("owns the common money semantics and 1.3x desktop width token", () => {
    expect(shared).toContain('prefix="RM"');
    expect(shared).toContain('precision={2}');
    expect(shared).toContain('step="0.01"');
    expect(sizing).toContain("--price-input-width: 117px");
  });

  it("is used by every editable operational price field", () => {
    expect(adminOrders).toContain("<PriceInput />");
    expect(documentImport).toContain("<PriceInput />");
    expect(technicianCompletion.match(/<PriceInput mode="native" fluid/g)?.length).toBe(2);
    expect(adminOrders).not.toContain("<InputNumber");
    expect(documentImport).not.toContain("<InputNumber");
  });

  it("keeps mobile technician amount fields fluid", () => {
    expect(shared).toContain('fluid ? "price-input-fluid"');
    expect(sizing).toContain(".price-input-fluid");
    expect(sizing).toContain("width: 100% !important");
  });
});
