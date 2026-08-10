"use client";

import { BulbOutlined, ClearOutlined, DatabaseOutlined, ReloadOutlined, SendOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Collapse, Empty, Input, List, Skeleton, Space, Tag, Typography } from "antd";
import { useEffect, useRef, useState } from "react";

import type { AIOperationsResponse, ConversationContext } from "@/domain/ai-operations/contracts";
import { AIOperationsClientError, aiRecoveryCopy, askAIOperations } from "./api";
import { canApplyConversationResult, canStartConversationRequest, newConversationTurn, retryConversationTurn, type ConversationTurn } from "./conversation-state";

type PersistedConversation = { turns: ConversationTurn[]; context: ConversationContext | null };
const conversationStorageKey = "sejukops:manager-ai-operations-conversation";

const supportedExamples = [
  "What jobs did Ali complete last week?",
  "Which technician completed the most jobs this week?",
  "How many jobs were completed today?",
  "What was the total completed amount this week?",
];

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function safeObjectLines(value: unknown) {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== null && ["string", "number", "boolean"].includes(typeof item))
    .slice(0, 5)
    .map(([key, item]) => `${key.replace(/([A-Z])/g, " $1")}: ${String(item)}`);
}

function Grounding({ response }: { response: AIOperationsResponse }) {
  const tools = Array.isArray(response.toolCalls) ? response.toolCalls : [];
  const facts = Array.isArray(response.facts) ? response.facts : [];
  if (tools.length === 0 && facts.length === 0) return null;
  return <Collapse
    className="ai-operations-grounding"
    size="small"
    items={[{
      key: "grounding",
      label: <Space size={6}><DatabaseOutlined /> Grounding from approved operational data <Tag color="green">Current system data</Tag></Space>,
      children: <div className="ai-grounding-content">
        {tools.map((tool, index) => <div className="ai-grounding-row" key={`tool-${index}`}><Typography.Text strong>{tool.name}</Typography.Text><Typography.Text type="secondary">Approved retrieval returned {tool.resultCount} matching {tool.resultCount === 1 ? "record" : "records"}{safeObjectLines(tool.arguments).length ? ` · ${safeObjectLines(tool.arguments).join(" · ")}` : ""}.</Typography.Text></div>)}
        {facts.map((fact) => <div className="ai-grounding-row" key={fact.key}><Typography.Text strong>{fact.label}</Typography.Text><Typography.Text type="secondary">{Array.isArray(fact.value) ? fact.value.join(", ") : fact.value}</Typography.Text></div>)}
      </div>,
    }]}
  />;
}

function AssistantTurn({ turn, retry, retryDisabled }: { turn: ConversationTurn; retry: () => void; retryDisabled: boolean }) {
  if (turn.status === "loading") return <div className="ai-assistant-response ai-response-loading"><Skeleton active title={{ width: "42%" }} paragraph={{ rows: 2 }} /></div>;
  if (turn.status === "error") return <Alert className="ai-assistant-response" type="error" showIcon message="AI answer unavailable" description={<div><div>{turn.error?.message}</div><Typography.Text type="secondary">{aiRecoveryCopy(turn.error?.action ?? "RETRY")}</Typography.Text></div>} action={turn.error?.retryable ? <Button size="small" icon={<ReloadOutlined />} onClick={retry} disabled={retryDisabled}>Retry</Button> : undefined} />;
  const response = turn.response;
  if (!response) return null;
  const type = response.outcome === "ANSWER" ? "success" : response.outcome === "NO_DATA" ? "info" : "warning";
  const title = response.outcome === "ANSWER" ? "Grounded operational answer" : response.outcome === "NO_DATA" ? "No matching operational data" : response.outcome === "CLARIFICATION" ? "Clarify this operations request" : "Outside the supported operations scope";
  return <Alert className="ai-assistant-response" type={type} showIcon message={<Space size={8}>{title}{response.metadata.grounded && <Tag color="green">Grounded</Tag>}</Space>} description={<div className="ai-assistant-answer"><Typography.Paragraph>{response.answer}</Typography.Paragraph><Grounding response={response} /></div>} />;
}

export function AIOperationsWorkspace() {
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [context, setContext] = useState<ConversationContext | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const contextRef = useRef<ConversationContext | null>(null);
  const requestEpochRef = useRef(0);
  const requestsRef = useRef(new Map<string, AbortController>());
  const activeTurnIdRef = useRef<string | null>(null);
  contextRef.current = context;

  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(conversationStorageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<PersistedConversation>;
        if (Array.isArray(parsed.turns)) setTurns(parsed.turns.filter((turn): turn is ConversationTurn => Boolean(turn && typeof turn.question === "string" && turn.status !== "loading" && "requestContext" in turn)));
        if (parsed.context && typeof parsed.context === "object") setContext(parsed.context as ConversationContext);
      }
    } catch { /* A malformed browser-only draft is safely discarded. */ }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.sessionStorage.setItem(conversationStorageKey, JSON.stringify({ turns: turns.filter((turn) => turn.status !== "loading"), context } satisfies PersistedConversation));
  }, [context, hydrated, turns]);

  const runTurn = async (turn: ConversationTurn, retrying = false) => {
    if (!canStartConversationRequest(activeTurnIdRef.current, turn.id)) return;
    const prior = requestsRef.current.get(turn.id);
    prior?.abort();
    const controller = new AbortController();
    const requestEpoch = requestEpochRef.current;
    activeTurnIdRef.current = turn.id;
    requestsRef.current.set(turn.id, controller);
    if (retrying) setTurns((previous) => previous.map((item) => item.id === turn.id ? retryConversationTurn(item) : item));
    try {
      const response = await askAIOperations({ question: turn.question, context: turn.requestContext }, controller.signal);
      const isActive = requestsRef.current.get(turn.id) === controller;
      if (!canApplyConversationResult(requestEpoch, requestEpochRef.current, isActive)) return;
      setContext(response.context);
      setTurns((previous) => previous.map((item) => item.id === turn.id ? { ...item, status: "complete", response } : item));
    } catch (error) {
      const isActive = requestsRef.current.get(turn.id) === controller;
      if (!canApplyConversationResult(requestEpoch, requestEpochRef.current, isActive) || controller.signal.aborted) return;
      const details = error instanceof AIOperationsClientError
        ? error.details
        : { code: "AI_PROVIDER_UNAVAILABLE", message: "The AI request could not be completed. Please retry.", retryable: true, action: "RETRY" } as const;
      setTurns((previous) => previous.map((item) => item.id === turn.id ? { ...item, status: "error", error: details } : item));
    } finally {
      if (requestsRef.current.get(turn.id) === controller) {
        requestsRef.current.delete(turn.id);
        if (activeTurnIdRef.current === turn.id) activeTurnIdRef.current = null;
      }
    }
  };

  const submit = async (providedQuestion?: string) => {
    const question = (providedQuestion ?? draft).trim();
    if (!question) return;
    const turn = newConversationTurn(newId(), question, contextRef.current);
    if (!canStartConversationRequest(activeTurnIdRef.current, turn.id)) return;
    setDraft("");
    setTurns((previous) => [...previous, turn]);
    await runTurn(turn);
  };

  const reset = () => {
    requestEpochRef.current += 1;
    requestsRef.current.forEach((controller) => controller.abort());
    requestsRef.current.clear();
    activeTurnIdRef.current = null;
    setTurns([]);
    setContext(null);
    setDraft("");
    window.sessionStorage.removeItem(conversationStorageKey);
  };

  const pending = turns.some((turn) => turn.status === "loading");
  return <main className="ai-operations-page">
    <section className="ai-operations-heading">
      <div><Typography.Text className="dashboard-kicker">Manager decision support</Typography.Text><Typography.Title level={1}>AI Operations Assistant</Typography.Title><Typography.Paragraph>Ask focused questions about completed work, workload, technicians, and operational totals. Answers are grounded in approved SejukOps data tools, not unrestricted database access.</Typography.Paragraph></div>
      <Button icon={<ClearOutlined />} onClick={reset} disabled={turns.length === 0 && !draft}>New conversation</Button>
    </section>
    <Alert className="ai-supported-scope" type="info" showIcon icon={<BulbOutlined />} message="Supported operations questions" description={<div><Typography.Paragraph>Completed jobs, technician performance, workload, service activity, and operational totals across supported date periods. Requests outside this scope are declined rather than guessed.</Typography.Paragraph><Space wrap>{supportedExamples.map((example) => <Button key={example} size="small" onClick={() => setDraft(example)} disabled={pending}>{example}</Button>)}</Space></div>} />
    <Card className="ai-operations-chat" bordered={false} title="Conversation" extra={<Typography.Text type="secondary">Session-only context · clearable</Typography.Text>}>
      {turns.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Start with a supported operations question" /> : <List className="ai-conversation-list" split={false} dataSource={turns} renderItem={(turn) => <List.Item key={turn.id}><div className="ai-conversation-turn"><div className="ai-manager-question"><Typography.Text strong>Manager</Typography.Text><Typography.Paragraph>{turn.question}</Typography.Paragraph></div><div className="ai-assistant-turn"><Typography.Text strong>SejukOps AI</Typography.Text><AssistantTurn turn={turn} retry={() => void runTurn(turn, true)} retryDisabled={pending} /></div></div></List.Item>} />}
      <div className="ai-composer"><Input.TextArea value={draft} onChange={(event) => setDraft(event.target.value)} onPressEnter={(event) => { if (!event.shiftKey) { event.preventDefault(); void submit(); } }} placeholder="Ask a supported operations question…" autoSize={{ minRows: 2, maxRows: 5 }} disabled={pending} aria-label="Operations question" /><div className="ai-composer-actions"><Typography.Text type="secondary">Enter to send · Shift+Enter for a new line</Typography.Text><Button type="primary" icon={<SendOutlined />} onClick={() => void submit()} loading={pending} disabled={!draft.trim()}>Ask Operations</Button></div></div>
    </Card>
  </main>;
}
