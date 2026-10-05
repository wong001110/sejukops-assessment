"use client";

import { RobotOutlined } from "@ant-design/icons";
import { Button, Drawer, FloatButton, Input } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { AppRole } from "@/lib/auth/types";
import type { OperationsAskResult } from "@/lib/ai/runtime/operations-ask";
import { useLatestRequest } from "@/lib/ui/use-latest-request";
import { formatMalaysiaDateTime } from "@/lib/time/malaysia";
import "./operations-assistant.css";

type AskResult = Omit<OperationsAskResult, "providerSteps" | "usage"> & { traceId: string };
type AskTurn = { id: number; question: string } & (
  | { state: "running" | "cancelled" }
  | { state: "error"; error: string }
  | { state: "ready"; result: AskResult }
);
const MAX_TURNS = 12;

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
  const [turns, setTurns] = useState<AskTurn[]>([]);
  const [activeTurn, setActiveTurn] = useState<number>();
  const nextTurn = useRef(0);
  const composing = useRef(false);
  const transcript = useRef<HTMLDivElement>(null);
  const followTranscript = useRef(true);
  const requests = useLatestRequest();
  const router = useRouter();
  const running = activeTurn !== undefined;
  useEffect(() => {
    if (transcript.current && followTranscript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [turns]);
  function updateTurn(id: number, turn: AskTurn) {
    setTurns((current) => current.map((item) => item.id === id ? turn : item));
  }
  async function ask() {
    if (!question.trim() || requests.pending()) return;
    const submitted = question.trim().slice(0, 120);
    const id = ++nextTurn.current;
    const current = requests.begin();
    followTranscript.current = true;
    setActiveTurn(id);
    setTurns((previous) => [...previous.slice(-(MAX_TURNS - 1)), { id, question: submitted, state: "running" }]);
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/operations/ask`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: submitted }), signal: current.signal,
      });
      if (!response.ok) {
        const detail = await response.json() as { error?: string; resetAt?: string | null };
        const reset = response.status === 429 && detail.resetAt && Number.isFinite(Date.parse(detail.resetAt))
          ? ` Resets ${formatMalaysiaDateTime(detail.resetAt)} Malaysia time.` : "";
        throw new Error(`${detail.error ?? "Operations AI is unavailable. Search manually."}${reset}`);
      }
      const body = await response.json() as AskResult;
      if (!current.isCurrent()) return;
      updateTurn(id, { id, question: submitted, state: "ready", result: body });
      setQuestion("");
    } catch (cause) {
      if (!current.isCurrent()) return;
      updateTurn(id, { id, question: submitted, state: "error", error: cause instanceof Error ? cause.message : "Operations AI is unavailable. Search manually." });
    } finally {
      const active = current.isCurrent(); current.finish();
      if (active) setActiveTurn(undefined);
      if (isGuest && active) router.refresh();
    }
  }
  function cancel() {
    requests.cancel();
    setTurns((current) => current.map((turn) => turn.id === activeTurn ? { id: turn.id, question: turn.question, state: "cancelled" } : turn));
    setActiveTurn(undefined);
    if (isGuest) router.refresh();
  }
  const base = `/workspaces/${workspaceId}`;
  return <div className="operations-assistant-content">
    <div ref={transcript} className="operations-assistant-transcript" role="log" aria-label="Operations conversation" aria-live="polite"
      onScroll={(event) => {
        const { scrollHeight, scrollTop, clientHeight } = event.currentTarget;
        followTranscript.current = scrollHeight - scrollTop - clientHeight < 64;
      }}>
      <div className="operations-assistant-welcome">
        <RobotOutlined aria-hidden />
        <h3>Hi! How can I help?</h3>
        <p>{role === "TECHNICIAN" ? "Ask about your assigned jobs or published workspace knowledge." : "Ask about orders visible to your role or published workspace knowledge."}</p>
        <p className="product-muted">I can read sources. Make operational changes on the relevant page.</p>
        <details><summary>Scope and conversation limits</summary>
          <p className="product-muted">Searches up to 20 recent visible orders and published keyword knowledge. Shows up to five matching orders and three cited excerpts.</p>
          <p className="product-muted">Each question is checked independently. Earlier messages are not sent with your question. This panel keeps the latest {MAX_TURNS} questions until you close it or start over.</p>
        </details>
      </div>
      {turns.map((turn) => <section key={turn.id} className="operations-assistant-turn" aria-label={`Question ${turn.id}`}>
        <div className="operations-assistant-message operations-assistant-message-user"><span className="operations-assistant-speaker">You</span><p>{turn.question}</p></div>
        <div className="operations-assistant-message operations-assistant-message-ai"><span className="operations-assistant-speaker">Operations AI</span>
          {turn.state === "running" && <div role="status" className="operations-assistant-running"><p>Waiting for the answer…</p><p className="product-muted">Source checks and activity appear when the request completes.</p></div>}
          {turn.state === "cancelled" && <p role="status">Request cancelled. You can retry or search manually.</p>}
          {turn.state === "error" && <p role="alert" className="operations-assistant-error">{turn.error}</p>}
          {turn.state === "ready" && <OperationsAnswer result={turn.result} role={role} base={base} />}
        </div>
      </section>)}
    </div>
    <div className="operations-assistant-composer">
      <label className="workspace-field" htmlFor="operations-question">Question
      <Input.TextArea id="operations-question" rows={2} maxLength={120} value={question} disabled={running}
        placeholder={role === "TECHNICIAN" ? "Which jobs need attention, or how should a filter be cleaned?" : "Which orders need attention, or how should a filter be cleaned?"}
        onChange={(event) => setQuestion(event.target.value.slice(0, 120))}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !composing.current && !event.nativeEvent.isComposing && event.keyCode !== 229) {
            event.preventDefault(); void ask();
          }
        }} />
      </label>
      <div className="operations-assistant-composer-actions">
        <span className="product-muted">{question.length}/120 · Enter to send · Shift+Enter for a new line</span>
        <div className="workspace-action-row">
          {running && <Button onClick={cancel}>Cancel</Button>}
          <Button type="primary" aria-label="Ask AI" disabled={running || !question.trim()} loading={running} onClick={() => void ask()}>Send</Button>
        </div>
      </div>
      <p className="operations-assistant-manual"><Link href={`${base}/orders`}>{role === "TECHNICIAN" ? "View my jobs" : "Search Orders manually"}</Link>{" · "}<Link href={`${base}/knowledge`}>Search published knowledge manually</Link></p>
    </div>
  </div>;
}

function OperationsAnswer({ result, role, base }: { result: AskResult; role: AppRole; base: string }) {
  return <>
      <p className="operations-assistant-answer">{result.answer}</p>
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
      <details className="operations-assistant-activity" aria-label="This run's activity"><summary>This run&apos;s activity</summary>
        <ul>{result.activity.map((event, index) => <li key={index}>{event.type === "RECENT_ORDERS_READ" ? `Read recent orders · ${event.orderCount} returned` : `Search published knowledge · ${event.hitCount} hits`}</li>)}</ul>
        <p className="product-muted">Trace ID: <code className="workspace-code">{result.traceId}</code></p>
      </details>
    </>;
}
