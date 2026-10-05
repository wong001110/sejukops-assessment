import type { AppRole } from "@/lib/auth/types";
import { parseOrderFocusId } from "./agent/order-focus";

export type OperationsNavItem = { section: "overview" | "orders" | "assignment" | "schedule" | "knowledge"; label: string; href: string };

/** Presentation only; each destination still resolves and checks its actor. */
export function operationsNavItems({ base, role, canAssign, isGuest, readOnly = false }: {
  base: string; role: AppRole; canAssign: boolean; isGuest: boolean; readOnly?: boolean;
}): OperationsNavItem[] {
  return [
    ...(role === "MANAGER" ? [{ section: "overview" as const, label: "Dashboard", href: `${base}/overview` }] : []),
    { section: "orders", label: role === "TECHNICIAN" ? "My jobs" : "Orders", href: `${base}/orders` },
    ...(role === "ADMIN" && canAssign && !isGuest && !readOnly
      ? [{ section: "assignment" as const, label: "Assignment", href: `${base}/assignment` }] : []),
    ...(role === "MANAGER" && !readOnly ? [{ section: "schedule" as const, label: "Schedule", href: `${base}/schedule` }] : []),
    { section: "knowledge", label: "Knowledge", href: `${base}/knowledge` },
  ];
}

/** Only a mode handoff carries order focus. Overview and other sections stay clean. */
export function operationsModeHref(base: string, mode: "operations" | "agent", focus: unknown): string {
  const orderId = parseOrderFocusId(focus);
  const destination = mode === "agent" ? `${base}/agent` : `${base}/${orderId ? "orders" : "overview"}`;
  return orderId ? `${destination}?orderId=${encodeURIComponent(orderId)}` : destination;
}

type OverviewOrder = { status: string; scheduled_at: string | null; assigned_technician_id: string | null };

/** Counts only the bounded actor-visible rows, never workspace-wide totals. */
export function summarizeVisibleOrders(orders: readonly OverviewOrder[]) {
  const counts = { visible: orders.length, new: 0, assigned: 0, inProgress: 0, completed: 0, needsSchedule: 0, scheduledActive: 0, needsAssignment: 0 };
  for (const order of orders) {
    if (order.status === "NEW") counts.new += 1;
    if (order.status === "ASSIGNED") counts.assigned += 1;
    if (order.status === "IN_PROGRESS") counts.inProgress += 1;
    if (order.status === "COMPLETED") counts.completed += 1;
    if (["NEW", "ASSIGNED", "IN_PROGRESS"].includes(order.status)) {
      if (order.scheduled_at && Number.isFinite(Date.parse(order.scheduled_at))) counts.scheduledActive += 1;
      else counts.needsSchedule += 1;
      if (!order.assigned_technician_id) counts.needsAssignment += 1;
    }
  }
  return counts;
}
