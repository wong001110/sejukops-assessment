import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const layout = readFileSync(resolve("src/app/layout.tsx"), "utf8");
const shell = readFileSync(resolve("src/components/desktop-shell.tsx"), "utf8");
const modern = readFileSync(resolve("src/styles/ui-modern-refresh.css"), "utf8");
const tuning = readFileSync(resolve("src/styles/ui-modern-refresh-tuning.css"), "utf8");

describe("SejukOps modern visual refresh", () => {
  it("loads the modern layer after the existing semantic status layer", () => {
    expect(layout).toContain('import "@/styles/ui-semantic-status.css"');
    expect(layout).toContain('import "@/styles/ui-modern-refresh.css"');
    expect(layout).toContain('import "@/styles/ui-modern-refresh-tuning.css"');
    expect(layout.indexOf("ui-modern-refresh.css")).toBeGreaterThan(layout.indexOf("ui-semantic-status.css"));
  });

  it("uses a quieter bounded desktop shell and flat page hierarchy", () => {
    expect(shell).toContain('width={228}');
    expect(shell).toContain("modern-desktop-shell");
    expect(modern).toContain("--modern-sidebar: #071e31");
    expect(modern).toContain(".page-heading::before");
    expect(modern).toContain("border-bottom: 1px solid var(--modern-border)");
    expect(modern).toContain("box-shadow: none");
  });

  it("presents KPI data as a unified data surface and keeps selected order status obvious", () => {
    expect(modern).toContain(".dashboard-stat-grid");
    expect(modern).toContain("gap: 0 !important");
    expect(modern).toContain(".dashboard-stat-card:last-child");
    expect(tuning).toContain(".order-toolbar .ant-segmented-item-selected");
    expect(tuning).toContain("background: #dff0f4 !important");
  });

  it("keeps the Technician portal field-focused with a high-contrast primary workflow action", () => {
    expect(modern).toContain(".technician-shell .adm-nav-bar");
    expect(modern).toContain("background: #0c6b7b");
    expect(modern).toContain(".tech-job-in_progress");
    expect(modern).toContain(".technician-tabs");
    expect(tuning).toContain(".tech-sticky-action .adm-button-primary");
    expect(tuning).toContain("background: #0b6b7c !important");
    expect(tuning).toContain("color: #ffffff !important");
  });
});
