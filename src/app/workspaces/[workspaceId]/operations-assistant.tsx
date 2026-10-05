"use client";

import { RobotOutlined } from "@ant-design/icons";
import { Alert, Button, Drawer, FloatButton, Input } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AppRole } from "@/lib/auth/types";
import type { OperationsAskResult } from "@/lib/ai/runtime/operations-ask";
import { useLatestRequest } from "@/lib/ui/use-latest-request";
import { formatMalaysiaDateTime } from "@/lib/time/malaysia";
import "./operations-assistant.css";

export function OperationsAssistant({ workspaceId, role, canUseAi, isGuest, readOnly }: {
  workspaceId: string; role: AppRole; canUseAi: boolean; isGuest: boolean; readOnly: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  if ((!canUseAi && role !== "TECHNICIAN") || readOnly) return null;
  return <>
    <FloatButton type="primary" shape="square" icon={<RobotOutlined aria-hidden />}
      description="Ask AI" aria-label="Open Operations Ask AI" aria-expanded={open}
      className={`operations-assistant-button${role === "TECHNICIAN" ? " operations-assistant-button-tech" : ""}`}
      onClick={() => setOpen((current) => !current)} />
    <Drawer open={open} placement="right" width={460} mask={false}
      title="Operations · Ask AI" rootClassName={`operations-assistant-drawer${role === "TECHNICIAN" ? " operations-assistant-drawer-tech" : ""}`}
      onClose={() => setOpen(false)} extra={<Button onClick={() => setRevision((current) => current + 1)}>Start over</Button>}>
      {open && <OperationsAskPanel key={`${workspaceId}:${role}:${isGuest}:${revision}`} workspaceId={workspaceId} role={role} isGuest={isGuest} />}
    </Drawer>
  </>;
}

function OperationsAskPanel({ workspaceId, role, isGuest }: { workspaceId: string; role: AppRole; isGuest: boolean }) {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<Omit<OperationsAskResult, "providerSteps" | "usage"> & { traceId: string }>();
  const [error, setError] = useState("");
  const [state, setState] = useState<"idle" | "running" | "ready" | "cancelled" | "error">("idle");
  const requests = useLatestRequest();
  const router = useRouter();
  async function ask() {
    if (!question.trim() || requests.pending()) return;
    const current = requests.begin();
    setState("running"); setResult(undefined); setError("");
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/operations/ask`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question.trim() }), signal: current.signal,
      });
      if (!response.ok) {
        const detail = await response.json() as { error?: string; resetAt?: string | null };
        const reset = response.status === 429 && detail.resetAt && Number.isFinite(Date.parse(detail.resetAt))
          ? ` Resets ${formatMalaysiaDateTime(detail.resetAt)} Malaysia time.` : "";
        throw new Error(`${detail.error ?? "Operations AI is unavailable. Search manually."}${reset}`);
      }
      const body = await response.json() as NonNullable<typeof result>;
      if (!current.isCurrent()) return;
      setResult(body); setState("ready");
    } catch (cause) {
      if (!current.isCurrent()) return;
      setError(cause instanceof Error ? cause.message : "Operations AI is unavailable. Search manually."); setState("error");
    } finally {
      const active = current.isCurrent(); current.finish();
      if (isGuest && active) router.refresh();
    }
  }
  function cancel() { requests.cancel(); setState("cancelled"); if (isGuest) router.refresh(); }
  const base = `/workspaces/${workspaceId}`;
  return <div className="operations-assistant-content">
    <p className="product-muted">{role === "TECHNICIAN" ? "Ask about your assigned jobs or published workspace knowledge." : "Ask about orders visible to your role or published workspace knowledge."} AI reads sources; make operational changes on the relevant page.</p>
    <p className="product-muted">Searches up to 20 recent visible orders and published keyword knowledge. Shows up to five matching orders and three cited excerpts.</p>
    <label className="workspace-field" htmlFor="operations-question">Question
      <Input.TextArea id="operations-question" rows={3} maxLength={120} value={question} disabled={state === "running"}
        placeholder={role === "TECHNICIAN" ? "Which jobs need attention, or how should a filter be cleaned?" : "Which orders need attention, or how should a filter be cleaned?"}
        onChange={(event) => { setQuestion(event.target.value); setResult(undefined); setState("idle"); }} />
    </label>
    <div className="workspace-action-row product-note">
      <Button type="primary" aria-label="Ask AI" disabled={state === "running" || !question.trim()} loading={state === "running"} onClick={() => void ask()}>Ask AI</Button>
      {state === "running" && <Button onClick={cancel}>Cancel</Button>}
    </div>
    {state === "running" && <Alert type="info" showIcon message="Checking scoped orders and published knowledge…" />}
    {state === "cancelled" && <Alert type="info" showIcon message="Request cancelled. You can retry or search manually." />}
    {state === "error" && <Alert type="error" showIcon message={error} />}
    {state === "ready" && result && <>
      <Alert type="info" showIcon message={result.answer} />
      {result.orders.length > 0 && <section aria-label="Orders from scoped evidence" className="product-note">
        <h3>{role === "TECHNICIAN" ? "Your assigned jobs" : "Orders from scoped evidence"}</h3>
        <ul className="workspace-results">{result.orders.map((order) => <li key={order.id} className="workspace-result">
          <strong>{order.order_no}</strong> · {order.status}
          <p>{order.problem_description}</p>
          <p className="product-muted">Schedule: {order.scheduled_at ? formatMalaysiaDateTime(order.scheduled_at) : "Not scheduled"} · {order.assigned_technician_id ? "Technician assigned" : "No technician assigned"}</p>
          <Link href={`${base}/orders?orderId=${encodeURIComponent(order.id)}`}>View {order.order_no}</Link>
        </li>)}</ul>
      </section>}
      {result.excerpts.length > 0 && <section aria-label="Cited knowledge excerpts" className="product-note">
        <h3>Published knowledge</h3>
        <ol className="workspace-results">{result.excerpts.map((excerpt, index) => <li className="workspace-result" key={`${excerpt.citation.versionId}:${excerpt.citation.ordinal}:${index}`}>
          <blockquote>{excerpt.text}</blockquote>
          <p className="product-muted">{excerpt.citation.title} — {excerpt.citation.sourceLabel}, page {excerpt.citation.page}, {excerpt.citation.section} (version <code className="workspace-code">{excerpt.citation.versionId}</code>)</p>
        </li>)}</ol>
      </section>}
      <section className="product-note" aria-label="This run's activity"><h3>This run&apos;s activity</h3>
        <ul>{result.activity.map((event, index) => <li key={index}>{event.type === "RECENT_ORDERS_READ" ? `Read recent orders · ${event.orderCount} returned` : `Search published knowledge · ${event.hitCount} hits`}</li>)}</ul>
        <p className="product-muted">Trace ID: <code className="workspace-code">{result.traceId}</code></p>
      </section>
    </>}
    <p className="product-note"><Link href={`${base}/orders`}>{role === "TECHNICIAN" ? "View my jobs" : "Search Orders manually"}</Link>{" · "}<Link href={`${base}/knowledge`}>Search published knowledge manually</Link></p>
  </div>;
}
