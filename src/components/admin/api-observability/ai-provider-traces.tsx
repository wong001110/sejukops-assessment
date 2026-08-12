"use client";

import { ClearOutlined, RobotOutlined } from "@ant-design/icons";
import { Button, Drawer, Empty, Space, Table, Tabs, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";

import {
  AI_PROVIDER_OBSERVATION_EVENT,
  AI_PROVIDER_OBSERVATION_LIMIT,
  clearAIProviderExchanges,
  readAIProviderExchanges,
  type AIProviderExchangeView,
} from "@/lib/observability/ai-provider-observation-client";

const taskLabels: Readonly<Record<AIProviderExchangeView["task"], string>> = {
  PROVIDER_TEST: "Provider test",
  OPERATIONS_QUERY: "Operations query",
  OPERATIONAL_INSIGHT: "Operational insight",
  WORKFLOW_EXPLANATION: "Workflow explanation",
  DOCUMENT_UNDERSTANDING: "Document understanding",
};

function statusColor(status: number) {
  if (status === 0 || status >= 500) return "error";
  if (status >= 400) return "warning";
  return "success";
}

function timeLabel(value: string) {
  return new Intl.DateTimeFormat("en-MY", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(value));
}

function endpointLabel(value: string) {
  try {
    const url = new URL(value);
    return `${url.host}${url.pathname}`;
  } catch {
    return value;
  }
}

function JsonPanel({ value }: { value: unknown }) {
  return <pre className="api-trace-json ai-provider-json">{JSON.stringify(value, null, 2)}</pre>;
}

export function AIProviderTraces() {
  const [exchanges, setExchanges] = useState<AIProviderExchangeView[]>([]);
  const [selected, setSelected] = useState<AIProviderExchangeView>();

  const refresh = () => setExchanges(readAIProviderExchanges());
  useEffect(() => {
    refresh();
    const handler = () => refresh();
    window.addEventListener(AI_PROVIDER_OBSERVATION_EVENT, handler);
    return () => window.removeEventListener(AI_PROVIDER_OBSERVATION_EVENT, handler);
  }, []);

  const summary = useMemo(() => ({
    calls: exchanges.length,
    errors: exchanges.filter((item) => item.statusCode === 0 || item.statusCode >= 400).length,
    average: exchanges.length ? Math.round(exchanges.reduce((sum, item) => sum + item.durationMs, 0) / exchanges.length) : 0,
  }), [exchanges]);

  const columns: ColumnsType<AIProviderExchangeView> = [
    { title: "Time", dataIndex: "createdAt", width: 102, render: timeLabel },
    { title: "Task", dataIndex: "task", width: 170, render: (value: AIProviderExchangeView["task"]) => <Tag icon={<RobotOutlined />}>{taskLabels[value]}</Tag> },
    { title: "Call", dataIndex: "sequence", width: 72, render: (value: number) => `#${value}` },
    { title: "Model", dataIndex: "model", width: 180, ellipsis: true },
    { title: "Provider endpoint", dataIndex: "endpoint", ellipsis: true, render: (value: string, record) => <Button type="link" className="api-trace-route" onClick={() => setSelected(record)}>{endpointLabel(value)}</Button> },
    { title: "Status", dataIndex: "statusCode", width: 88, render: (value: number) => <Tag color={statusColor(value)}>{value || "Network"}</Tag> },
    { title: "Latency", dataIndex: "durationMs", width: 100, align: "right", render: (value: number) => `${value} ms` },
    { title: "Trace", dataIndex: "appTraceId", width: 116, render: (value: string) => <Typography.Text code>{value.slice(0, 8)}</Typography.Text> },
  ];

  return <section className="ai-provider-traces" aria-label="AI provider HTTP exchanges">
    <div className="api-section-heading">
      <div>
        <Typography.Text className="modern-eyebrow">AI provider observation</Typography.Text>
        <Typography.Title level={3}>Provider request / response</Typography.Title>
        <Typography.Paragraph>Shows the actual JSON payload sent from the SejukOps server to the selected OpenAI-compatible provider and the provider&apos;s raw JSON response. Authorization and image/base64 data are never exposed.</Typography.Paragraph>
      </div>
      <Space wrap>
        <Tag color="blue">{summary.calls} calls</Tag>
        <Tag color={summary.errors ? "warning" : "success"}>{summary.errors} errors</Tag>
        <Tag>{summary.average} ms avg</Tag>
        <Button danger icon={<ClearOutlined />} disabled={!exchanges.length} onClick={() => { clearAIProviderExchanges(); setSelected(undefined); }}>Clear AI traces</Button>
      </Space>
    </div>

    <div className="api-observability-table ai-provider-trace-table">
      {exchanges.length ? <Table rowKey="id" columns={columns} dataSource={exchanges} size="middle" pagination={{ pageSize: 10, showSizeChanger: false }} scroll={{ x: 1040 }} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No AI provider calls captured yet"><Typography.Text type="secondary">Run AI Operations, Open insight, Explain this flag, Document Understanding, or Test Connection. Up to {AI_PROVIDER_OBSERVATION_LIMIT} sanitized provider exchanges are kept in this browser session.</Typography.Text></Empty>}
    </div>

    <Drawer className="api-observation-drawer" width={860} open={Boolean(selected)} onClose={() => setSelected(undefined)} destroyOnHidden title={selected ? <Space><Tag icon={<RobotOutlined />}>{taskLabels[selected.task]}</Tag><strong>Provider call #{selected.sequence}</strong></Space> : "AI provider exchange"} extra={selected ? <Typography.Text copyable={{ text: selected.appTraceId }} code>{selected.appTraceId.slice(0, 8)}</Typography.Text> : null}>
      {selected ? <>
        <div className="api-trace-summary">
          <Tag color={statusColor(selected.statusCode)}>{selected.statusCode || "Network"} {selected.statusText}</Tag>
          <Typography.Text>{selected.model}</Typography.Text>
          <Typography.Text>{selected.durationMs} ms</Typography.Text>
        </div>
        <Tabs defaultActiveKey="request" items={[
          { key: "request", label: "Provider Request", children: <JsonPanel value={{ endpoint: selected.endpoint, method: selected.method, headers: selected.request.headers, body: selected.request.body }} /> },
          { key: "response", label: "Provider Response", children: <JsonPanel value={{ statusCode: selected.statusCode, statusText: selected.statusText, headers: selected.response.headers, body: selected.response.body, error: selected.error }} /> },
          { key: "metadata", label: "Metadata", children: <JsonPanel value={{ task: selected.task, sequence: selected.sequence, appTraceId: selected.appTraceId, providerType: selected.providerType, providerSource: selected.providerSource, model: selected.model, endpoint: selected.endpoint, createdAt: selected.createdAt, durationMs: selected.durationMs }} /> },
        ]} />
      </> : null}
    </Drawer>
  </section>;
}
