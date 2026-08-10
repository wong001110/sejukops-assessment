import { describe, expect, it } from "vitest";

import {
  MANAGER_DASHBOARD_TIMEZONE,
  managerDashboardPeriodSchema,
  managerDashboardResponseSchema,
} from "@/domain/manager-dashboard/contracts";
import { MANAGER_DASHBOARD_GOLDEN } from "@/domain/manager-dashboard/golden";

const technicianIds = {
  Ali: "00000000-0000-4000-8000-000000002003",
  John: "00000000-0000-4000-8000-000000002004",
  Bala: "00000000-0000-4000-8000-000000002005",
  Yusoff: "00000000-0000-4000-8000-000000002006",
} as const;

describe("Manager dashboard contract", () => {
  it("accepts exactly the three fixed periods", () => {
    expect(managerDashboardPeriodSchema.options).toEqual([
      "today",
      "this_week",
      "this_month",
    ]);
    expect(managerDashboardPeriodSchema.safeParse("custom").success).toBe(false);
  });

  it.each(["today", "this_week", "this_month"] as const)(
    "validates the %s golden dashboard shape",
    (period) => {
      const golden = MANAGER_DASHBOARD_GOLDEN[period];
      const labels = period === "today"
        ? Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`)
        : period === "this_week"
          ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
          : ["Week 1", "Week 2", "Week 3", "Week 4", "Week 5"];
      const totalJobs = golden.summary.completedJobs;
      const response = {
        period,
        timezone: MANAGER_DASHBOARD_TIMEZONE,
        range: {
          currentStart: "2026-08-01T00:00:00.000+08:00",
          currentEnd: "2026-09-01T00:00:00.000+08:00",
          comparisonStart: "2026-07-01T00:00:00.000+08:00",
          comparisonEnd: "2026-08-01T00:00:00.000+08:00",
          comparisonLabel: "Previous period",
        },
        summary: golden.summary,
        comparison: Object.fromEntries(
          Object.keys(golden.summary).map((key) => [key, {
            current: golden.summary[key as keyof typeof golden.summary],
            previous: golden.previous[key as keyof typeof golden.previous],
            percentChange: null,
          }]),
        ),
        trend: labels.map((label, index) => ({
          label,
          jobs: golden.trendJobs[index],
          amount: golden.trendAmounts[index],
        })),
        technicians: golden.technicians.map((row, index) => ({
          rank: index + 1,
          technicianId: technicianIds[row.name],
          ...row,
          averageJobValue: Number((row.amount / row.jobs).toFixed(2)),
        })),
        serviceTypes: golden.serviceTypes.map((row) => ({
          ...row,
          sharePercent: Number(((row.count / totalJobs) * 100).toFixed(2)),
        })),
        metricsVersion: `${period}:0123456789abcdef0123456789abcdef`,
      };

      expect(managerDashboardResponseSchema.parse(response).summary).toEqual(
        golden.summary,
      );
      expect(response.trend.map((bucket) => bucket.jobs)).toEqual(
        golden.trendJobs,
      );
    },
  );

  it("allows a null percent only as an explicit zero-baseline result", () => {
    const comparisonMetric = managerDashboardResponseSchema.shape.comparison.shape.rescheduled;
    expect(comparisonMetric.parse({ current: 4, previous: 0, percentChange: null }))
      .toEqual({ current: 4, previous: 0, percentChange: null });
  });
});

