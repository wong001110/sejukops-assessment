import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const layout = readFileSync(resolve("src/app/layout.tsx"), "utf8");
const styles = readFileSync(resolve("src/styles/ui-semantic-status.css"), "utf8");
const review = readFileSync(resolve("src/components/manager/review-workspace.tsx"), "utf8");
const aiSettings = readFileSync(resolve("src/components/admin/ai-settings/ai-settings-workspace.tsx"), "utf8");
const documents = readFileSync(resolve("src/components/admin/document-import/document-import-workspace.tsx"), "utf8");
const workflowFlags = readFileSync(resolve("src/components/manager/workflow-flags/flag-list.tsx"), "utf8");
const technician = readFileSync(resolve("src/components/technician/job-workspace.tsx"), "utf8");

describe("semantic status and alert audit", () => {
  it("loads the semantic override after the prior refinement layers", () => {
    expect(layout.indexOf('ui-refinements.css')).toBeLessThan(layout.indexOf('ui-semantic-status.css'));
  });

  it("covers lifecycle, review, workflow, AI and document status families", () => {
    expect(styles).toContain(".order-table-card .ant-tag-processing");
    expect(styles).toContain(".review-detail .ant-list .ant-tag-green");
    expect(styles).toContain(".workflow-flag-card .ant-tag-red");
    expect(styles).toContain(".ai-settings-page .ai-provider-card .ant-tag-success");
    expect(styles).toContain(".document-import-workspace .document-field-label .ant-tag-volcano");
    expect(styles).toContain(".ai-operations-page .ant-tag-green");
    expect(review).toContain("WhatsApp ready");
    expect(aiSettings).toContain("Capability mismatch");
    expect(documents).toContain("Confidence is guidance, not confirmation");
    expect(workflowFlags).toContain("Deterministic rule finding");
  });

  it("audits Ant Design and Technician mobile alert surfaces", () => {
    expect(styles).toContain(".ant-alert .ant-alert-description .ant-typography-secondary");
    expect(styles).toContain(".ant-alert-warning .ant-alert-description");
    expect(styles).toContain(".technician-shell .adm-notice-bar-info");
    expect(styles).toContain(".technician-shell .adm-notice-bar-alert");
    expect(technician).toContain('<NoticeBar color="info"');
    expect(technician).toContain('<NoticeBar color="alert"');
  });
});
