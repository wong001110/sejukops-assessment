import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { operationsFactSchema } from "@/domain/ai-operations/contracts";
import type { ManagerDashboardResponse } from "@/domain/manager-dashboard/contracts";
import { buildDashboardInsightFacts } from "@/lib/services/ai-operations/operational-insight";

describe("Operational Insight deterministic facts", () => {
  it("normalizes dashboard comparison keys into the grounded fact contract", () => {
    const dashboard = {
      period: "this_week",
      timezone: "Asia/Kuala_Lumpur",
      range: {
        currentStart: "2026-08-09T16:00:00.000Z",
        currentEnd: "2026-08-16T16:00:00.000Z",
        comparisonStart: "2026-08-02T16:00:00.000Z",
        comparisonEnd: "2026-08-09T16:00:00.000Z",
        comparisonLabel: "Last Week",
      },
      summary: {
        completedJobs: 14,
        totalAmount: 3455,
        rescheduled: 4,
        averageJobValue: 246.79,
      },
      comparison: {
        completedJobs: { current: 14, previous: 10, percentChange: 40 },
        totalAmount: { current: 3455, previous: 2905, percentChange: 18.93 },
        rescheduled: { current: 4, previous: 0, percentChange: null },
        averageJobValue: {
          current: 246.79,
          previous: 290.5,
          percentChange: -15.05,
        },
      },
      trend: [],
      technicians: [],
      serviceTypes: [],
      metricsVersion: `this_week:${"a".repeat(32)}`,
    } as ManagerDashboardResponse;

    const facts = buildDashboardInsightFacts(dashboard);
    expect(facts.every((fact) => operationsFactSchema.safeParse(fact).success))
      .toBe(true);
    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "comparison.completed_jobs.current",
          value: 14,
        }),
        expect.objectContaining({
          key: "comparison.average_job_value.percent_change",
          value: -15.05,
        }),
      ]),
    );
  });
});
