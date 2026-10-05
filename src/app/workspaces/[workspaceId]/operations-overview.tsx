"use client";

import { ArrowRightOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Empty, Skeleton, Tag } from "antd";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { AppRole } from "@/lib/auth/types";
import type { RecentOrder } from "@/lib/capabilities/recent-orders";
import { formatMalaysiaDateTime } from "@/lib/time/malaysia";
import { useLatestRequest } from "@/lib/ui/use-latest-request";
import { operationsNavItems, summarizeVisibleOrders } from "./operations-nav-policy";

const ROLE_CONTENT = {
  ADMIN: { title: "Admin overview", description: "Review incoming requests and continue your dispatch work.", queue: "Recent service requests" },
  MANAGER: { title: "Manager overview", description: "Review visit times and identify requests that still need scheduling.", queue: "Schedule attention" },
  TECHNICIAN: { title: "Technician overview", description: "Review your assigned jobs and continue service work.", queue: "Your recent jobs" },
};

function scheduledLabel(value: string | null) {
  return !value ? "Not scheduled" : Number.isFinite(Date.parse(value)) ? `${formatMalaysiaDateTime(value)} MYT` : "Schedule unavailable";
}

export function OperationsOverview({ workspaceId, role, readOnly, canAssign, isGuest }: {
  workspaceId: string; role: AppRole; readOnly: boolean; canAssign: boolean; isGuest: boolean;
}) {
  const [orders, setOrders] = useState<RecentOrder[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const requests = useLatestRequest();
  const load = useCallback(async () => {
    const current = requests.begin();
    setState("loading");
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/orders`, { cache: "no-store", signal: current.signal });
      if (!response.ok) throw new Error("Orders unavailable");
      const body = await response.json() as { orders: RecentOrder[] };
      if (!Array.isArray(body.orders)) throw new Error("Orders unavailable");
      if (!current.isCurrent()) return;
      setOrders(body.orders);
      setState("ready");
    } catch {
      if (current.isCurrent()) setState("error");
    } finally { current.finish(); }
  }, [workspaceId, requests]);
  useEffect(() => { void load(); return () => requests.cancel(); }, [load, requests]);
  const base = `/workspaces/${workspaceId}`;
  const content = ROLE_CONTENT[role];
  const counts = summarizeVisibleOrders(orders);
  const metrics = role === "ADMIN" ? [
    { label: "Visible recent orders", value: counts.visible }, { label: "New requests", value: counts.new },
    { label: "Assigned", value: counts.assigned }, { label: "In progress", value: counts.inProgress },
  ] : role === "MANAGER" ? [
    { label: "Visible recent orders", value: counts.visible }, { label: "Active visits scheduled", value: counts.scheduledActive },
    { label: "Active orders without a visit time", value: counts.needsSchedule }, { label: "Completed", value: counts.completed },
  ] : [
    { label: "Visible recent jobs", value: counts.visible }, { label: "Assigned", value: counts.assigned },
    { label: "In progress", value: counts.inProgress }, { label: "Completed", value: counts.completed },
  ];
  const queue = role === "MANAGER"
    ? [...orders.filter((order) => ["NEW", "ASSIGNED", "IN_PROGRESS"].includes(order.status) && (!order.scheduled_at || !Number.isFinite(Date.parse(order.scheduled_at)))),
      ...orders.filter((order) => ["NEW", "ASSIGNED", "IN_PROGRESS"].includes(order.status) && order.scheduled_at && Number.isFinite(Date.parse(order.scheduled_at)))].slice(0, 5)
    : orders.slice(0, 5);
  const sections = operationsNavItems({ base, role, canAssign, isGuest, readOnly }).filter((item) => item.section !== "overview");
  return <main className="workspace-main operations-overview">
    <div className="workspace-heading"><div><p className="operations-eyebrow">Service Operations</p><h1>{content.title}</h1><p>{content.description}</p></div>
      <Button icon={<ReloadOutlined aria-hidden />} onClick={() => void load()}>Refresh overview</Button></div>
    {readOnly && <Alert className="operations-preview-notice" showIcon type="info" message="Read-only perspective" description="Inspect the records visible to this role. Business changes are unavailable in this preview." />}
    <p className="operations-scope-note">Counts cover only the recent {role === "TECHNICIAN" ? "assigned jobs" : "orders"} visible to this role (up to 20). They are not totals for a date period.</p>
    {state === "loading" && <Card className="workspace-panel"><Skeleton active paragraph={{ rows: 6 }} /></Card>}
    {state === "error" && <Alert showIcon type="error" message="Overview could not be loaded." description="Refresh to try again, or open your orders directly." action={<Link href={`${base}/orders`}>{role === "TECHNICIAN" ? "Open my jobs" : "Open orders"}</Link>} />}
    {state === "ready" && <>
      <section className="operations-metrics" aria-label="Visible recent order counts">
        {metrics.map(({ label, value }) => <Card key={label} className="workspace-panel operations-metric"><span>{label}</span><strong>{value}</strong></Card>)}
      </section>
      <div className="operations-overview-grid">
        <Card className="workspace-panel" title={content.queue} extra={<Link href={`${base}/${role === "MANAGER" && !readOnly ? "schedule" : "orders"}`}>{role === "MANAGER" && !readOnly ? "Open schedule" : "View all visible"} <ArrowRightOutlined /></Link>}>
          {queue.length ? <div className="operations-recent-list">{queue.map((order) => <Link key={order.id} className="operations-recent-row" href={`${base}/orders?orderId=${encodeURIComponent(order.id)}`}>
            <div className="workspace-order-top"><strong>{order.order_no}</strong><Tag color={order.status === "NEW" ? "blue" : order.status === "COMPLETED" ? "green" : "gold"}>{order.status.replaceAll("_", " ")}</Tag></div>
            <p>{order.service_type} · {order.problem_description}</p><span className="product-muted">{scheduledLabel(order.scheduled_at)}</span><span className="operations-open-order">Open {role === "TECHNICIAN" ? "job" : "order"} <ArrowRightOutlined /></span>
          </Link>)}</div> : <Empty description={role === "MANAGER" ? "No active orders are visible in this recent list." : role === "TECHNICIAN" ? "No recent assigned jobs are visible." : "No recent orders are visible."} />}
        </Card>
        <Card className="workspace-panel operations-shortcuts" title="Your workspace">
          {sections.map(({ section, label, href }) => <Link key={section} href={href}><div><strong>{label}</strong><p>{section === "orders" ? role === "TECHNICIAN" ? "Inspect assigned jobs and service progress." : "Browse requests and inspect order details."
            : section === "assignment" ? "Review and confirm a saved assignment proposal."
              : section === "schedule" ? "Review visit times and open scheduling controls."
                : "Find published service knowledge."}</p></div><ArrowRightOutlined /></Link>)}
        </Card>
      </div>
    </>}
  </main>;
}
