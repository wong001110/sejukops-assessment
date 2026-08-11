import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const workspace = readFileSync(resolve("src/components/manager/review-workspace.tsx"), "utf8");
const api = readFileSync(resolve("src/components/manager/review-api.ts"), "utf8");
const styles = readFileSync(resolve("src/styles/globals.css"), "utf8");

describe("Manager review UI contract", () => {
  it("uses the shared Manager domain contract and provides complete review states", () => {
    expect(api).toContain('from "@/domain/manager-review/contracts"');
    expect(api).toContain("/api/manager/reviews");
    expect(workspace).toContain("Review queue is unavailable");
    expect(workspace).toContain("No completed jobs need review");
    expect(workspace).toContain("<Skeleton active");
    expect(workspace).toContain("View signed file");
    expect(workspace).toContain("View signed receipt");
  });

  it("keeps review and schedule mutation request keys stable through retry", () => {
    expect(workspace).toContain("decisionKeys.current.get(id) ?? requestKey()");
    expect(workspace).toContain("rescheduleKeys.current.get(reschedule.id) ?? requestKey()");
    expect(workspace).toContain("resolveKeys.current.get(request.id) ?? requestKey()");
    expect(workspace).toContain("decisionKeys.current.delete(id)");
    expect(workspace).toContain("rescheduleKeys.current.delete(reschedule.id)");
    expect(workspace).toContain("resolveKeys.current.delete(request.id)");
  });

  it("applies queue search only when submitted instead of refetching on each keystroke", () => {
    expect(workspace).toContain("const applyFilters = (next: ManagerReviewListQuery)");
    expect(workspace).toContain("onSearch={() => applyFilters({ ...filters, search: search.trim() || undefined })}");
    expect(workspace).toContain("useEffect(() => { void load({}); }, [load]);");
    expect(workspace).not.toContain("}, [branchId, search]);");
  });

  it("requires a clarification note and opens WhatsApp via a user-initiated form POST", () => {
    expect(workspace).toContain('decision.decision === "REQUEST_CLARIFICATION" && !decisionNote.trim()');
    expect(workspace).toContain('method="post"');
    expect(workspace).toContain('target="_blank"');
    expect(workspace).toContain('/whatsapp/open');
    expect(workspace).toContain('detail.notification ? "Open WhatsApp again" : "Prepare & open WhatsApp"');
    expect(workspace).toContain('status === "OPENED" ? "WhatsApp opened" : "WhatsApp ready"');
  });

  it("keys office WhatsApp retries to the notification revision instead of a stale order revision", () => {
    expect(workspace).toContain("const scope = review.notification?.id ?? review.id");
    expect(workspace).toContain("whatsappKeys.current.get(scope)");
    expect(workspace).toContain("whatsappKeys.current.delete(detail.notification?.id ?? detail.id)");
  });

  it("sorts reviews and audit events into one chronological timeline", () => {
    expect(workspace).toContain("const timelineItems = [");
    expect(workspace).toContain("Date.parse(right.createdAt) - Date.parse(left.createdAt)");
    expect(workspace).toContain("<Timeline items={timelineItems}");
  });

  it("keeps the application frame fixed and lays the review filters out in the card body", () => {
    expect(styles).toContain(".desktop-shell { height: 100dvh; min-height: 0; overflow: hidden;");
    expect(styles).toContain(".desktop-content { min-height: 0; padding: 32px; overflow-y: auto;");
    expect(styles).toContain(".review-toolbar .ant-card-body { display: grid;");
  });
});
