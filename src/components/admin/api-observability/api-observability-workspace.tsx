"use client";

import {
  ApiOutlined,
  ClearOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import { Alert, Button, Drawer, Empty, Input, Select, Space, Statistic, Table, Tabs, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";

import {
  API_OBSERVATION_EVENT,
  API_OBSERVATION_LIMIT,
  apiObservationPaused,
  clearApiObservationEvents,
  readApiObservationEvents,
  setApiObservationPaused,
  type ApiObservationEvent,
  type ApiObservationScope,
} from "@/lib/observability/api-observation";
import { AIProviderTraces } from "./ai-provider-traces";

const methodColors: Readonly<Record<string, string>> = {
  GET: "blue",
  POST: "green",
  PUT: "gold",
  PATCH: "orange",
  DELETE: "red",
};
const scopeColors: Readonly<Record<ApiObservationScope, string>> = { ADMIN: "blue", MANAGER: "purple", TECHNICIAN: "cyan", SYSTEM: "default" };

function statusTone(status: number) {
  if (status === 0 || status >= 500) return "error";
  if (status >= 400) return "warning";
  if (status >= 300) return "processing";
  return "success";
}

function statusLabel(status: number) {
  return status === 0 ? "Network" : String(status);
}

function timeLabel(value: string) {
  return new Intl.DateTimeFormat("en-MY", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(value));
}

function JsonPanel({ value }: { value: unknown }) {
  return <pre className="api-trace-json">{JSON.stringify(value, null, 2)}</pre>;
}

export function ApiObservabilityWorkspace() {
  const [events, setEvents] = useState<ApiObservationEvent[]>([]);
  const [selected, setSelected] = useState<ApiObservationEvent>();
  const [search, setSearch] = useState("");
  const [method, setMethod] = useState<string>();
  const [scope, setScope] = useState<ApiObservationScope>();
  const [status, setStatus] = useState<string>();
  const [paused, setPaused] = useState(false);

  const refresh = () => {
    setEvents(readApiObservationEvents());
    setPaused(apiObservationPaused());
  };

  useEffect(() => {
    refresh();
    const handler = () => refresh();
    window.addEventListener(API_OBSERVATION_EVENT, handler);
    return () => window.removeEventListener(API_OBSERVATION_EVENT, handler);
  }, []);

  const filtered = useMemo(() => events.filter((event) => {
    const needle = search.trim().toLowerCase();
    if (needle && !`${event.route} ${event.traceId} ${event.method} ${event.scope}`.toLowerCase().includes(needle)) return false;
    if (method && event.method !== method) return false;
    if (scope && event.scope !== scope) return false;
    if (status === "success" && (event.statusCode < 200 || event.statusCode >= 400)) return false;
    if (status === "error" && event.statusCode !== 0 && event.statusCode < 400) return false;
    return true;
  }), [events, method, scope, search, status]);

  const errors = events.filter((event) => event.statusCode === 0 || event.statusCode >= 400).length;
  const averageLatency = events.length ? Math.round(events.reduce((sum, event) => sum + event.durationMs, 0) / events.length) : 0;
  const slowest = events.length ? Math.max(...events.map((event) => event.durationMs)) : 0;

  const columns: ColumnsType<ApiObservationEvent> = [
    { title: "Time", dataIndex: "createdAt", width: 105, render: timeLabel },
    { title: "Scope", dataIndex: "scope", width: 112, render: (value: ApiObservationScope) => <Tag color={scopeColors[value]}>{value}</Tag> },
    { title: "Method", dataIndex: "method", width: 92, render: (value: string) => <Tag color={methodColors[value] ?? "default"}>{value}</Tag> },
    { title: "Route", dataIndex: "route", ellipsis: true, render: (value: string, event) => <Button type="link" className="api-trace-route" onClick={() => setSelected(event)}>{value}</Button> },
    { title: "Status", dataIndex: "statusCode", width: 92, render: (value: number) => <Tag color={statusTone(value)}>{statusLabel(value)}</Tag> },
    { title: "Latency", dataIndex: "durationMs", width: 104, align: "right", render: (value: number) => `${value} ms` },
    { title: "Trace", dataIndex: "traceId", width: 128, render: (value: string) => <Typography.Text code>{value.slice(0, 8)}</Typography.Text> },
  ];

  const detailTabs = selected ? [
    { key: "request", label: "Request", children: <JsonPanel value={{ scope: selected.scope, method: selected.method, route: selected.route, query: selected.query, ...selected.request }} /> },
    { key: "response", label: "Response", children: <JsonPanel value={{ statusCode: selected.statusCode, statusText: selected.statusText, ...selected.response }} /> },
    { key: "metadata", label: "Metadata", children: <JsonPanel value={{ traceId: selected.traceId, createdAt: selected.createdAt, scope: selected.scope, durationMs: selected.durationMs, capture: "browser-session" }} /> },
  ] : [];

  return <main className="api-observability-page">
    <section className="modern-page-heading api-observability-heading">
      <div>
        <Typography.Text className="modern-eyebrow">System observation</Typography.Text>
        <Typography.Title level={1}>AI & API traces</Typography.Title>
        <Typography.Paragraph>Inspect the actual outbound AI provider request/response first, then correlate it with the SejukOps application API call that triggered it.</Typography.Paragraph>
      </div>
      <Space wrap>
        <Tag icon={<ApiOutlined />} color={paused ? "default" : "success"}>{paused ? "Capture paused" : "Live capture"}</Tag>
        <Button icon={paused ? <PlayCircleOutlined /> : <PauseCircleOutlined />} onClick={() => setApiObservationPaused(!paused)}>{paused ? "Resume" : "Pause"}</Button>
      </Space>
    </section>

    <Alert className="api-observability-notice" type="info" showIcon icon={<SafetyCertificateOutlined />} message="Safe observation boundary" description="AI provider traces show the JSON payload sent to the selected OpenAI-compatible endpoint and the raw JSON response, but Authorization/API keys and image/base64 content are redacted. Application traces still redact credentials, signed URLs, phone/address/email fields and binary bodies. Capture is session-local and is not a production audit log." />

    <AIProviderTraces />

    <section className="api-section-heading api-section-heading-compact">
      <div>
        <Typography.Text className="modern-eyebrow">Application correlation</Typography.Text>
        <Typography.Title level={3}>SejukOps API requests</Typography.Title>
        <Typography.Paragraph>Use the shared trace ID to correlate Browser → SejukOps API with the provider call(s) above.</Typography.Paragraph>
      </div>
    </section>

    <section className="api-observability-stats" aria-label="API trace summary">
      <div><Typography.Text>Requests</Typography.Text><Statistic value={events.length} /></div>
      <div><Typography.Text>Errors</Typography.Text><Statistic value={errors} suffix={events.length ? ` / ${events.length}` : undefined} /></div>
      <div><Typography.Text>Average latency</Typography.Text><Statistic value={averageLatency} suffix="ms" /></div>
      <div><Typography.Text>Slowest</Typography.Text><Statistic value={slowest} suffix="ms" /></div>
    </section>

    <section className="api-observability-toolbar">
      <Input.Search allowClear placeholder="Search route or trace ID" value={search} onChange={(event) => setSearch(event.target.value)} className="api-observability-search" />
      <Select allowClear placeholder="All methods" value={method} onChange={setMethod} options={["GET", "POST", "PUT", "PATCH", "DELETE"].map((value) => ({ value }))} />
      <Select allowClear placeholder="All scopes" value={scope} onChange={setScope} options={(["ADMIN", "MANAGER", "TECHNICIAN", "SYSTEM"] as ApiObservationScope[]).map((value) => ({ value }))} />
      <Select allowClear placeholder="All statuses" value={status} onChange={setStatus} options={[{ value: "success", label: "Success / redirect" }, { value: "error", label: "Errors" }]} />
      <Button icon={<ReloadOutlined />} onClick={refresh}>Refresh</Button>
      <Button danger icon={<ClearOutlined />} disabled={!events.length} onClick={() => { clearApiObservationEvents(); setSelected(undefined); }}>Clear API traces</Button>
    </section>

    <section className="api-observability-table">
      {filtered.length ? <Table rowKey="id" columns={columns} dataSource={filtered} size="middle" pagination={{ pageSize: 12, showSizeChanger: false }} scroll={{ x: 940 }} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={events.length ? "No traces match these filters" : "No API traces captured yet"}><Typography.Text type="secondary">Use Admin, Manager or Technician workflows in this browser tab. The latest {API_OBSERVATION_LIMIT} fetch requests are retained for this session.</Typography.Text></Empty>}
    </section>

    <Drawer className="api-observation-drawer" title={selected ? <Space><Tag color={scopeColors[selected.scope]}>{selected.scope}</Tag><Tag color={methodColors[selected.method] ?? "default"}>{selected.method}</Tag><span>{selected.route}</span></Space> : "API trace"} width={780} open={Boolean(selected)} onClose={() => setSelected(undefined)} destroyOnHidden extra={selected ? <Typography.Text copyable={{ text: selected.traceId }} code>{selected.traceId.slice(0, 8)}</Typography.Text> : null}>
      {selected ? <><div className="api-trace-summary"><Tag color={statusTone(selected.statusCode)}>{statusLabel(selected.statusCode)} {selected.statusText}</Tag><Typography.Text>{selected.durationMs} ms</Typography.Text><Typography.Text type="secondary">{new Date(selected.createdAt).toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" })} MYT</Typography.Text></div><Tabs items={detailTabs} /></> : null}
    </Drawer>
  </main>;
}
