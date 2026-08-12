import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const insight = readFileSync(
  resolve("src/components/manager/ai-operations/operational-insight.tsx"),
  "utf8",
);
const insightStyles = readFileSync(
  resolve("src/styles/ui-operational-insight.css"),
  "utf8",
);
const dashboard = readFileSync(
  resolve("src/components/manager/dashboard-workspace.tsx"),
  "utf8",
);
const chartStyles = readFileSync(
  resolve("src/styles/ui-dashboard-chart.css"),
  "utf8",
);
const diagnostics = readFileSync(
  resolve("src/components/diagnostics/ai-observability-workspace.tsx"),
  "utf8",
);
const statusStyles = readFileSync(
  resolve("src/styles/ui-status-tag.css"),
  "utf8",
);
const layout = readFileSync(resolve("src/app/layout.tsx"), "utf8");

describe("dev preview feedback refinements", () => {
  it("uses green for upward movement and red for downward movement in AI insight", () => {
    expect(insight).toContain('return percentChange > 0 ? "positive" : "negative"');
    expect(insight).toContain("operational-insight-metric-${tone}");
    expect(insightStyles).toContain(".operational-insight-delta-positive");
    expect(insightStyles).toContain("background: #eaf7ef");
    expect(insightStyles).toContain(".operational-insight-delta-negative");
    expect(insightStyles).toContain("background: #fff0ee");
  });

  it("fits the completion trend into the card without nested scrollbars", () => {
    expect(dashboard).toContain("dashboard.trend.length > 12");
    expect(dashboard).toContain("gridTemplateColumns");
    expect(chartStyles).toContain("overflow: hidden !important");
    expect(chartStyles).toContain("min-width: 0 !important");
    expect(chartStyles).toContain("nth-child(3n + 1)");
    expect(layout).toContain('import "@/styles/ui-dashboard-chart.css"');
  });

  it("shows provider token input, output and totals in AI observability", () => {
    expect(diagnostics).toContain('title: "Input"');
    expect(diagnostics).toContain('title: "Output"');
    expect(diagnostics).toContain('title: "Total"');
    expect(diagnostics).toContain("promptTokens");
    expect(diagnostics).toContain("completionTokens");
    expect(diagnostics).toContain("Input tokens");
    expect(diagnostics).toContain("Output tokens");
  });

  it("normalizes AI configuration tags through the shared tag stylesheet", () => {
    expect(statusStyles).toContain(".ai-settings-page .ant-tag");
    expect(statusStyles).toContain(".ai-settings-page .ant-tag-success");
    expect(statusStyles).toContain("border-radius: 999px !important");
    expect(layout.lastIndexOf('ui-status-tag.css')).toBeGreaterThan(
      layout.lastIndexOf('ui-modern-refresh-tuning.css'),
    );
  });
});
