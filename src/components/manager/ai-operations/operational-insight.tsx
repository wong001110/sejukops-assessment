"use client";

import { BulbOutlined, ReloadOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, Collapse, FloatButton, Modal, Skeleton, Space, Tag, Typography } from "antd";
import { useState } from "react";

import type { ManagerDashboardResponse } from "@/domain/manager-dashboard/contracts";
import { AIOperationsClientError, aiRecoveryCopy, fetchOperationalInsight } from "./api";

export const operationalInsightQueryKey = (period: ManagerDashboardResponse["period"], metricsVersion: string) => ["manager-operational-insight", period, metricsVersion] as const;

function formatFactLabel(label: string) {
  return label.replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim().replace(/\b\w/g, (character) => character.toUpperCase());
}

export function OperationalInsight({ dashboard }: { dashboard: ManagerDashboardResponse }) {
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: operationalInsightQueryKey(dashboard.period, dashboard.metricsVersion),
    queryFn: () => fetchOperationalInsight({ period: dashboard.period, metricsVersion: dashboard.metricsVersion }),
    staleTime: 60_000,
    enabled: open,
  });
  const error = query.error instanceof AIOperationsClientError ? query.error.details : { code: "AI_PROVIDER_UNAVAILABLE", message: "The AI insight could not be completed.", retryable: true, action: "RETRY" } as const;

  return <>
    <Card className="dashboard-ai-teaser" bordered={false}>
      <div className="dashboard-ai-teaser-copy"><span className="dashboard-ai-teaser-icon" aria-hidden><BulbOutlined /></span><div><Typography.Text className="dashboard-kicker">AI decision support</Typography.Text><Typography.Title level={5}>Explain this operational snapshot</Typography.Title><Typography.Paragraph>Open a grounded interpretation of the current KPI period. The assistant only uses approved dashboard facts.</Typography.Paragraph></div></div>
      <Button type="primary" onClick={() => setOpen(true)}>Open insight</Button>
    </Card>
    <FloatButton className="dashboard-ai-fab" icon={<BulbOutlined />} tooltip="AI decision support" onClick={() => setOpen(true)} />
    <Modal className="operational-insight-modal" title={<Space size={8}><BulbOutlined /> AI decision support <Tag color="blue">Grounded</Tag></Space>} open={open} onCancel={() => setOpen(false)} footer={<Button onClick={() => setOpen(false)}>Close</Button>} width={680} destroyOnHidden>
      {query.isPending ? <div className="operational-insight-loading"><Skeleton active title={{ width: "45%" }} paragraph={{ rows: 2 }} /></div> : query.isError ? <Alert type="warning" showIcon message="AI insight unavailable" description={<div><div>{error.message}</div><Typography.Text type="secondary">{aiRecoveryCopy(error.action)}</Typography.Text><Typography.Paragraph>The deterministic KPI dashboard remains available.</Typography.Paragraph></div>} action={error.retryable ? <Button size="small" icon={<ReloadOutlined />} onClick={() => void query.refetch()}>Retry</Button> : undefined} /> : query.data ? <div className="operational-insight-copy"><Typography.Paragraph>{query.data.insight}</Typography.Paragraph><Collapse size="small" className="ai-operations-grounding" items={[{ key: "facts", label: "Grounded dashboard facts", children: <div className="ai-grounding-content">{query.data.facts.map((fact) => <div className="ai-grounding-row" key={fact.key}><Typography.Text strong>{formatFactLabel(fact.label)}</Typography.Text><Typography.Text type="secondary">{Array.isArray(fact.value) ? fact.value.join(", ") : fact.value}</Typography.Text></div>)}<Typography.Text type="secondary">Sources: {query.data.citations.join(", ")}</Typography.Text></div> }]} /><Typography.Text type="secondary">Grounded in the current {dashboard.period.replace("_", " ")} KPI snapshot · {query.data.metadata.timezone}</Typography.Text></div> : null}
    </Modal>
  </>;
}
