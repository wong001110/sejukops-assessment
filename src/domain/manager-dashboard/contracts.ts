import { z } from "zod";

export const MANAGER_DASHBOARD_TIMEZONE = "Asia/Kuala_Lumpur" as const;

export const managerDashboardPeriodSchema = z.enum([
  "today",
  "this_week",
  "this_month",
]);

export type ManagerDashboardPeriod = z.infer<
  typeof managerDashboardPeriodSchema
>;

const nonNegativeNumberSchema = z.number().finite().nonnegative();

const comparisonMetricSchema = z.object({
  current: nonNegativeNumberSchema,
  previous: nonNegativeNumberSchema,
  percentChange: z.number().finite().nullable(),
});

export const managerDashboardResponseSchema = z.object({
  period: managerDashboardPeriodSchema,
  timezone: z.literal(MANAGER_DASHBOARD_TIMEZONE),
  range: z.object({
    currentStart: z.string().datetime({ offset: true }),
    currentEnd: z.string().datetime({ offset: true }),
    comparisonStart: z.string().datetime({ offset: true }),
    comparisonEnd: z.string().datetime({ offset: true }),
    comparisonLabel: z.string().min(1),
  }),
  summary: z.object({
    completedJobs: nonNegativeNumberSchema,
    totalAmount: nonNegativeNumberSchema,
    rescheduled: nonNegativeNumberSchema,
    averageJobValue: nonNegativeNumberSchema,
  }),
  comparison: z.object({
    completedJobs: comparisonMetricSchema,
    totalAmount: comparisonMetricSchema,
    rescheduled: comparisonMetricSchema,
    averageJobValue: comparisonMetricSchema,
  }),
  trend: z.array(
    z.object({
      label: z.string().min(1),
      jobs: nonNegativeNumberSchema,
      amount: nonNegativeNumberSchema,
    }),
  ),
  technicians: z.array(
    z.object({
      rank: z.number().int().positive(),
      technicianId: z.string().uuid(),
      name: z.string().min(1),
      jobs: nonNegativeNumberSchema,
      amount: nonNegativeNumberSchema,
      averageJobValue: nonNegativeNumberSchema,
      rescheduled: nonNegativeNumberSchema,
    }),
  ),
  serviceTypes: z.array(
    z.object({
      type: z.string().min(1),
      count: nonNegativeNumberSchema,
      amount: nonNegativeNumberSchema,
      sharePercent: nonNegativeNumberSchema,
    }),
  ),
  metricsVersion: z.string().regex(/^(today|this_week|this_month):[a-f0-9]{32}$/),
});

export type ManagerDashboardResponse = z.infer<
  typeof managerDashboardResponseSchema
>;
