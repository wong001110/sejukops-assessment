"use client";

import { BarChartOutlined, CheckCircleOutlined, ClockCircleOutlined, ReloadOutlined, TeamOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Empty, Skeleton, Statistic, Table, Tag } from "antd";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { AppRole } from "@/lib/auth/types";
import { operationsDashboardSchema, type DashboardPeriod, type DashboardOrder, type OperationsDashboard } from "@/domain/operations-dashboard/contracts";
import { formatMalaysiaDateTime } from "@/lib/time/malaysia";
import { useLatestRequest } from "@/lib/ui/use-latest-request";
import { DashboardInsight } from "./dashboard-insight";
import "./operations-dashboard.css";

const PERIODS = [{ label: "Today", value: "today" }, { label: "This Week", value: "this_week" }, { label: "This Month", value: "this_month" }] as const;
const DESCRIPTIONS = {
  ADMIN: "Track incoming requests, dispatch queues and completed service work.",
  MANAGER: "Review completed work, service demand and technician schedules.",
  TECHNICIAN: "Track your assigned jobs, visit times and completed work.",
};
function comparison(value: number, previous: number, label: string) {
  if (!previous) return `No ${label} baseline`;
  const change = (value - previous) / previous * 100;
  return `${change > 0 ? "+" : ""}${change.toFixed(1)}% vs ${label}`;
}
function scheduledLabel(value: string | null) { return value ? `${formatMalaysiaDateTime(value)} MYT` : "Not scheduled"; }

function DashboardData({ dashboard, workspaceId, role }: { dashboard: OperationsDashboard; workspaceId: string; role: AppRole }) {
  const { current, cohort, previous, activity, range } = dashboard;
  const base = `/workspaces/${workspaceId}`;
  const metrics = [
    { label: "Jobs completed", value: activity.completed, note: comparison(activity.completed, activity.previousCompleted, range.comparisonLabel) },
    { label: "Incoming orders", value: cohort.orders, note: comparison(cohort.orders, previous.orders, range.comparisonLabel) },
    role === "ADMIN" ? { label: "Awaiting dispatch", value: current.new, note: "All current new requests" }
      : role === "TECHNICIAN" ? { label: "Today's visits", value: current.scheduledToday, note: "Active jobs scheduled today" }
      : { label: "Rescheduled", value: activity.rescheduled, note: comparison(activity.rescheduled, activity.previousRescheduled, range.comparisonLabel) },
    { label: "Active jobs", value: current.active, note: `${current.inProgress} in progress · ${current.needsSchedule} without visit time` },
  ];
  const icons = [<CheckCircleOutlined key="completed" />, <BarChartOutlined key="incoming" />, <ClockCircleOutlined key="attention" />, <TeamOutlined key="active" />];
  const max = Math.max(1, ...activity.trend.map(item => item.jobs));
  const workload = dashboard.technicians.map(item => ({ ...item,
    name: activity.technicians.find(event => event.technicianId === item.technicianId)?.name ?? `Technician · ${item.technicianId.slice(0, 8)}`,
    completed: activity.technicians.find(event => event.technicianId === item.technicianId)?.completed ?? 0,
    rescheduled: activity.technicians.find(event => event.technicianId === item.technicianId)?.rescheduled ?? 0,
  })).sort((a,b) => b.completed-a.completed || b.active-a.active || a.technicianId.localeCompare(b.technicianId));
  return <>
    <section className="dashboard-stat-grid" aria-label="Key performance indicators">
      {metrics.map(({ label, value, note }, index) => <Card key={label} className="dashboard-stat-card" variant="borderless">
        <div className="dashboard-stat-label"><span>{label}</span><span className="dashboard-stat-icon" aria-hidden>{icons[index]}</span></div>
        <Statistic value={value} /><span className="dashboard-comparison">{note}</span>
      </Card>)}
    </section>
    <Card className="dashboard-panel" title="Operational highlights">
      <div className="operations-dashboard-highlights">
        <div><strong>{current.total}</strong><span>{role === "TECHNICIAN" ? "Total assigned jobs" : "Total workspace orders"}</span></div>
        <div><strong>{current.overdue}</strong><span>Active jobs past their visit time</span></div>
        <div><strong>{current.needsSchedule}</strong><span>Active jobs without a visit time</span></div>
        <div><strong>{cohort.completionRate.toFixed(1)}%</strong><span>Completion rate of orders created this period</span></div>
      </div>
    </Card>
    <section className="dashboard-detail-grid">
      <Card className="dashboard-panel dashboard-trend" title={<><BarChartOutlined /> Completion trend</>} extra={activity.completed ? `${activity.completed} jobs` : "No recorded completions"}>
        <div className={`dashboard-chart${activity.trend.length > 12 ? " is-dense" : ""}`} role="img" aria-label="Completed jobs by activity time in MYT"
          style={{ gridTemplateColumns: `repeat(${Math.max(1, activity.trend.length)}, minmax(0, 1fr))` }}>
          {activity.trend.map(point => <div className="dashboard-bar-column" key={point.label}>
            <span className="dashboard-bar-value">{point.jobs || ""}</span>
            <div className="dashboard-bar-track"><div className="dashboard-bar" style={{ height: `${Math.max(point.jobs ? 10 : 2, point.jobs / max * 100)}%` }} /></div>
            <span className="dashboard-bar-label">{point.label}</span>
          </div>)}
        </div>
        <p className="dashboard-chart-note">Recorded completion events per {dashboard.period === "today" ? "hour" : "day"}, Malaysia time.</p>
      </Card>
      <Card className="dashboard-panel" title="Service distribution">
        {dashboard.services.length ? <div className="dashboard-distribution">{dashboard.services.map(service => <div className="dashboard-distribution-row" key={service.type}>
          <div><strong>{service.type}</strong><span>{service.orders} orders</span></div>
          <div className="dashboard-distribution-meter" aria-label={`${service.type}: ${service.sharePercent.toFixed(1)}%`}><div style={{ width: `${service.sharePercent}%` }} /></div>
          <strong>{service.sharePercent.toFixed(1)}%</strong>
        </div>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No orders created in this period" />}
        <p className="dashboard-chart-note">Orders created during the selected period, grouped by service.</p>
      </Card>
    </section>
    {role !== "TECHNICIAN" && <Card className="dashboard-panel dashboard-leaderboard" title="Technician workload & completions">
      <Table size="small" rowKey="technicianId" dataSource={workload} pagination={{ pageSize: 8, hideOnSinglePage: true }} scroll={{ x: 600 }} columns={[
        { title: "Technician", dataIndex: "name" },
        { title: "Completed this period", dataIndex: "completed", align: "right" },
        { title: "Rescheduled this period", dataIndex: "rescheduled", align: "right" },
        { title: "Active now", dataIndex: "active", align: "right" },
        { title: "Visit times set", dataIndex: "scheduled", align: "right" },
      ]} />
      <p className="dashboard-chart-note">Only technicians attached to visible orders. This does not establish availability or skills.</p>
    </Card>}
    <Card className="dashboard-panel" title="Current order status">
      <div className="operations-dashboard-statuses">{[["New",current.new],["Assigned",current.assigned],["In progress",current.inProgress],["Completed",current.completed],["Closed",current.closed]].map(([label,value]) => <Tag key={label}>{label}: {value}</Tag>)}</div>
      <p className="dashboard-chart-note">Financial amount and average job value are unavailable because this workspace does not record charges. Completion and reschedule metrics use recorded activity; imported or seeded statuses without activity are included in current status only.</p>
    </Card>
    <Card className="dashboard-panel dashboard-leaderboard" title={role === "TECHNICIAN" ? "Your recent jobs" : "Recent orders"} extra={<Link href={`${base}/orders`}>Open orders</Link>}>
      {dashboard.recentOrders.length ? <Table size="small" rowKey="id" dataSource={dashboard.recentOrders} pagination={{ pageSize: 6, hideOnSinglePage: true }} scroll={{ x: 600 }} columns={[
        { title: "Order", dataIndex: "order_no", render: (value: string, order: DashboardOrder) => <Link href={`${base}/orders?orderId=${encodeURIComponent(order.id)}`}>{value}</Link> },
        { title: "Service", dataIndex: "service_type" },
        { title: "Status", dataIndex: "status", render: (status: string) => <Tag color={status === "COMPLETED" ? "green" : "blue"}>{status}</Tag> },
        { title: "Scheduled (MYT)", dataIndex: "scheduled_at", render: scheduledLabel },
      ]} /> : <Empty description="No orders are visible." />}
    </Card>
  </>;
}

export function OperationsOverview({ workspaceId, role, readOnly, isGuest }: {
  workspaceId: string; role: AppRole; readOnly: boolean; canAssign: boolean; isGuest: boolean;
}) {
  const [period, setPeriod] = useState<DashboardPeriod>("this_week");
  const [dashboard, setDashboard] = useState<OperationsDashboard | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const requests = useLatestRequest();
  const load = useCallback(async () => {
    const current = requests.begin(); setState("loading"); setDashboard(null);
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/dashboard?period=${period}`, { cache: "no-store", signal: current.signal });
      if (!response.ok) throw new Error("Dashboard unavailable");
      const body = await response.json() as { dashboard: unknown };
      const data = operationsDashboardSchema.parse(body.dashboard);
      if (data.workspaceId !== workspaceId || data.role !== role || data.period !== period) throw new Error("Dashboard scope changed");
      if (!current.isCurrent()) return;
      setDashboard(data); setState("ready");
    } catch { if (current.isCurrent()) setState("error"); }
    finally { current.finish(); }
  }, [workspaceId, role, period, requests]);
  useEffect(() => { void load(); return () => requests.cancel(); }, [load, requests]);
  return <main className="workspace-main manager-dashboard" aria-busy={state === "loading"}>
    <div className="dashboard-heading"><div><span className="dashboard-kicker">{role.charAt(0) + role.slice(1).toLowerCase()} analytics</span><h1>Dashboard</h1><p>{DESCRIPTIONS[role]}</p></div>
      <div className="dashboard-controls"><div className="dashboard-period-filter" role="group" aria-label="Dashboard period">{PERIODS.map(option => <Button key={option.value} type="text" className={period === option.value ? "is-selected" : undefined} aria-pressed={period === option.value} onClick={() => setPeriod(option.value)}>{option.label}</Button>)}</div>
        <Button icon={<ReloadOutlined aria-hidden />} onClick={() => void load()}>Refresh overview</Button></div>
    </div>
    {readOnly && <Alert className="product-note" showIcon type="info" message="Read-only perspective" description="Business changes are unavailable in this preview." />}
    <p className="dashboard-chart-note">All orders visible to your role. Period activity and incoming orders use Malaysia time; current queues include older orders.</p>
    {state === "loading" && <Card><Skeleton active paragraph={{ rows: 6 }} /></Card>}
    {state === "error" && <Alert showIcon type="error" message="Overview could not be loaded." description="Refresh to try again." />}
    {state === "ready" && dashboard && <>
      <p className="dashboard-chart-note">{formatMalaysiaDateTime(dashboard.range.start)} – {formatMalaysiaDateTime(dashboard.asOf)} MYT · compared with {dashboard.range.comparisonLabel}</p>
      <section className="operations-dashboard-stack" aria-label="Dashboard sections">
        <DashboardData dashboard={dashboard} workspaceId={workspaceId} role={role} />
        <DashboardInsight workspaceId={workspaceId} period={period} isGuest={isGuest} canUseAi={!readOnly} />
      </section>
    </>}
  </main>;
}
