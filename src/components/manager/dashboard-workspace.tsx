"use client";

import { BarChartOutlined, CalendarOutlined, DollarOutlined, ReloadOutlined, RiseOutlined, TeamOutlined } from "@ant-design/icons";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Empty, Segmented, Skeleton, Statistic, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState } from "react";

import type { ManagerDashboardPeriod, ManagerDashboardResponse } from "@/domain/manager-dashboard/contracts";
import { OperationalInsight } from "./ai-operations/operational-insight";
import { fetchManagerDashboard } from "./dashboard-api";
import { consumeManagerDashboardInvalidationMarker, managerDashboardQueryKey } from "./dashboard-query";

const periodOptions: Array<{ label: string; value: ManagerDashboardPeriod }> = [
  { label: "Today", value: "today" },
  { label: "This Week", value: "this_week" },
  { label: "This Month", value: "this_month" },
];
const periodNames: Record<ManagerDashboardPeriod, string> = { today: "Today", this_week: "This Week", this_month: "This Month" };
const money = (value: number) => `RM ${value.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const count = (value: number) => value.toLocaleString("en-MY");

function Comparison({ value, label }: { value: number | null; label: string }) {
  if (value === null) return <Typography.Text type="secondary" className="dashboard-comparison">No {label.toLowerCase()} baseline</Typography.Text>;
  const status = value > 0 ? "is-positive" : value < 0 ? "is-negative" : "is-neutral";
  return <Typography.Text className={`dashboard-comparison ${status}`}>{value > 0 ? "+" : ""}{value.toFixed(1)}% <span>vs {label}</span></Typography.Text>;
}

function SummaryCard({ title, value, icon, comparison, comparisonLabel, formatter }: { title: string; value: number; icon: React.ReactNode; comparison: number | null; comparisonLabel: string; formatter?: (value: number) => string }) {
  return <Card className="dashboard-stat-card" bordered={false}>
    <div className="dashboard-stat-label"><span>{title}</span><span className="dashboard-stat-icon" aria-hidden>{icon}</span></div>
    <Statistic value={value} formatter={() => formatter ? formatter(value) : count(value)} />
    <Comparison value={comparison} label={comparisonLabel} />
  </Card>;
}

function TrendChart({ dashboard }: { dashboard: ManagerDashboardResponse }) {
  const max = Math.max(1, ...dashboard.trend.map((point) => point.jobs));
  const descriptor = dashboard.period === "today" ? "Hourly completed jobs" : dashboard.period === "this_week" ? "Daily completed jobs" : "Weekly completed jobs";
  return <Card className="dashboard-panel dashboard-trend" title={<><BarChartOutlined /> Completion trend</>} extra={<Typography.Text type="secondary">{descriptor}</Typography.Text>}>
    <div className="dashboard-chart" role="img" aria-label={`${descriptor} for ${periodNames[dashboard.period]}`}>
      {dashboard.trend.map((point) => <div className="dashboard-bar-column" key={point.label}>
        <Typography.Text className="dashboard-bar-value">{point.jobs || ""}</Typography.Text>
        <div className="dashboard-bar-track"><div className="dashboard-bar" style={{ height: `${Math.max(point.jobs ? 10 : 2, (point.jobs / max) * 100)}%` }} /></div>
        <Typography.Text className="dashboard-bar-label">{point.label}</Typography.Text>
      </div>)}
    </div>
    <Typography.Text type="secondary" className="dashboard-chart-note">Completed jobs per {dashboard.period === "today" ? "hour" : dashboard.period === "this_week" ? "day" : "week"}.</Typography.Text>
  </Card>;
}

function ServiceDistribution({ services }: { services: ManagerDashboardResponse["serviceTypes"] }) {
  return <Card className="dashboard-panel" title={<><RiseOutlined /> Service distribution</>}>
    {services.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No completed services in this period" /> : <div className="dashboard-distribution">
      {services.map((service) => <div className="dashboard-distribution-row" key={service.type}>
        <div><Typography.Text strong>{service.type}</Typography.Text><Typography.Text type="secondary">{count(service.count)} jobs · {money(service.amount)}</Typography.Text></div>
        <div className="dashboard-distribution-meter" aria-label={`${service.type}: ${service.sharePercent}%`}><div style={{ width: `${Math.max(2, service.sharePercent)}%` }} /></div>
        <Typography.Text strong>{service.sharePercent.toFixed(1)}%</Typography.Text>
      </div>)}
    </div>}
  </Card>;
}

function TechnicianTable({ technicians }: { technicians: ManagerDashboardResponse["technicians"] }) {
  const columns: ColumnsType<ManagerDashboardResponse["technicians"][number]> = [
    { title: "#", dataIndex: "rank", width: 48, render: (rank) => <Tag color={rank === 1 ? "gold" : "default"}>{rank}</Tag> },
    { title: "Technician", dataIndex: "name", ellipsis: true },
    { title: "Completed", dataIndex: "jobs", align: "right", render: count },
    { title: "Amount", dataIndex: "amount", align: "right", render: money },
    { title: "Avg. value", dataIndex: "averageJobValue", align: "right", render: money },
    { title: "Rescheduled", dataIndex: "rescheduled", align: "right", render: count },
  ];
  return <Card className="dashboard-panel dashboard-leaderboard" title={<><TeamOutlined /> Technician leaderboard</>}>
    <Table rowKey="technicianId" columns={columns} dataSource={technicians} pagination={false} size="middle" locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No technician activity in this period" /> }} scroll={{ x: 680 }} />
  </Card>;
}

function DashboardLoading() {
  return <div className="manager-dashboard dashboard-loading" aria-label="Loading dashboard"><Skeleton active title={{ width: 220 }} paragraph={{ rows: 1 }} /><div className="dashboard-stat-grid">{Array.from({ length: 4 }, (_, index) => <Card key={index}><Skeleton active paragraph={{ rows: 2 }} /></Card>)}</div><div className="dashboard-detail-grid"><Card><Skeleton active paragraph={{ rows: 7 }} /></Card><Card><Skeleton active paragraph={{ rows: 7 }} /></Card></div></div>;
}

function ManagerDashboard() {
  const [period, setPeriod] = useState<ManagerDashboardPeriod>("this_week");
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: managerDashboardQueryKey(period), queryFn: () => fetchManagerDashboard(period), staleTime: 60_000, placeholderData: keepPreviousData });
  useEffect(() => {
    if (consumeManagerDashboardInvalidationMarker()) void queryClient.invalidateQueries({ queryKey: ["manager-dashboard"] });
  }, [queryClient]);
  if (query.isPending && !query.data) return <DashboardLoading />;
  if (query.isError && !query.data) return <div className="manager-dashboard"><Alert type="error" showIcon message="Dashboard unavailable" description={query.error.message} action={<Button icon={<ReloadOutlined />} onClick={() => void query.refetch()}>Retry</Button>} /></div>;
  const dashboard = query.data;
  if (!dashboard) return null;
  const comparisonLabel = dashboard.range.comparisonLabel;
  return <main className="manager-dashboard" aria-busy={query.isFetching}>
    <section className="dashboard-heading">
      <div><Typography.Text className="dashboard-kicker">Manager analytics</Typography.Text><Typography.Title level={1}>Operations dashboard</Typography.Title><Typography.Paragraph>Completed work, value, and schedule movement in Malaysia time.</Typography.Paragraph></div>
      <div className="dashboard-controls"><Segmented value={period} options={periodOptions} onChange={(next) => setPeriod(next as ManagerDashboardPeriod)} aria-label="Dashboard period" /><Typography.Text type="secondary"><CalendarOutlined /> {comparisonLabel}</Typography.Text></div>
    </section>
    {query.isError && <Alert className="dashboard-refresh-error" type="warning" showIcon message="Latest dashboard refresh failed" description="Showing the most recently available metrics. Retry when the connection is available." action={<Button size="small" onClick={() => void query.refetch()}>Retry</Button>} />}
    {query.isPlaceholderData && <div className="dashboard-refreshing" role="status">Updating {periodNames[period]} metrics…</div>}
    <section className="dashboard-stat-grid" aria-label="Key performance indicators">
      <SummaryCard title="Jobs completed" value={dashboard.summary.completedJobs} icon={<TeamOutlined />} comparison={dashboard.comparison.completedJobs.percentChange} comparisonLabel={comparisonLabel} />
      <SummaryCard title="Total amount" value={dashboard.summary.totalAmount} icon={<DollarOutlined />} formatter={money} comparison={dashboard.comparison.totalAmount.percentChange} comparisonLabel={comparisonLabel} />
      <SummaryCard title="Rescheduled" value={dashboard.summary.rescheduled} icon={<CalendarOutlined />} comparison={dashboard.comparison.rescheduled.percentChange} comparisonLabel={comparisonLabel} />
      <SummaryCard title="Average job value" value={dashboard.summary.averageJobValue} icon={<RiseOutlined />} formatter={money} comparison={dashboard.comparison.averageJobValue.percentChange} comparisonLabel={comparisonLabel} />
    </section>
    {dashboard.summary.completedJobs === 0 && <Alert className="dashboard-empty-summary" type="info" showIcon message={`No completed jobs for ${periodNames[dashboard.period].toLowerCase()}`} description="Totals and average job value are shown as zero until completed work is recorded." />}
    <OperationalInsight dashboard={dashboard} />
    <section className="dashboard-detail-grid"><TrendChart dashboard={dashboard} /><ServiceDistribution services={dashboard.serviceTypes} /></section>
    <TechnicianTable technicians={dashboard.technicians} />
  </main>;
}

export function DashboardWorkspace() {
  return <ManagerDashboard />;
}
