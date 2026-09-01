"use client";

import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Drawer, Select, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";

import { StatusTag } from "@/components/shared/status-tag";
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
    "The model may select one approved tool, request clarification, or return a controlled unsupported outcome. Application code alone executes approved data tools.",
  OPERATIONAL_INSIGHT:
    "Deterministic dashboard facts are interpreted by the model and numeric claims are validated against cited facts.",
  WORKFLOW_EXPLANATION:
    "Deterministic workflow flags remain authoritative; the model only explains the flag and recommends human review.",
  DOCUMENT_UNDERSTANDING:
    "The model produces a schema-validated review draft. Explicit Admin confirmation is still required before order creation.",
};

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
    return `${String(name ?? "Controlled no-tool outcome")}${count}`;
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

type TokenTotals = Readonly<{
  input: number | null;
  output: number | null;
  total: number | null;
}>;

function tokenTotals(calls: readonly AIProviderCallSummary[]): TokenTotals {
  let input = 0;
  let output = 0;
  let total = 0;
  let hasInput = false;
  let hasOutput = false;
  let hasTotal = false;

  for (const call of calls) {
    const usage = call.usage;
    if (!usage) continue;
    if (usage.promptTokens !== null) {
      input += usage.promptTokens;
      hasInput = true;
    }
    if (usage.completionTokens !== null) {
      output += usage.completionTokens;
      hasOutput = true;
    }
    if (usage.totalTokens !== null) {
      total += usage.totalTokens;
      hasTotal = true;
    }
  }

  const resolvedInput = hasInput ? input : null;
  const resolvedOutput = hasOutput ? output : null;
  const resolvedTotal = hasTotal
    ? total
    : resolvedInput !== null && resolvedOutput !== null
      ? resolvedInput + resolvedOutput
      : null;

  return {
    input: resolvedInput,
    output: resolvedOutput,
    total: resolvedTotal,
  };
}

function tokenSummary(observation: AIObservationRecord) {
  const usage = tokenTotals(observation.providerCalls);
  if (usage.input === null && usage.output === null) return "—";
  return `${usage.input ?? "—"} in / ${usage.output ?? "—"} out`;
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
      title: "Input",
      dataIndex: "usage",
      width: 92,
      align: "right",
      render: (value: AIProviderCallSummary["usage"]) =>
        value?.promptTokens ?? "—",
    },
    {
      title: "Output",
      dataIndex: "usage",
      width: 92,
      align: "right",
      render: (value: AIProviderCallSummary["usage"]) =>
        value?.completionTokens ?? "—",
    },
    {
      title: "Total",
      dataIndex: "usage",
      width: 92,
      align: "right",
      render: (value: AIProviderCallSummary["usage"]) =>
        value?.totalTokens ??
        (value?.promptTokens !== null && value?.promptTokens !== undefined &&
        value?.completionTokens !== null && value?.completionTokens !== undefined
          ? value.promptTokens + value.completionTokens
          : "—"),
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
      scroll={{ x: 1120 }}
    />
  );
}

function ProviderDebug({ call }: { call: AIProviderCallSummary }) {
  return (
    <details className="diagnostics-debug-call" open={call.sequence === 1}>
      <summary>
        Provider call #{call.sequence} · {call.model}
      </summary>
      <div className="diagnostics-debug-stack">
        <section>
          <h4>System prompt</h4>
          {call.debug.systemPrompt ? (
            <pre className="diagnostics-prompt">{call.debug.systemPrompt}</pre>
          ) : (
            <div className="diagnostics-empty-state">No system prompt was sent for this call.</div>
          )}
        </section>
        <section>
          <h4>Request metadata</h4>
          {safeJson(call.debug.requestBody)}
        </section>
        <section>
          <h4>Response metadata</h4>
          {safeJson(call.debug.responseBody)}
        </section>
        {call.debug.documentPayloadOmitted ? (
          <Alert
            type="info"
            showIcon={false}
            message="Document payload redacted"
            description="The system prompt remains visible, but document/user content and extracted response values are omitted from persistent diagnostics."
          />
        ) : null}
      </div>
    </details>
  );
}

function ObservationDetails({
  observation,
  retentionDays,
}: {
  observation: AIObservationRecord;
  retentionDays: number;
}) {
  const usage = tokenTotals(observation.providerCalls);

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
            <dd><StatusTag status={observation.status} /></dd>
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
          <div>
            <dt>Input tokens</dt>
            <dd>{usage.input ?? "—"}</dd>
          </div>
          <div>
            <dt>Output tokens</dt>
            <dd>{usage.output ?? "—"}</dd>
          </div>
          <div>
            <dt>Total tokens</dt>
            <dd>{usage.total ?? "—"}</dd>
          </div>
        </dl>
        <h3>Execution trace</h3>
        {safeJson(observation.execution)}
      </section>

      <section className="diagnostics-detail-section">
        <h3>Provider calls</h3>
        <ProviderCalls calls={observation.providerCalls} />
      </section>

      {observation.providerCalls.length ? (
        <section className="diagnostics-detail-section">
          <h3>Provider metadata</h3>
          <p className="diagnostics-detail-copy">
            These are sanitized snapshots of the actual provider exchange. Credentials are never included.
          </p>
          <div className="diagnostics-debug-list">
            {observation.providerCalls.map((call) => (
              <ProviderDebug key={call.sequence} call={call} />
            ))}
          </div>
        </section>
      ) : (
        <section className="diagnostics-detail-section">
          <h3>Provider metadata</h3>
          <div className="diagnostics-empty-state">
            This run intentionally made no provider call, so there is no provider request, response, or system prompt snapshot.
          </div>
        </section>
      )}

      <section className="diagnostics-detail-section">
        <Alert
          type="success"
          showIcon={false}
          message="Sanitized debug persistence"
          description="Diagnostics retain only provider metadata such as model, message count, response shape and usage. Prompts, provider response text, credentials, image/base64 content and extracted document field values are not persisted."
        />
        <dl className="diagnostics-kv">
          <div><dt>Raw prompt persisted</dt><dd>No</dd></div>
          <div><dt>Raw provider response persisted</dt><dd>No</dd></div>
          <div><dt>Sanitized debug payload persisted</dt><dd>Yes</dd></div>
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
  const controlled = observations.filter(
    (item) => item.status === "CONTROLLED",
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
      width: 118,
      render: (value: AIObservationStatus) => <StatusTag status={value} />,
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
      title: "Tokens",
      key: "tokens",
      width: 158,
      align: "right",
      render: (_, observation) => tokenSummary(observation),
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
            Inspect controlled tool use and safe provider-call metadata without
            retaining prompt or response content.
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
        description="No-tool outcomes such as clarification or unsupported scope are controlled outcomes, not failures. Provider payloads are sanitized before persistence; credentials and document contents remain excluded."
      />

      <section className="diagnostics-stats" aria-label="AI observation summary">
        <div><span>AI runs</span><strong>{observations.length}</strong></div>
        <div><span>Provider calls</span><strong>{providerCalls}</strong></div>
        <div><span>Controlled</span><strong>{controlled}</strong></div>
        <div><span>Failures</span><strong>{failures}</strong></div>
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
          options={(["SUCCEEDED", "CONTROLLED", "FAILED"] as AIObservationStatus[]).map(
            (value) => ({ value, label: value }),
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
            scroll={{ x: 1140 }}
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
        width={980}
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
