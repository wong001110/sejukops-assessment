"use client";

import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Drawer, Select, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { StatusTag } from "@/components/shared/status-tag";
import {
  AI_OBSERVATION_TASKS,
  aiObservationListResponseSchema,
  type AIObservationRecord,
  type AIObservationStatus,
  type AIObservationTask,
} from "@/domain/ai-observability/contracts";

const taskLabels: Record<AIObservationTask, string> = {
  PROVIDER_TEST: "Provider test",
  OPERATIONS_QUERY: "Operations query",
  OPERATIONAL_INSIGHT: "Operational insight",
  WORKFLOW_EXPLANATION: "Workflow explanation",
  DOCUMENT_UNDERSTANDING: "Document understanding",
};
const statuses: AIObservationStatus[] = ["SUCCEEDED", "CONTROLLED", "FAILED"];

function safeJson(value: unknown) { return <pre className="diagnostics-json">{JSON.stringify(value, null, 2)}</pre>; }
function timeLabel(value: string) { return new Intl.DateTimeFormat("en-MY", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "Asia/Kuala_Lumpur" }).format(new Date(value)); }
function providerLabel(item: AIObservationRecord) { return item.providerCalls.length ? [...new Set(item.providerCalls.map((call) => call.model))].join(", ") : "No provider call"; }
function tokenSummary(item: AIObservationRecord) {
  let input = 0; let output = 0; let hasInput = false; let hasOutput = false;
  for (const call of item.providerCalls) { if (call.usage?.promptTokens !== null && call.usage?.promptTokens !== undefined) { input += call.usage.promptTokens; hasInput = true; } if (call.usage?.completionTokens !== null && call.usage?.completionTokens !== undefined) { output += call.usage.completionTokens; hasOutput = true; } }
  return hasInput || hasOutput ? `${hasInput ? input : "—"} in / ${hasOutput ? output : "—"} out` : "—";
}

async function fetchPage(query: { task?: AIObservationTask; status?: AIObservationStatus; page: number; pageSize: number }) {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) });
  if (query.task) params.set("task", query.task);
  if (query.status) params.set("status", query.status);
  const response = await fetch(`/api/diagnostics/ai-observability?${params}`, { headers: { Accept: "application/json" } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message ?? "AI observability is unavailable.");
  return aiObservationListResponseSchema.parse(body);
}

export function AIObservabilityPagedWorkspace() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const taskValue = params.get("task");
  const statusValue = params.get("status");
  const task = AI_OBSERVATION_TASKS.includes(taskValue as AIObservationTask) ? taskValue as AIObservationTask : undefined;
  const status = statuses.includes(statusValue as AIObservationStatus) ? statusValue as AIObservationStatus : undefined;
  const rawPage = Number(params.get("page") ?? "1");
  const rawPageSize = Number(params.get("pageSize") ?? "12");
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const pageSize = Number.isInteger(rawPageSize) && rawPageSize >= 5 && rawPageSize <= 100 ? rawPageSize : 12;
  const [selected, setSelected] = useState<AIObservationRecord>();

  const updateUrl = (patch: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) { if (value === undefined || value === "") next.delete(key); else next.set(key, String(value)); }
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const query = useQuery({
    queryKey: ["diagnostics", "ai-observability", task, status, page, pageSize],
    queryFn: () => fetchPage({ task, status, page, pageSize }),
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    retry: 1,
  });
  const observations = query.data?.observations ?? [];
  const summary = query.data?.summary;
  const pagination = query.data?.pagination;

  const columns = useMemo<ColumnsType<AIObservationRecord>>(() => [
    { title: "Time", dataIndex: "createdAt", width: 104, render: timeLabel },
    { title: "Task", dataIndex: "task", width: 180, render: (value: AIObservationTask) => <Tag>{taskLabels[value]}</Tag> },
    { title: "Status", dataIndex: "status", width: 118, render: (value: AIObservationStatus) => <StatusTag status={value} /> },
    { title: "Execution", key: "execution", ellipsis: true, render: (_, item) => <Button type="link" className="api-trace-route" onClick={() => setSelected(item)}>{String(item.execution.flow ?? item.execution.outcome ?? "Inspect trace")}</Button> },
    { title: "Provider / model", key: "provider", width: 210, ellipsis: true, render: (_, item) => providerLabel(item) },
    { title: "Tokens", key: "tokens", width: 158, align: "right", render: (_, item) => tokenSummary(item) },
    { title: "Latency", dataIndex: "durationMs", width: 104, align: "right", render: (value: number) => `${value} ms` },
    { title: "Trace", dataIndex: "traceId", width: 126, render: (value: string) => <code>{value.slice(0, 8)}</code> },
  ], []);

  return <main className="diagnostics-workspace">
    <section className="modern-page-heading diagnostics-heading"><div><span className="modern-eyebrow">Assessment diagnostics</span><h1>AI observability</h1><p>Central server-side evidence for how SejukOps AI features execute. Inspect controlled tool use, sanitized provider exchanges and the system prompt sent for each model call.</p></div><div className="diagnostics-heading-actions"><Tag color="blue">Central trace store</Tag><Button loading={query.isFetching} onClick={() => void query.refetch()}>Refresh</Button></div></section>
    <Alert className="diagnostics-boundary" type="info" showIcon={false} message="Observation boundary" description="No-tool outcomes such as clarification or unsupported scope are controlled outcomes, not failures. Provider payloads are sanitized before persistence; credentials and document contents remain excluded." />
    <section className="diagnostics-stats" aria-label="AI observation summary"><div><span>AI runs</span><strong>{summary?.runs ?? 0}</strong></div><div><span>Provider calls</span><strong>{summary?.providerCalls ?? 0}</strong></div><div><span>Controlled</span><strong>{summary?.controlled ?? 0}</strong></div><div><span>Failures</span><strong>{summary?.failures ?? 0}</strong></div><div><span>Average latency</span><strong>{summary?.averageLatency ?? 0} ms</strong></div></section>
    <section className="diagnostics-toolbar"><Select allowClear placeholder="All AI tasks" value={task} onChange={(value) => updateUrl({ task: value, page: 1 })} options={AI_OBSERVATION_TASKS.map((value) => ({ value, label: taskLabels[value] }))} /><Select allowClear placeholder="All statuses" value={status} onChange={(value) => updateUrl({ status: value, page: 1 })} options={statuses.map((value) => ({ value, label: value }))} /><span className="diagnostics-toolbar-copy">Auto-refreshes every 5 seconds · {query.data?.retentionDays ?? 7}-day retention</span></section>
    {query.isError ? <Alert type="error" showIcon={false} message="AI observability unavailable" description={query.error instanceof Error ? query.error.message : "Unable to load technical diagnostics."} /> : observations.length ? <section className="diagnostics-table"><Table rowKey="id" columns={columns} dataSource={observations} size="middle" pagination={{ current: pagination?.page ?? page, pageSize: pagination?.pageSize ?? pageSize, total: pagination?.total ?? 0, showSizeChanger: true, pageSizeOptions: [12, 24, 48, 96], showTotal: (total, range) => `${range[0]}–${range[1]} of ${total}`, onChange: (nextPage, nextPageSize) => updateUrl({ page: nextPageSize === pageSize ? nextPage : 1, pageSize: nextPageSize }) }} scroll={{ x: 1140 }} /></section> : <div className="diagnostics-empty-state diagnostics-empty-state-main"><strong>{query.isLoading ? "Loading AI traces…" : "No AI traces match these filters"}</strong><span>Run Operations AI, an operational insight, workflow explanation, document extraction, or provider test to create evidence here.</span></div>}
    <Drawer className="api-observation-drawer" title={selected ? `${taskLabels[selected.task]} · ${selected.status}` : "AI observation"} width={980} open={Boolean(selected)} onClose={() => setSelected(undefined)} destroyOnHidden>{selected ? <div className="diagnostics-detail-grid"><section className="diagnostics-detail-section"><Typography.Title level={4}>Execution trace</Typography.Title><p><strong>Trace:</strong> <code>{selected.traceId}</code> · <strong>Actor:</strong> {selected.actorRole} · <strong>Latency:</strong> {selected.durationMs} ms</p>{safeJson(selected.execution)}</section><section className="diagnostics-detail-section"><Typography.Title level={4}>Provider calls</Typography.Title>{selected.providerCalls.length ? selected.providerCalls.map((call) => <details className="diagnostics-debug-call" key={call.sequence} open={call.sequence === 1}><summary>Provider call #{call.sequence} · {call.model} · {call.durationMs} ms</summary><div className="diagnostics-debug-stack"><section><h4>System prompt</h4>{call.debug.systemPrompt ? <pre className="diagnostics-prompt">{call.debug.systemPrompt}</pre> : <div className="diagnostics-empty-state">No system prompt was sent.</div>}</section><section><h4>Provider request</h4>{safeJson(call.debug.requestBody)}</section><section><h4>Provider response</h4>{safeJson(call.debug.responseBody)}</section></div></details>) : <div className="diagnostics-empty-state">No provider call was required for this run.</div>}</section><section className="diagnostics-detail-section"><Alert type="success" showIcon={false} message="Sanitized debug persistence" description="Raw prompts/responses, credentials, image/base64 content and extracted document field values are not persisted." /></section></div> : null}</Drawer>
  </main>;
}
