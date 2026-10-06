import type { AppRole } from "@/lib/auth/types";
import type { DashboardActivity, DashboardOrder, DashboardPeriod, OperationsDashboard } from "./contracts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MYT = 8 * HOUR;
const isCompleted = (row: DashboardOrder) => row.status === "COMPLETED" || row.status === "CLOSED";
const isActive = (row: DashboardOrder) => row.status === "NEW" || row.status === "ASSIGNED" || row.status === "IN_PROGRESS";

/** Calendar periods in MYT; comparisons cover the same elapsed duration. */
export function dashboardRange(period: DashboardPeriod, now: Date) {
  const local = new Date(now.getTime() + MYT);
  const today = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - MYT;
  const start = period === "today" ? today : period === "this_week" ? today - ((local.getUTCDay() + 6) % 7) * DAY
    : Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - MYT;
  const previousStart = period === "today" ? start - DAY : period === "this_week" ? start - 7 * DAY
    : Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - 1, 1) - MYT;
  const previousEnd = Math.min(start, previousStart + now.getTime() - start);
  return { start, end: now.getTime(), previousStart, previousEnd, today,
    comparisonLabel: period === "today" ? "yesterday, same time" : period === "this_week" ? "last week, same elapsed time" : "last month, same elapsed time" };
}

export function aggregateDashboard(orders: DashboardOrder[], input: { workspaceId: string; role: AppRole; period: DashboardPeriod; generation: number; now: Date; activity: DashboardActivity }): OperationsDashboard {
  const { workspaceId, role, period, generation, now } = input;
  const range = dashboardRange(period, now);
  const inRange = (row: DashboardOrder, start: number, end: number) => Date.parse(row.created_at) >= start && Date.parse(row.created_at) < end;
  const selected = orders.filter(row => inRange(row, range.start, range.end));
  const previous = orders.filter(row => inRange(row, range.previousStart, range.previousEnd));
  const cohort = (rows: DashboardOrder[]) => ({ orders: rows.length, completed: rows.filter(isCompleted).length,
    completionRate: rows.length ? rows.filter(isCompleted).length / rows.length * 100 : 0 });
  const active = orders.filter(isActive);
  const services = new Map<string, number>();
  for (const row of selected) services.set(row.service_type, (services.get(row.service_type) ?? 0) + 1);
  const technicians = new Map<string, { technicianId: string; active: number; completed: number; scheduled: number }>();
  for (const row of orders) {
    if (!row.assigned_technician_id) continue;
    const item = technicians.get(row.assigned_technician_id) ?? { technicianId: row.assigned_technician_id, active: 0, completed: 0, scheduled: 0 };
    if (isActive(row)) { item.active++; if (row.scheduled_at) item.scheduled++; }
    if (isCompleted(row) && inRange(row, range.start, range.end)) item.completed++;
    technicians.set(item.technicianId, item);
  }
  const bucketSize = period === "today" ? HOUR : DAY;
  const bucketCount = Math.max(1, Math.ceil((range.end - range.start) / bucketSize));
  const trend = Array.from({ length: bucketCount }, (_, index) => {
    const start = range.start + index * bucketSize;
    const local = new Date(start + MYT);
    return { label: period === "today" ? `${String(local.getUTCHours()).padStart(2, "0")}:00` : `${local.getUTCDate()}/${local.getUTCMonth() + 1}`,
      orders: selected.filter(row => inRange(row, start, Math.min(start + bucketSize, range.end))).length };
  });
  return { workspaceId, role, generation, period, asOf: now.toISOString(),
    range: { start: new Date(range.start).toISOString(), end: now.toISOString(), previousStart: new Date(range.previousStart).toISOString(), previousEnd: new Date(range.previousEnd).toISOString(), comparisonLabel: range.comparisonLabel },
    cohort: cohort(selected), previous: cohort(previous), activity: input.activity,
    current: { total: orders.length, new: orders.filter(row => row.status === "NEW").length,
      assigned: orders.filter(row => row.status === "ASSIGNED").length, inProgress: orders.filter(row => row.status === "IN_PROGRESS").length,
      completed: orders.filter(row => row.status === "COMPLETED").length, closed: orders.filter(row => row.status === "CLOSED").length,
      active: active.length, needsSchedule: active.filter(row => !row.scheduled_at).length,
      overdue: active.filter(row => row.scheduled_at && Date.parse(row.scheduled_at) < range.end).length,
      scheduledToday: active.filter(row => row.scheduled_at && Date.parse(row.scheduled_at) >= range.today && Date.parse(row.scheduled_at) < range.today + DAY).length },
    trend, services: [...services.entries()].map(([type, count]) => ({ type, orders: count, sharePercent: count / selected.length * 100 })).sort((a, b) => b.orders - a.orders || a.type.localeCompare(b.type)),
    technicians: [...technicians.values()].sort((a, b) => b.completed - a.completed || b.active - a.active || a.technicianId.localeCompare(b.technicianId)),
    recentOrders: [...orders].sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id)).slice(0, 12) };
}
