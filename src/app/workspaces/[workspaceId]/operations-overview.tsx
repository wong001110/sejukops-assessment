"use client";

import { BarChartOutlined, CheckCircleOutlined, ClockCircleOutlined, ReloadOutlined, TeamOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Empty, Skeleton, Statistic, Table, Tag } from "antd";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { AppRole } from "@/lib/auth/types";
import type { RecentOrder } from "@/lib/capabilities/recent-orders";
import { formatMalaysiaDateTime } from "@/lib/time/malaysia";
import { useLatestRequest } from "@/lib/ui/use-latest-request";
import { summarizeVisibleOrders } from "./operations-nav-policy";

const ROLE_CONTENT = {
  ADMIN: { title: "Admin overview", description: "Review incoming requests and continue your dispatch work.", queue: "Recent service requests" },
  MANAGER: { title: "Manager overview", description: "Review visit times and identify requests that still need scheduling.", queue: "Schedule attention" },
  TECHNICIAN: { title: "Technician overview", description: "Review your assigned jobs and continue service work.", queue: "Your recent jobs" },
};

function scheduledLabel(value: string | null) {
  return !value ? "Not scheduled" : Number.isFinite(Date.parse(value)) ? `${formatMalaysiaDateTime(value)} MYT` : "Schedule unavailable";
}

export function OperationsOverview({ workspaceId, role, readOnly }: {
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
  const icons = [<TeamOutlined key="visible" />, <ClockCircleOutlined key="scheduled" />, <BarChartOutlined key="attention" />, <CheckCircleOutlined key="complete" />];
  return <main className="workspace-main manager-dashboard">
    <div className="dashboard-heading"><div><h1>Dashboard</h1><p>{content.description}</p></div>
      <Button icon={<ReloadOutlined aria-hidden />} onClick={() => void load()}>Refresh overview</Button></div>
    {readOnly && <Alert className="product-note" showIcon type="info" message="Read-only perspective" description="Business changes are unavailable in this preview." />}
    <p className="dashboard-chart-note">Counts cover only the recent orders visible to this role (up to 20). They are not totals for a date period.</p>
    {state === "loading" && <Card><Skeleton active paragraph={{ rows: 6 }} /></Card>}
    {state === "error" && <Alert showIcon type="error" message="Overview could not be loaded." description="Refresh to try again." />}
    {state === "ready" && <>
      <section className="dashboard-stat-grid" aria-label="Visible recent order counts">
        {metrics.map(({ label, value }, index) => <Card key={label} className="dashboard-stat-card" variant="borderless">
          <div className="dashboard-stat-label"><span>{label}</span><span className="dashboard-stat-icon" aria-hidden>{icons[index]}</span></div>
          <Statistic value={value} /><span className="dashboard-comparison">Recent visible records</span>
        </Card>)}
      </section>
      <Card className="dashboard-panel dashboard-leaderboard" title="Recent orders" extra={<Link href={`${base}/orders`}>Open orders</Link>}>
        {orders.length ? <Table size="small" rowKey="id" dataSource={orders} pagination={{ pageSize: 8, hideOnSinglePage: true }} scroll={{ x: 600 }} columns={[
          { title: "Order", dataIndex: "order_no", render: (value: string, order: RecentOrder) => <Link href={`${base}/orders?orderId=${encodeURIComponent(order.id)}`}>{value}</Link> },
          { title: "Service", dataIndex: "service_type" },
          { title: "Status", dataIndex: "status", render: (status: string) => <Tag color={status === "COMPLETED" ? "green" : "blue"}>{status}</Tag> },
          { title: "Scheduled (MYT)", dataIndex: "scheduled_at", render: scheduledLabel },
        ]} /> : <Empty description="No recent orders are visible." />}
      </Card>
    </>}
  </main>;
}
