import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const component = readFileSync(
  resolve("src/components/shared/status-tag.tsx"),
  "utf8",
);
const styles = readFileSync(
  resolve("src/styles/ui-status-tag.css"),
  "utf8",
);
const diagnostics = readFileSync(
  resolve("src/components/diagnostics/ai-observability-workspace.tsx"),
  "utf8",
);

describe("shared semantic status tag", () => {
  it("normalizes label formatting and semantic tones", () => {
    expect(component).toContain("formatStatusLabel");
    expect(component).toContain('CONTROLLED: "info"');
    expect(component).toContain('SUCCEEDED: "success"');
    expect(component).toContain('FAILED: "danger"');
  });

  it("keeps badge geometry stable across surfaces", () => {
    expect(styles).toContain("min-height: 24px");
    expect(styles).toContain("padding: 2px 9px");
    expect(styles).toContain("line-height: 18px");
    expect(styles).toContain("align-items: center");
  });

  it("uses the shared status tag in AI observability", () => {
    expect(diagnostics).toContain('from "@/components/shared/status-tag"');
    expect(diagnostics).toContain("<StatusTag status={value} />");
    expect(diagnostics).toContain('"SUCCEEDED", "CONTROLLED", "FAILED"');
  });
});
