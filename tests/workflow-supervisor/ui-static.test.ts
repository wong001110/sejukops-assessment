import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

import { describe, expect, it } from "vitest";

const list = readFileSync(fileURLToPath(new URL(
  "../../src/components/manager/workflow-flags/flag-list.tsx",
  import.meta.url,
)), "utf8");
const api = readFileSync(fileURLToPath(new URL(
  "../../src/components/manager/workflow-flags/api.ts",
  import.meta.url,
)), "utf8");
const review = readFileSync(fileURLToPath(new URL(
  "../../src/components/manager/review-workspace.tsx",
  import.meta.url,
)), "utf8");

describe("Workflow Supervisor Manager UI", () => {
  it("keeps deterministic findings primary and integrates them in review detail", () => {
    expect(review).toContain("<WorkflowFlagList flags={review.flags}");
    expect(list).toContain("Deterministic rule finding");
    expect(list).toContain("flag.deterministicSummary");
    expect(list).toContain("flag.details");
    expect(list.indexOf("Deterministic rule finding")).toBeLessThan(
      list.indexOf("<ExplanationPanel"),
    );
  });

  it("presents severity and rule status without relying on color alone", () => {
    expect(list).toContain('flag.severity === "CRITICAL"');
    expect(list).toContain("{flag.severity}");
    expect(list).toContain("{flag.status}");
    expect(list).toContain("flag.title");
    expect(list).toContain("flag.ruleCode.replaceAll");
    expect(list).toContain('/ratio$/i.test(key)');
    expect(list).toContain("`RM ${value.toFixed(2)}`");
  });

  it("requests only the optional explanation with a stable idempotency key", () => {
    expect(api).toContain("/api/manager/workflow-flags/${flagId}/explanation");
    expect(api).toContain('method: "POST"');
    expect(list).toContain("requestKey.current ??= crypto.randomUUID()");
    expect(list).toContain("Explain this flag");
    expect(list).not.toContain("APPROVE");
    expect(list).not.toContain("REQUEST_CLARIFICATION");
  });

  it("keeps flags usable when explanation is unavailable and retries independently", () => {
    expect(list).toContain('explanation.status === "UNAVAILABLE"');
    expect(list).toContain("AI explanation unavailable");
    expect(list).toContain("The rule facts remain the source of truth");
    expect(list).toContain("void request()");
    expect(list).not.toContain("request(true)");
    expect(list).toContain("requestKey.current = undefined");
    expect(list).toContain("AI_NOT_CONFIGURED");
    expect(list).toContain("AI_CAPABILITY_MISMATCH");
  });

  it("preserves an idempotency key across ambiguous network or 409 errors", () => {
    const catchBlock = list.slice(list.indexOf("} catch (cause)"), list.indexOf("} finally"));
    expect(catchBlock).toContain("setRequestError");
    expect(catchBlock).not.toContain("requestKey.current = undefined");
    expect(list).toContain("requestKey.current ??= crypto.randomUUID()");
  });

  it("labels available explanation as optional decision support", () => {
    expect(list).toContain('explanation.status === "AVAILABLE"');
    expect(list).toContain("Optional AI explanation");
    expect(list).toContain("Suggested review action");
    expect(list).toContain("Decision support only");
    expect(list).toContain("Manager remains responsible");
  });
});
