import { describe, expect, it } from "vitest";

import {
  aiOperationsRequestSchema,
  aiOperationsResponseSchema,
  getJobsArgumentsSchema,
  getWorkloadArgumentsSchema,
  operationalInsightRequestSchema,
  operationsToolNameSchema,
} from "@/domain/ai-operations/contracts";

describe("AI Operations browser-safe contracts", () => {
  it("exposes only the four approved tools and symbolic server-owned periods", () => {
    expect(operationsToolNameSchema.options).toEqual([
      "getJobs",
      "getTechnicianStats",
      "getOperationalSummary",
      "getWorkload",
    ]);
    expect(() =>
      getJobsArgumentsSchema.parse({
        period: "last_week",
        technicianName: "Ali",
        completedOnly: true,
        limit: 999,
      }),
    ).toThrow();
    expect(
      getJobsArgumentsSchema.safeParse({
        period: "last_week",
        technicianName: "Ali",
        completedOnly: true,
        limit: 25,
      }).success,
    ).toBe(true);
    expect(
      getWorkloadArgumentsSchema.safeParse({
        period: "this_week",
        technicianName: "Bala",
      }).success,
    ).toBe(true);
    expect(
      getJobsArgumentsSchema.safeParse({
        startDate: "2026-08-01",
        endDate: "2026-08-08",
      }).success,
    ).toBe(false);
  });

  it("bounds question/context and supports explicit clarification responses", () => {
    expect(
      aiOperationsRequestSchema.parse({
        question: "What about Bala?",
        context: {
          intent: "TECHNICIAN_PERFORMANCE",
          period: "this_week",
          technicianName: "Ali",
        },
      }).context,
    ).toMatchObject({ period: "this_week", technicianName: "Ali" });
    expect(
      aiOperationsResponseSchema.safeParse({
        outcome: "CLARIFICATION",
        answer: "Please specify a period.",
        context: null,
        toolCalls: [],
        facts: [],
        metadata: {
          grounded: true,
          timezone: "Asia/Kuala_Lumpur",
          generatedAt: "2026-08-11T00:00:00.000Z",
        },
      }).success,
    ).toBe(true);
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
