import { describe, expect, it } from "vitest";
import { operationsModeHref, operationsNavItems, summarizeVisibleOrders } from "./operations-nav-policy";

const base = "/workspaces/11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
describe("fixed Operations navigation", () => {
  it("offers saved assignment only to a permitted formal Admin", () => {
    const sections = (role: "ADMIN" | "MANAGER" | "TECHNICIAN", isGuest = false, readOnly = false, canAssign = true) => operationsNavItems({ base, role, isGuest, readOnly, canAssign }).map((item) => item.section);
    expect(sections("ADMIN")).toContain("assignment");
    expect(sections("ADMIN", true)).not.toContain("assignment");
    expect(sections("ADMIN", false, true)).not.toContain("assignment");
    expect(sections("ADMIN", false, false, false)).not.toContain("assignment");
    expect(sections("MANAGER")).not.toContain("assignment");
    expect(sections("TECHNICIAN")).not.toContain("assignment");
  });
  it("offers scheduling only to Manager and labels assigned reads as My jobs", () => {
    expect(operationsNavItems({ base, role: "MANAGER", canAssign: false, isGuest: false, readOnly: true }).some((item) => item.section === "schedule")).toBe(false);
    for (const role of ["ADMIN", "MANAGER", "TECHNICIAN"] as const) {
      const items = operationsNavItems({ base, role, canAssign: false, isGuest: true });
      expect(items.some((item) => item.section === "schedule")).toBe(role === "MANAGER");
      expect(items.find((item) => item.section === "orders")?.label).toBe(role === "TECHNICIAN" ? "My jobs" : "Orders");
      expect(items.some((item) => item.section === "knowledge")).toBe(true);
      expect(items.some((item) => item.section === "overview")).toBe(role === "MANAGER");
      if (role === "MANAGER") expect(items.find(item => item.section === "overview")?.label).toBe("Dashboard");
      expect(items.every((item) => !item.href.includes("?"))).toBe(true);
    }
  });
  it("carries a valid order only between contextual Operations and AI", () => {
    expect(operationsModeHref(base, "operations", undefined)).toBe(`${base}/overview`);
    expect(operationsModeHref(base, "operations", orderId)).toBe(`${base}/orders?orderId=${orderId}`);
    expect(operationsModeHref(base, "agent", orderId)).toBe(`${base}/agent?orderId=${orderId}`);
    expect(operationsModeHref(base, "operations", `${orderId}&workspaceId=other`)).toBe(`${base}/overview`);
    expect(operationsModeHref(base, "agent", "javascript:alert(1)")).toBe(`${base}/agent`);
  });
});
describe("visible recent order summary", () => {
  it("counts current visible statuses and excludes terminal/unknown rows from scheduling attention", () => {
    const order = (status: string, scheduled_at: string | null, assigned_technician_id: string | null = null) => ({ status, scheduled_at, assigned_technician_id });
    expect(summarizeVisibleOrders([
      order("NEW", null), order("ASSIGNED", "2026-10-05T08:00:00Z", orderId),
      order("IN_PROGRESS", "invalid", orderId), order("COMPLETED", null), order("CANCELLED", null), order("FUTURE_STATUS", null),
    ])).toEqual({ visible: 6, new: 1, assigned: 1, inProgress: 1, completed: 1, needsSchedule: 2, scheduledActive: 1, needsAssignment: 1 });
    expect(summarizeVisibleOrders([]).visible).toBe(0);
  });
});
