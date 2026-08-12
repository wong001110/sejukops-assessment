"use client";

import {
  ApiOutlined,
  DatabaseOutlined,
  ReloadOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";

import {
  AI_OBSERVATION_TASKS,
  aiObservationListResponseSchema,
  type AIObservationRecord,
  type AIObservationStatus,
  type AIObservationTask,
  type AIProviderCallSummary,
} from "@/domain/ai-observability/contracts";

const taskLabels: Readonly<Record<AIObservationTask, string>> = {
  PROVIDER_TEST: "Provider test",
  OPERATIONS_QUERY: "Operations query",
  OPERATIONAL_INSIGHT: "Operational insight",
  WORKFLOW_EXPLANATION: "Workflow explanation",
  DOCUMENT_UNDERSTANDING: "Document understanding",
};

const taskDescriptions: Readonly<Record<AIObservationTask, string>> = {
  PROVIDER_TEST: "Configuration connectivity check. No business action is performed.",
  OPERATIONS_QUERY: "The model plans one approved tool call; application code retrieves structured data and formats the grounded answer.",
  OPERATIONAL_INSIGHT: "Deterministic dashboard facts are interpreted by the model and numeric claims are validated against cited facts.",
  WORKFLOW_EXPLANATION: "Deterministic workflow flags remain authoritative; the model only explains the flag and recommends human review.",
  DOCUMENT_UNDERSTANDING: "The model produces a schema-validated review draft. Explicit Admin confirmation is still required before order creation.",
};

function statusColor(status: AIObservationStatus) {
  return status === "SUCCEEDED" ? "success" : "error";
}

function providerStatusColor(status: number) {
  if (status === 0 || status >= 500) return "error";
  if (status >= 400) return "warning";
  return "success";
}

function timeLabel(value: string) {
  return new Intl.DateTimeFormat("en-MY", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function executionHeadline(observation: AIObservationRecord) {
  const execution = observation.execution;
  if (observation.task === "OPERATIONS_QUERY") {
    const tool = execution.tool && typeof execution.tool === "object"
      ? (execution.tool as Record<string, unknown>)
      : null;
    const name = typeof tool?.name === "string" ? tool.name : execution.outcome;
    const count = typeof tool?.resultCount === "number" ? ` · ${tool.resultCount} records` : "";
    return `${String(name ?? "No tool")}${count}`;
  }
  if (observation.task === "OPERATIONAL_INSIGHT") {
    return execution.cached === true
      ? "Validated cache hit · no provider call required"
      : `${String(execution.citationCount ?? 0)} cited facts`;
  }
  if (observation.task === "WORKFLOW_EXPLANATION") {
    return `${String(execution.ruleCode ?? "Workflow flag")} · ${String(execution.explanationStatus ?? "unknown")}`;
  }
  if (observation.task === "DOCUMENT_UNDERSTANDING") {
    return `${String(execution.extractionStatus ?? "Extraction")} · ${String(execution.mimeType ?? "document")}`;
  }
  return execution.connectionOk === true ? "Connection verified" : "Connection test";
}

function providerLabel(observation: AIObservationRecord) {
  if (!observation.providerCalls.length) return "No provider call";
  const models = [...new Set(observation.providerCalls.map((call) => call.model))];
  return models.join(", ");
}

function safeJson(value: unknown) {
  return <pre className="diagnostics-json">{JSON.stringify(value, null, 2)}</pre>;
}

async function fetchObservations() {
  const response = await fetch("/api/diagnostics/ai-observability", {
    headers: { Accept: "application/json" },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body
      ? String((body as { error?: { message?: unknown } }).error?.message ?? "AI observability is unavailable.")
      : "AI observability is unavailable.";
    throw new Error(message);
  }
  return aiObservationListResponseSchema.parse(body);
}

function ProviderCalls({ calls }: { calls: readonly AIProviderCallSummary[] }) {
  const columns: ColumnsType<AIProviderCallSummary> = [
    { title: "Call", dataIndex: "sequence", width: 72, render: (value: number) => `#${value}` },
    { title: "Model", dataIndex: "model", width: 190, ellipsis: true },
    { title: "Endpoint", dataIndex: "endpoint", ellipsis: true },
    {
      title: "Status",
      dataIndex: "statusCode",
      width: 96,
      render: (value: number) => <Tag color={providerStatusColor(value)}>{value || "Network"}</Tag>,
    },
    { title: "Latency", dataIndex: "durationMs", width: 100, align: "right", render: (value: number) => `${value} ms` },
    {
      title: "Tokens",
      dataIndex: "usage",
      width: 112,
      align: "right",
      render: (value: AIProviderCallSummary["usage"]) => value?.totalTokens ?? "—",
    },
  ];

  if (!calls.length) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No provider call was required for this run" />;
  }
  return <Table rowKey="sequence" size="small" pagination={false} columns={columns} dataSource={[...calls]} scroll={{ x: 760 }} />;
}

export function AIObservabilityWorkspace() {
  const [selected, setSelected] = useState<AIObservationRecord>();
  const [task, setTask] = useState<AIObservationTask>();
  const [status, setStatus] = useState<AIObservationStatus>();
  const query = useQuery({
    queryKey: ["diagnostics", "ai-observability"],
    queryFn: fetchObservations,
    refetchInterval: 5_000,
  });

  const observations = query.data?.observations ?? [];
  const filtered = useMemo(
    () => observations.filter((observation) => {
      if (task && observation.task !== task) return false;
      if (status && observation.status !== status) return false;
      return true;
    }),
    [observations, status, task],
  );
  const failures = observations.filter((item) => item.status === "FAILED").length;
  const providerCalls = observations.reduce((sum, item) => sum + item.providerCalls.length, 0);
  const averageLatency = observations.length
    ? Math.round(observations.reduce((sum, item) => sum + item.durationMs, 0) / observations.length)
    : 0;

  const columns: ColumnsType<AIObservationRecord> = [
    { title: "Time", dataIndex: "createdAt", width: 104, render: timeLabel },
    {
      title: "Task",
      dataIndex: "task",
      width: 180,
      render: (value: AIObservationTask) => <Tag icon={<RobotOutlined />}>{taskLabels[value]}</Tag>,
    },
    {
      title: "Status",
      dataIndex: "status",
      width: 108,
      render: (value: AIObservationStatus) => <Tag color={statusColor(value)}>{value}</Tag>,
    },
    {
      title: "Execution",
      key: "execution",
      ellipsis: true,
      render: (_, observation) => (
        <Button type="link" className="api-trace-route" onClick={() => setSelected(observation)}>
          {executionHeadline(observation)}
        </Button>
      ),
    },
    { title: "Provider / model", key: "provider", width: 210, ellipsis: true, render: (_, observation) => providerLabel(observation) },
    { title: "Latency", dataIndex: "durationMs", width: 104, align: "right", render: (value: number) => `${value} ms` },
    { title: "Trace", dataIndex: "traceId", width: 126, render: (value: string) => <Typography.Text code>{value.slice(0, 8)}</Typography.Text> },
  ];

  const drawerTabs = selected
    ? [
        {
          key: "execution",
          label: "Execution trace",
          children: (
            <div className="diagnostics-drawer-stack">
              <Alert
                type="info"
                showIcon
                icon={<DatabaseOutlined />}
                message={taskLabels[selected.task]}
                description={taskDescriptions[selected.task]}
              />
              <Descriptions bordered size="small" column={1}>
                <Descriptions.Item label="Trace ID"><Typography.Text copyable code>{selected.traceId}</Typography.Text></Descriptions.Item>
                <Descriptions.Item label="Actor role">{selected.actorRole}</Descriptions.Item>
                <Descriptions.Item label="Run status"><Tag color={statusColor(selected.status)}>{selected.status}</Tag></Descriptions.Item>
                <Descriptions.Item label="Total latency">{selected.durationMs} ms</Descriptions.Item>
                <Descriptions.Item label="Provider calls">{selected.providerCalls.length}</Descriptions.Item>
                <Descriptions.Item label="Error code">{selected.errorCode ?? "—"}</Descriptions.Item>
              </Descriptions>
              <Typography.Title level={5}>Safe execution summary</Typography.Title>
              {safeJson(selected.execution)}
            </div>
          ),
        },
        {
          key: "provider",
          label: "Provider calls",
          children: <ProviderCalls calls={selected.providerCalls} />,
        },
        {
          key: "safety",
          label: "Safety & retention",
          children: (
            <div className="diagnostics-drawer-stack">
              <Alert
                type="success"
                showIcon
                icon={<SafetyCertificateOutlined />}
                message="Metadata-only persistence"
                description="Central diagnostics keep execution metadata, provider/model/status/latency and token usage when supplied. Raw prompts, raw provider responses, credentials and extracted document field values are not persisted."
              />
              <Descriptions bordered size="small" column={1}>
                <Descriptions.Item label="Raw prompt persisted">No</Descriptions.Item>
                <Descriptions.Item label="Raw provider response persisted">No</Descriptions.Item>
                <Descriptions.Item label="Credentials persisted">No</Descriptions.Item>
                <Descriptions.Item label="Document field values persisted">No</Descriptions.Item>
                <Descriptions.Item label="Retention">{query.data?.retentionDays ?? 7} days</Descriptions.Item>
              </Descriptions>
            </div>
          ),
        },
      ]
    : [];

  return (
    <main className="diagnostics-workspace">
      <section className="modern-page-heading diagnostics-heading">
        <div>
          <Typography.Text className="modern-eyebrow">Assessment diagnostics</Typography.Text>
          <Typography.Title level={1}>AI observability</Typography.Title>
          <Typography.Paragraph>
            Central server-side evidence for how SejukOps AI features execute. This is a technical review surface, not a business role or production audit console.
          </Typography.Paragraph>
        </div>
        <Space wrap>
          <Tag icon={<DatabaseOutlined />} color="blue">Central trace store</Tag>
          <Button icon={<ReloadOutlined />} loading={query.isFetching} onClick={() => void query.refetch()}>Refresh</Button>
        </Space>
      </section>

      <Alert
        className="diagnostics-boundary"
        type="info"
        showIcon
        icon={<SafetyCertificateOutlined />}
        message="Observation boundary"
        description="Each supported AI route records its execution path and real provider call metadata on the server. Provider payload bodies are intentionally not persisted; the trace is designed to demonstrate controlled retrieval, grounding and human-in-the-loop boundaries without turning assessment diagnostics into a PII store."
      />

      <section className="api-observability-stats diagnostics-stats" aria-label="AI observation summary">
        <div><Typography.Text>AI runs</Typography.Text><Statistic value={observations.length} /></div>
        <div><Typography.Text>Provider calls</Typography.Text><Statistic value={providerCalls} /></div>
        <div><Typography.Text>Failures</Typography.Text><Statistic value={failures} suffix={observations.length ? ` / ${observations.length}` : undefined} /></div>
        <div><Typography.Text>Average latency</Typography.Text><Statistic value={averageLatency} suffix="ms" /></div>
      </section>

      <section className="diagnostics-toolbar">
        <Select
          allowClear
          placeholder="All AI tasks"
          value={task}
          onChange={setTask}
          options={AI_OBSERVATION_TASKS.map((value) => ({ value, label: taskLabels[value] }))}
        />
        <Select
          allowClear
          placeholder="All statuses"
          value={status}
          onChange={setStatus}
          options={(["SUCCEEDED", "FAILED"] as AIObservationStatus[]).map((value) => ({ value }))}
        />
        <Typography.Text type="secondary">
          Auto-refreshes every 5 seconds · {query.data?.retentionDays ?? 7}-day retention
        </Typography.Text>
      </section>

      {query.isError ? (
        <Alert type="error" showIcon message="AI observability unavailable" description={query.error instanceof Error ? query.error.message : "Unable to load technical diagnostics."} />
      ) : filtered.length ? (
        <section className="diagnostics-table">
          <Table rowKey="id" columns={columns} dataSource={[...filtered]} size="middle" pagination={{ pageSize: 12, showSizeChanger: false }} scroll={{ x: 980 }} />
        </section>
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={query.isLoading ? "Loading AI traces…" : observations.length ? "No traces match these filters" : "No AI traces captured yet"}>
          <Typography.Text type="secondary">Run Operations AI, an operational insight, workflow explanation, document extraction, or provider test to create evidence here.</Typography.Text>
        </Empty>
      )}

      <Drawer
        className="api-observation-drawer"
        title={selected ? <Space><ApiOutlined /><span>{taskLabels[selected.task]}</span><Tag color={statusColor(selected.status)}>{selected.status}</Tag></Space> : "AI observation"}
        width={860}
        open={Boolean(selected)}
        onClose={() => setSelected(undefined)}
        destroyOnHidden
      >
        {selected ? <Tabs items={drawerTabs} /> : null}
      </Drawer>
    </main>
  );
}
