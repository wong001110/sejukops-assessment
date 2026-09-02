import { describe, expect, it } from "vitest";

import {
  aiOperationsRequestSchema,
  aiOperationsResponseSchema,
  getJobsArgumentsSchema,
  getTechnicianStatsArgumentsSchema,
  getWorkloadArgumentsSchema,
  operationalPeriodLabel,
  operationalPeriodSchema,
  operationalInsightRequestSchema,
  operationsPresentationSchema,
  operationsToolNameSchema,
} from "@/domain/ai-operations/contracts";

describe("AI Operations browser-safe contracts", () => {
  it("exposes only the four approved tools and bounded server-owned periods", () => {
    expect(operationsToolNameSchema.options).toEqual([
      "getJobs",
      "getTechnicianStats",
      "getOperationalSummary",
      "getWorkload",
    ]);
    expect(() =>
      getJobsArgumentsSchema.parse({
        period: "last_week",
        technicianNames: ["Ali"],
        completedOnly: true,
        limit: 999,
      }),
    ).toThrow();
    expect(
      getJobsArgumentsSchema.safeParse({
        period: "last_week",
        technicianNames: ["Ali", "Bala"],
        serviceTypes: ["Cleaning", "Repair"],
        completedOnly: true,
        limit: 25,
      }).success,
    ).toBe(true);
    expect(
      getWorkloadArgumentsSchema.safeParse({
        period: "this_week",
        technicianNames: ["Bala", "Ali"],
      }).success,
    ).toBe(true);
    expect(operationalPeriodSchema.safeParse("last_month").success).toBe(true);
    expect(operationalPeriodSchema.safeParse("month:2026-08").success).toBe(true);
    expect(operationalPeriodLabel("month:2026-08")).toBe("August 2026");
    expect(operationalPeriodSchema.safeParse("month:2026-13").success).toBe(false);
    expect(operationalPeriodSchema.safeParse("month:1999-12").success).toBe(false);
    expect(operationalPeriodSchema.safeParse("2026-08").success).toBe(false);
    expect(
      getTechnicianStatsArgumentsSchema.safeParse({
        period: "this_week",
        technicianNames: Array.from({ length: 11 }, (_, index) => `Tech ${index}`),
      }).success,
    ).toBe(false);
    expect(
      getJobsArgumentsSchema.safeParse({
        startDate: "2026-08-01",
        endDate: "2026-08-08",
      }).success,
    ).toBe(false);
    expect(
      getTechnicianStatsArgumentsSchema.safeParse({
        period: "month:2026-08",
      }).success,
    ).toBe(true);
  });

  it("supports multiple direct order lookups without requiring a period", () => {
    expect(
      getJobsArgumentsSchema.parse({
        orderNumbers: ["ord-2026-0038", "ORD-2026-0037"],
        completedOnly: false,
        limit: 2,
      }).orderNumbers,
    ).toEqual(["ORD-2026-0038", "ORD-2026-0037"]);
    expect(
      getJobsArgumentsSchema.safeParse({
        orderNumbers: [],
        completedOnly: false,
      }).success,
    ).toBe(false);
  });

  it("bounds question/context and supports explicit clarification responses", () => {
    expect(
      aiOperationsRequestSchema.parse({
        question: "What about Bala and Ali?",
        context: {
          intent: "TECHNICIAN_PERFORMANCE",
          period: "this_week",
          technicianNames: ["Ali", "Bala"],
        },
      }).context,
    ).toMatchObject({
      period: "this_week",
      technicianNames: ["Ali", "Bala"],
    });
    expect(
      aiOperationsResponseSchema.safeParse({
        outcome: "CLARIFICATION",
        answer: "Please specify a period.",
        context: null,
        toolCalls: [],
        facts: [],
        presentation: null,
        metadata: {
          grounded: true,
          timezone: "Asia/Kuala_Lumpur",
          generatedAt: "2026-08-11T00:00:00.000Z",
        },
      }).success,
    ).toBe(true);
  });

  it("accepts only bounded deterministic presentation shapes", () => {
    expect(
      operationsPresentationSchema.safeParse({
        kind: "JOBS",
        rows: [
          {
            orderNumber: "ORD-2026-0012",
            status: "CLOSED",
            technicianName: "Ali",
            serviceType: "Cleaning",
            scheduledAt: "2026-08-03T01:00:00.000Z",
            completedAt: "2026-08-03T03:30:00.000Z",
            finalAmount: 180,
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      operationsPresentationSchema.safeParse({
        kind: "JOBS",
        rows: [
          {
            orderNumber: "not-an-order",
            status: "CLOSED",
            technicianName: "Ali",
            serviceType: "Cleaning",
            scheduledAt: null,
            completedAt: null,
            finalAmount: 180,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("accepts insight identity only as fixed dashboard period plus metrics version", () => {
    expect(
      operationalInsightRequestSchema.safeParse({
        period: "this_week",
        metricsVersion: `this_week:${"a".repeat(32)}`,
      }).success,
    ).toBe(true);
    expect(
      operationalInsightRequestSchema.safeParse({
        period: "last_week",
        metricsVersion: `last_week:${"a".repeat(32)}`,
      }).success,
    ).toBe(false);
  });
});
