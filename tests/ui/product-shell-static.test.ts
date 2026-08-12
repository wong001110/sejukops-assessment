import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const layout = readFileSync(resolve("src/app/layout.tsx"), "utf8");
const provider = readFileSync(resolve("src/components/app-query-provider.tsx"), "utf8");
const desktopShell = readFileSync(resolve("src/components/desktop-shell.tsx"), "utf8");
const technicianShell = readFileSync(resolve("src/components/technician-shell.tsx"), "utf8");
const insight = readFileSync(resolve("src/components/manager/ai-operations/operational-insight.tsx"), "utf8");
const polish = readFileSync(resolve("src/styles/ui-polish.css"), "utf8");

describe("SejukOps product shell polish", () => {
  it("loads the product polish layer without the React 19 compatibility runtime patch", () => {
    expect(layout).toContain('import "@/styles/ui-polish.css"');
    expect(layout).not.toContain("@ant-design/v5-patch-for-react-19");
    expect(provider).toContain("<ConfigProvider theme={sejukTheme}>");
    expect(provider).toContain('colorPrimary: "#176b87"');
  });

  it("groups desktop navigation into product-level operational sections", () => {
    expect(desktopShell).toContain('type: "group", label: "Operations"');
    expect(desktopShell).toContain('type: "group", label: "Intelligence"');
    expect(desktopShell).toContain('type: "group", label: "System"');
    expect(desktopShell).toContain("Assessment workspace");
    expect(desktopShell).toContain("Field Service OS");
  });

  it("gives the technician portal a dedicated field-work identity", () => {
    expect(technicianShell).toContain("SejukOps Field");
    expect(technicianShell).toContain("Technician workspace");
    expect(technicianShell).toContain("Demo identity");
    expect(polish).toContain(".technician-mobile-brand");
    expect(polish).toContain(".tech-job-in_progress");
  });

  it("keeps AI dashboard support discoverable without eager provider execution", () => {
    expect(insight).toContain('className="dashboard-ai-teaser"');
    expect(insight).toContain("Explain this operational snapshot");
    expect(insight).toContain("enabled: open");
    expect(polish).toContain(".dashboard-ai-teaser");
  });
});
