import { z } from "zod";
import type { OperationsDashboard } from "./contracts";

export type DashboardHighlight = { id: string; title: string; observation: string; nextStep: string };
/** Displayed claims come from verified aggregates, never model prose. */
export function dashboardHighlightCatalog(data: OperationsDashboard): DashboardHighlight[] {
  return [
    { id: "overdue", title: "Overdue visits", observation: `${data.current.overdue} active orders have a past visit time.`, nextStep: "Review these orders and confirm the next visit manually." },
    { id: "schedule", title: "Scheduling attention", observation: `${data.current.needsSchedule} active orders do not have a visit time.`, nextStep: "Check the scheduling queue before assigning visit times." },
    { id: "completed", title: "Completed work", observation: `${data.activity.completed} completion events in this period; ${data.activity.previousCompleted} in the equivalent previous period.`, nextStep: "Compare the completion trend with current workload." },
    { id: "rescheduled", title: "Schedule changes", observation: `${data.activity.rescheduled} reschedule events in this period; ${data.activity.previousRescheduled} in the equivalent previous period.`, nextStep: "Review schedule changes with the responsible team." },
    { id: "incoming", title: "Incoming requests", observation: `${data.cohort.orders} orders created in this period; ${data.previous.orders} in the equivalent previous period.`, nextStep: "Review incoming requests alongside the active queue." },
    { id: "today", title: "Today's visits", observation: `${data.current.scheduledToday} active orders are scheduled today in Malaysia time.`, nextStep: "Check today's visit times and readiness." },
  ];
}
export function selectDashboardHighlights(text: string, catalog: DashboardHighlight[]) {
  const parsed = z.object({ ids: z.array(z.string()).min(1).max(3) }).strict().parse(JSON.parse(text));
  if (new Set(parsed.ids).size !== parsed.ids.length || parsed.ids.some(id => !catalog.some(item => item.id === id))) {
    throw new Error("Invalid insight selection");
  }
  return parsed.ids.map(id => catalog.find(item => item.id === id)!);
}
export function dashboardInsightSnapshot(data: OperationsDashboard) {
  // asOf may advance without data changes. Scope, generation and aggregates may not.
  return JSON.stringify({ workspaceId: data.workspaceId, role: data.role, generation: data.generation,
    period: data.period, rangeStart: data.range.start, current: data.current, cohort: data.cohort,
    previous: data.previous, completed: data.activity.completed, rescheduled: data.activity.rescheduled,
    previousCompleted: data.activity.previousCompleted, previousRescheduled: data.activity.previousRescheduled });
}
