"use client";

import { RobotOutlined } from "@ant-design/icons";
import { Alert, Button, Drawer, FloatButton, Input } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { AppRole } from "@/lib/auth/types";
import type { OperationsAskResult } from "@/lib/ai/runtime/operations-ask";
import { useLatestRequest } from "@/lib/ui/use-latest-request";
import { formatMalaysiaDateTime } from "@/lib/time/malaysia";
import { AI_SESSION_HEADER } from "@/domain/ai-sessions/contracts";
import { SessionHistory, type AiSessionDetail } from "@/components/ai/session-history";
import "./operations-assistant.css";

type AskResult = Omit<OperationsAskResult, "providerSteps" | "usage"> & { traceId: string };
type AskTurn = { id: number; question: string } & (
  | { state: "running" | "cancelled" }
  | { state: "error"; error: string }
  | { state: "ready"; result: AskResult }
  | { state: "historical"; answer: string }
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
  const sessionId = useRef<string>();
  const [historySaved, setHistorySaved] = useState<boolean>();
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
  async function ask(retry?: AskTurn) {
    if (requests.pending()) return;
    const submitted = retry?.question ?? question.trim().slice(0, 120);
    if (!submitted) return;
    const id = retry?.id ?? ++nextTurn.current;
    const current = requests.begin();
    sessionId.current ??= crypto.randomUUID();
    followTranscript.current = true;
    setActiveTurn(id);
    setTurns((previous) => retry
      ? previous.map((turn) => turn.id === id ? { id, question: submitted, state: "running" } : turn)
      : [...previous.slice(-(MAX_TURNS - 1)), { id, question: submitted, state: "running" }]);
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/operations/ask`, {
        method: "POST", headers: { "Content-Type": "application/json", [AI_SESSION_HEADER]: sessionId.current },
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
      setHistorySaved(response.headers.get("X-Sejuk-History") === "unavailable" ? false : undefined);
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
  function restoreConversation(detail: AiSessionDetail) {
    if (requests.pending()) return;
    sessionId.current = detail.session.id;
    setTurns(detail.turns.slice(-MAX_TURNS).map((turn) => ({ id: ++nextTurn.current, question: turn.question, state: "historical" as const,
      answer: turn.answer ?? "This request has no recorded answer. Ask again to check current sources." })));
    setQuestion(""); setHistorySaved(undefined);
  }
  return <div className="operations-assistant-content">
    <SessionHistory workspaceId={workspaceId} surface="CHATBOT" disabled={running} onRestore={restoreConversation} />
    {historySaved === false && <Alert type="warning" message="This answer was not saved to history. You can continue chatting here." />}
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
        <p className="product-muted">Each question is checked independently. Earlier messages are not sent with your question.</p>
      </div>
      {turns.map((turn) => <section key={turn.id} className="operations-assistant-turn" aria-label={`Question ${turn.id}`}>
        <div className="operations-assistant-message operations-assistant-message-user"><span className="operations-assistant-speaker">You</span><p>{turn.question}</p></div>
        <div className="operations-assistant-message operations-assistant-message-ai"><span className="operations-assistant-speaker">Operations AI</span>
          {turn.state === "running" && <div role="status" className="operations-assistant-running"><p>Thinking…</p></div>}
          {turn.state === "cancelled" && <p role="status">Request cancelled. You can retry or search manually.</p>}
          {turn.state === "error" && <><p role="alert" className="operations-assistant-error">{turn.error}</p><Button size="small" onClick={() => void ask(turn)}>Retry question</Button></>}
          {turn.state === "ready" && <OperationsAnswer result={turn.result} role={role} base={base} />}
          {turn.state === "historical" && <><p className="operations-assistant-recorded">{turn.answer}</p><small>Recorded answer · ask again for current information</small></>}
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
      {result.orders.length > 0 && <div className="operations-assistant-evidence">
        <p>{role === "TECHNICIAN" ? "Your assigned jobs" : "Matching orders"}</p>
        <ul>{result.orders.map((order) => <li key={order.id}><Link href={`${base}/orders?orderId=${encodeURIComponent(order.id)}`}>{order.order_no}</Link> · {order.status}</li>)}</ul>
      </div>}
      {result.excerpts.length > 0 && <div className="operations-assistant-evidence">
        <p>Published knowledge</p>
        <ol>{result.excerpts.map((excerpt, index) => <li key={`${excerpt.citation.versionId}:${excerpt.citation.ordinal}:${index}`}>
          <blockquote>{excerpt.text}</blockquote>
          <p className="product-muted">{excerpt.citation.title} — {excerpt.citation.sourceLabel}, {excerpt.citation.section}, page {excerpt.citation.page} · version <code className="workspace-code">{excerpt.citation.versionId}</code></p>
          <Link href={`${base}/knowledge`}>Search published knowledge</Link>
        </li>)}</ol>
      </div>}
    </>;
}
