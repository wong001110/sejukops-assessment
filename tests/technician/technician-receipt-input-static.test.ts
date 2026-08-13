import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const completionForm = readFileSync(
  "src/components/technician/completion-form.tsx",
  "utf8",
);

describe("technician receipt input choices", () => {
  it("offers separate camera and existing-file receipt inputs", () => {
    expect(completionForm).toContain('id="receipt-camera"');
    expect(completionForm).toContain('capture="environment"');
    expect(completionForm).toContain('id="receipt-upload"');
    expect(completionForm).toContain("Take photo");
    expect(completionForm).toContain("Upload receipt");
  });

  it("keeps both receipt paths on the same image policy", () => {
    const policyUsage = completionForm.match(
      /accept=\{TECHNICIAN_RECEIPT_POLICY\.mimeTypes\.join\("[,]"\)\}/g,
    );
    expect(policyUsage).toHaveLength(2);
    expect(completionForm).toContain("selectReceipt(event.target.files)");
  });
});
