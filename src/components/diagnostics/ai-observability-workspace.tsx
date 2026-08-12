"use client";

import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Drawer, Select, Table, Tag } from "antd";
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
  PROVIDER_TEST:
    "Configuration connectivity check. No business action is performed.",
  OPERATIONS_QUERY:
    "The model plans one approved tool call; application code retrieves structured data and formats the grounded answer.",
  OPERATIONAL_INSIGHT:
    "Deterministic dashboard facts are interpreted by the model and numeric claims are validated against cited facts.",
  WORKFLOW_EXPLANATION:
    "Deterministic workflow flags remain authoritative; the model only explains the flag and recommends human review.",
  DOCUMENT_UNDERSTANDING:
    "The model produces a schema-validated review draft. Explicit Admin confirmation is still required before order creation.",
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
    timeZone: "Asia/Kuala_Lumpur",
  }).format(new Date(value));
}

function executionHeadline(observation: AIObservationRecord) {
  const execution = observation.execution;
  if (observation.task === "OPERATIONS_QUERY") {
    const tool =
      execution.tool && typeof execution.tool === "object"
        ? (execution.tool as Record<string, unknown>)
        : null;
    const name =
      typeof tool?.name === "string" ? tool.name : execution.outcome;
    const count =
      typeof tool?.resultCount === "number"
        ? ` · ${tool.resultCount} records`
        : "";
    return `${String(name ?? "No tool")}${count}`;
  }
  if (observation.task === "OPERATIONAL_INSIGHT") {
    return execution.cached === true
      ? "Validated cache hit · no provider call required"
      : `${String(execution.citationCount ?? 0)} cited facts`;
  }
  if (observation.task === "WORKFLOW_EXPLANATION") {
    return `${String(execution.ruleCode ?? "Workflow flag")} · ${String(
      execution.explanationStatus ?? "unknown",
    )}`;
  }
  if (observation.task === "DOCUMENT_UNDERSTANDING") {
    return `${String(execution.extractionStatus ?? "Extraction")} · ${String(
      execution.mimeType ?? "document",
    )}`;
  }
  return execution.connectionOk === true
    ? "Connection verified"
    : "Connection test";
}

function providerLabel(observation: AIObservationRecord) {
  if (!observation.providerCalls.length) return "No provider call";
  return [...new Set(observation.providerCalls.map((call) => call.model))].join(
    ", ",
  );
}

function safeJson(value: unknown) {
  return (
    <pre className="diagnostics-json">{JSON.stringify(value, null, 2)}</pre>
  );
}

async function fetchObservations() {
  const response = await fetch("/api/diagnostics/ai-observability", {
    headers: { Accept: "application/json" },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String(
            (body as { error?: { message?: unknown } }).error?.message ??
              "AI observability is unavailable.",
          )
        : "AI observability is unavailable.";
    throw new Error(message);
  }
  return aiObservationListResponseSchema.parse(body);
}

function ProviderCalls({
  calls,
}: {
  calls: readonly AIProviderCallSummary[];
}) {
  const columns: ColumnsType<AIProviderCallSummary> = [
    {
      title: "Call",
      dataIndex: "sequence",
      width: 72,
      render: (value: number) => `#${value}`,
    },
    { title: "Model", dataIndex: "model", width: 190, ellipsis: true },
    {
      title: "Source",
      dataIndex: "providerSource",
      width: 110,
      render: (value: string | null) => value ?? "—",
    },
    { title: "Endpoint", dataIndex: "endpoint", ellipsis: true },
    {
      title: "Status",
      dataIndex: "statusCode",
      width: 96,
      render: (value: number) => (
        <Tag color={providerStatusColor(value)}>{value || "Network"}</Tag>
      ),
    },
    {
      title: "Latency",
      dataIndex: "durationMs",
      width: 100,
      align: "right",
      render: (value: number) => `${value} ms`,
    },
    {
      title: "Tokens",
      dataIndex: "usage",
      width: 112,
      align: "right",
      render: (value: AIProviderCallSummary["usage"]) =>
        value?.totalTokens ?? "—",
    },
  ];

  if (!calls.length) {
    return (
      <div className="diagnostics-empty-state">
        No provider call was required for this run.
      </div>
    );
  }

  return (
    <Table
      rowKey="sequence"
      size="small"
      pagination={false}
      columns={columns}
      dataSource={[...calls]}
      scroll={{ x: 880 }}
    />
  );
}

function ObservationDetails({
  observation,
  retentionDays,
}: {
  observation: AIObservationRecord;
  retentionDays: number;
}) {
  return (
    <div className="diagnostics-detail-grid">
      <section className="diagnostics-detail-section">
        <Alert
          type="info"
          showIcon={false}
          message={taskLabels[observation.task]}
          description={taskDescriptions[observation.task]}
        />
        <dl className="diagnostics-kv">
          <div>
            <dt>Trace ID</dt>
            <dd><code>{observation.traceId}</code></dd>
          </div>
          <div>
            <dt>Actor role</dt>
            <dd>{observation.actorRole}</dd>
          </div>
          <div>
            <dt>Run status</dt>
            <dd><Tag color={statusColor(observation.status)}>{observation.status}</Tag></dd>
          </div>
          <div>
            <dt>Total latency</dt>
            <dd>{observation.durationMs} ms</dd>
          </div>
          <div>
            <dt>Provider calls</dt>
            <dd>{observation.providerCalls.length}</dd>
          </div>
          <div>
            <dt>Error code</dt>
            <dd>{observation.errorCode ?? "—"}</dd>
          </div>
        </dl>
        <h3>Safe execution summary</h3>
        {safeJson(observation.execution)}
      </section>

      <section className="diagnostics-detail-section">
        <h3>Provider calls</h3>
        <ProviderCalls calls={observation.providerCalls} />
      </section>

      <section className="diagnostics-detail-section">
        <Alert
          type="success"
          showIcon={false}
          message="Metadata-only persistence"
          description="Central diagnostics keep execution metadata, provider/model/status/latency and token usage when supplied. Raw prompts, raw provider responses, credentials and extracted document field values are not persisted."
        />
        <dl className="diagnostics-kv">
          <div><dt>Raw prompt persisted</dt><dd>No</dd></div>
          <div><dt>Raw provider response persisted</dt><dd>No</dd></div>
          <div><dt>Credentials persisted</dt><dd>No</dd></div>
          <div><dt>Document field values persisted</dt><dd>No</dd></div>
          <div><dt>Retention</dt><dd>{retentionDays} days</dd></div>
        </dl>
      </section>
    </div>
  );
}

export function AIObservabilityWorkspace() {
  const [selected, setSelected] = useState<AIObservationRecord>();
  const [task, setTask] = useState<AIObservationTask>();
  const [status, setStatus] = useState<AIObservationStatus>();
  const query = useQuery({
    queryKey: ["diagnostics", "ai-observability"],
    queryFn: fetchObservations,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    retry: 1,
  });

  const observations = useMemo(
    () => query.data?.observations ?? [],
    [query.data?.observations],
  );
  const filtered = useMemo(
    () =>
      observations.filter((observation) => {
        if (task && observation.task !== task) return false;
        if (status && observation.status !== status) return false;
        return true;
      }),
    [observations, status, task],
  );

  const failures = observations.filter(
    (item) => item.status === "FAILED",
  ).length;
  const providerCalls = observations.reduce(
    (sum, item) => sum + item.providerCalls.length,
    0,
  );
  const averageLatency = observations.length
    ? Math.round(
        observations.reduce((sum, item) => sum + item.durationMs, 0) /
          observations.length,
      )
    : 0;

  const columns: ColumnsType<AIObservationRecord> = [
    { title: "Time", dataIndex: "createdAt", width: 104, render: timeLabel },
    {
      title: "Task",
      dataIndex: "task",
      width: 180,
      render: (value: AIObservationTask) => <Tag>{taskLabels[value]}</Tag>,
    },
    {
      title: "Status",
      dataIndex: "status",
      width: 108,
      render: (value: AIObservationStatus) => (
        <Tag color={statusColor(value)}>{value}</Tag>
      ),
    },
    {
      title: "Execution",
      key: "execution",
      ellipsis: true,
      render: (_, observation) => (
        <Button
          type="link"
          className="api-trace-route"
          onClick={() => setSelected(observation)}
        >
          {executionHeadline(observation)}
        </Button>
      ),
    },
    {
      title: "Provider / model",
      key: "provider",
      width: 210,
      ellipsis: true,
      render: (_, observation) => providerLabel(observation),
    },
    {
      title: "Latency",
      dataIndex: "durationMs",
      width: 104,
      align: "right",
      render: (value: number) => `${value} ms`,
    },
    {
      title: "Trace",
      dataIndex: "traceId",
      width: 126,
      render: (value: string) => <code>{value.slice(0, 8)}</code>,
    },
  ];

  return (
    <main className="diagnostics-workspace">
      <section className="modern-page-heading diagnostics-heading">
        <div>
          <span className="modern-eyebrow">Assessment diagnostics</span>
          <h1>AI observability</h1>
          <p>
            Central server-side evidence for how SejukOps AI features execute.
            This is a technical review surface, not a business role or production
            audit console.
          </p>
        </div>
        <div className="diagnostics-heading-actions">
          <Tag color="blue">Central trace store</Tag>
          <Button loading={query.isFetching} onClick={() => void query.refetch()}>
            Refresh
          </Button>
        </div>
      </section>

      <Alert
        className="diagnostics-boundary"
        type="info"
        showIcon={false}
        message="Observation boundary"
        description="Each supported AI route records its execution path and real provider call metadata on the server. Provider payload bodies are intentionally not persisted; the trace is designed to demonstrate controlled retrieval, grounding and human-in-the-loop boundaries without turning assessment diagnostics into a PII store."
      />

      <section className="diagnostics-stats" aria-label="AI observation summary">
        <div><span>AI runs</span><strong>{observations.length}</strong></div>
        <div><span>Provider calls</span><strong>{providerCalls}</strong></div>
        <div><span>Failures</span><strong>{failures}{observations.length ? ` / ${observations.length}` : ""}</strong></div>
        <div><span>Average latency</span><strong>{averageLatency} ms</strong></div>
      </section>

      <section className="diagnostics-toolbar">
        <Select
          allowClear
          placeholder="All AI tasks"
          value={task}
          onChange={setTask}
          options={AI_OBSERVATION_TASKS.map((value) => ({
            value,
            label: taskLabels[value],
          }))}
        />
        <Select
          allowClear
          placeholder="All statuses"
          value={status}
          onChange={setStatus}
          options={(["SUCCEEDED", "FAILED"] as AIObservationStatus[]).map(
            (value) => ({ value }),
          )}
        />
        <span className="diagnostics-toolbar-copy">
          Auto-refreshes every 5 seconds · {query.data?.retentionDays ?? 7}-day retention
        </span>
      </section>

      {query.isError ? (
        <Alert
          type="error"
          showIcon={false}
          message="AI observability unavailable"
          description={
            query.error instanceof Error
              ? query.error.message
              : "Unable to load technical diagnostics."
          }
        />
      ) : filtered.length ? (
        <section className="diagnostics-table">
          <Table
            rowKey="id"
            columns={columns}
            dataSource={[...filtered]}
            size="middle"
            pagination={{ pageSize: 12, showSizeChanger: false }}
            scroll={{ x: 980 }}
          />
        </section>
      ) : (
        <div className="diagnostics-empty-state diagnostics-empty-state-main">
          <strong>{query.isLoading ? "Loading AI traces…" : observations.length ? "No traces match these filters" : "No AI traces captured yet"}</strong>
          <span>
            Run Operations AI, an operational insight, workflow explanation,
            document extraction, or provider test to create evidence here.
          </span>
        </div>
      )}

      <Drawer
        className="api-observation-drawer"
        title={selected ? `${taskLabels[selected.task]} · ${selected.status}` : "AI observation"}
        width={900}
        open={Boolean(selected)}
        onClose={() => setSelected(undefined)}
        destroyOnHidden
      >
        {selected ? (
          <ObservationDetails
            observation={selected}
            retentionDays={query.data?.retentionDays ?? 7}
          />
        ) : null}
      </Drawer>
    </main>
  );
}
