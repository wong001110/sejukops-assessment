import { z } from "zod";

export const dashboardPeriodSchema = z.enum(["today", "this_week", "this_month"]);
export type DashboardPeriod = z.infer<typeof dashboardPeriodSchema>;
export const dashboardOrderSchema = z.object({
  id: z.string().uuid(), workspace_id: z.string().uuid(), order_no: z.string(),
  assigned_technician_id: z.string().uuid().nullable(), service_type: z.string(),
  status: z.enum(["NEW", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CLOSED"]),
  scheduled_at: z.string().datetime({ offset: true }).nullable(),
  created_at: z.string().datetime({ offset: true }),
});
export type DashboardOrder = z.infer<typeof dashboardOrderSchema>;
const count = z.number().int().nonnegative();
const cohort = z.object({ orders: count, completed: count, completionRate: z.number().min(0).max(100) });
export const dashboardActivitySchema = z.object({
  asOf: z.string().datetime({ offset: true }), generation: z.number().int().positive(),
  completed: count, rescheduled: count, previousCompleted: count, previousRescheduled: count,
  trend: z.array(z.object({ label: z.string(), jobs: count })),
  technicians: z.array(z.object({ technicianId: z.string().uuid(), name: z.string(), completed: count, rescheduled: count })),
});
export type DashboardActivity = z.infer<typeof dashboardActivitySchema>;
export const operationsDashboardSchema = z.object({
  workspaceId: z.string().uuid(), role: z.enum(["ADMIN", "MANAGER", "TECHNICIAN"]),
  generation: z.number().int().positive(), period: dashboardPeriodSchema,
  asOf: z.string().datetime(),
  range: z.object({ start: z.string().datetime(), end: z.string().datetime(), previousStart: z.string().datetime(), previousEnd: z.string().datetime(), comparisonLabel: z.string() }),
  cohort, previous: cohort,
  activity: dashboardActivitySchema,
  current: z.object({ total: count, new: count, assigned: count, inProgress: count, completed: count, closed: count, active: count, needsSchedule: count, overdue: count, scheduledToday: count }),
  trend: z.array(z.object({ label: z.string(), orders: count })),
  services: z.array(z.object({ type: z.string(), orders: count, sharePercent: z.number() })),
  technicians: z.array(z.object({ technicianId: z.string().uuid(), active: count, completed: count, scheduled: count })),
  recentOrders: z.array(dashboardOrderSchema),
});
export type OperationsDashboard = z.infer<typeof operationsDashboardSchema>;
