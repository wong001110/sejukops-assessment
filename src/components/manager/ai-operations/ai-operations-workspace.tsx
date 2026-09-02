"use client";

import {
  BulbOutlined,
  ClearOutlined,
  DatabaseOutlined,
  ReloadOutlined,
  RobotOutlined,
  SendOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Avatar,
  Button,
  Card,
  Collapse,
  Empty,
  Input,
  List,
  Skeleton,
  Space,
  Tag,
  Typography,
} from "antd";
import { useEffect, useRef, useState } from "react";

import {
  operationalPeriodLabel,
  type AIOperationsResponse,
  type ConversationContext,
  type OperationsToolCall,
} from "@/domain/ai-operations/contracts";

import { AIOperationsClientError, aiRecoveryCopy, askAIOperations } from "./api";
import {
  canApplyConversationResult,
  canStartConversationRequest,
  newConversationTurn,
  retryConversationTurn,
  type ConversationTurn,
} from "./conversation-state";
import { OperationsResultPresentation } from "./operations-result-presentation";

type PersistedConversation = {
  turns: ConversationTurn[];
  context: ConversationContext | null;
};
const conversationStorageKey = "sejukops:manager-ai-operations-conversation:v2";

const supportedExamples = [
  "What jobs did Ali complete last week?",
  "Which technician completed the most jobs this week?",
  "Which technician completed the most jobs in August 2026?",
  "How many jobs were completed today?",
  "What was the total completed amount this week?",
];

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

function argumentSummary(tool: OperationsToolCall) {
  const args = tool.arguments;
  const parts: string[] = [];
  if (typeof args.period === "string") {
    parts.push(operationalPeriodLabel(args.period));
  }
  if (typeof args.technicianName === "string") {
    parts.push(`Technician: ${args.technicianName}`);
  }
  if (typeof args.serviceType === "string") {
    parts.push(`Service: ${args.serviceType}`);
  }
  if (typeof args.status === "string") {
    parts.push(`Status: ${args.status.replaceAll("_", " ")}`);
  }
  if (typeof args.orderNumber === "string") {
    parts.push(`Order: ${args.orderNumber}`);
  }
  if (args.completedOnly === true) parts.push("Completed only");
  return parts;
}

function Grounding({ response }: { response: AIOperationsResponse }) {
  const tool = response.toolCalls[0];
  const facts = Array.isArray(response.facts) ? response.facts : [];
  if (!tool && facts.length === 0) return null;
  const scope = tool ? argumentSummary(tool) : [];

  return (
    <Collapse
      className="ai-operations-grounding"
      size="small"
      items={[
        {
          key: "grounding",
          label: (
            <div className="ai-grounding-label">
              <Space size={6}>
                <DatabaseOutlined />
                <span>Verified from current operational data</span>
              </Space>
              <Tag color="green">Grounded</Tag>
            </div>
          ),
          children: (
            <div className="ai-grounding-summary">
              {tool ? (
                <>
                  <div>
                    <Typography.Text type="secondary">Approved retrieval</Typography.Text>
                    <Typography.Text code>{tool.name}</Typography.Text>
                  </div>
                  <div>
                    <Typography.Text type="secondary">Result set</Typography.Text>
                    <Typography.Text>
                      {tool.resultCount} {tool.resultCount === 1 ? "record" : "records"}
                    </Typography.Text>
                  </div>
                </>
              ) : null}
              {scope.length ? (
                <div>
                  <Typography.Text type="secondary">Query scope</Typography.Text>
                  <Typography.Text>{scope.join(" · ")}</Typography.Text>
                </div>
              ) : null}
              <div>
                <Typography.Text type="secondary">Verified facts</Typography.Text>
                <Typography.Text>{facts.length} grounded fields</Typography.Text>
              </div>
            </div>
          ),
        },
      ]}
    />
  );
}

function AssistantTurn({
  turn,
  retry,
  retryDisabled,
}: {
  turn: ConversationTurn;
  retry: () => void;
  retryDisabled: boolean;
}) {
  if (turn.status === "loading") {
    return (
      <div className="ai-message-bubble ai-assistant-bubble ai-response-loading">
        <Skeleton active title={{ width: "42%" }} paragraph={{ rows: 2 }} />
      </div>
    );
  }

  if (turn.status === "error") {
    return (
      <div className="ai-message-bubble ai-assistant-bubble">
        <Alert
          type="error"
          showIcon
          message="AI answer unavailable"
          description={
            <div>
              <div>{turn.error?.message}</div>
              <Typography.Text type="secondary">
                {aiRecoveryCopy(turn.error?.action ?? "RETRY")}
              </Typography.Text>
            </div>
          }
          action={
            turn.error?.retryable ? (
              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={retry}
                disabled={retryDisabled}
              >
                Retry
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  const response = turn.response;
  if (!response) return null;

  if (response.outcome !== "ANSWER") {
    const type = response.outcome === "NO_DATA" ? "info" : "warning";
    const title =
      response.outcome === "NO_DATA"
        ? "No matching operational data"
        : response.outcome === "CLARIFICATION"
          ? "Clarify this operations request"
          : "Outside the supported operations scope";
    return (
      <div className="ai-message-bubble ai-assistant-bubble">
        <Alert type={type} showIcon message={title} description={response.answer} />
        <Grounding response={response} />
      </div>
    );
  }

  return (
    <div className="ai-message-bubble ai-assistant-bubble">
      <div className="ai-assistant-answer-heading">
        <Tag color="green">Grounded answer</Tag>
        <Typography.Text type="secondary">Current system data</Typography.Text>
      </div>
      <Typography.Paragraph className="ai-assistant-summary">
        {response.answer}
      </Typography.Paragraph>
      <OperationsResultPresentation
        presentation={response.presentation}
        toolCall={response.toolCalls[0]}
      />
      <Grounding response={response} />
    </div>
  );
}

function SupportedQuestionWelcome({
  disabled,
  chooseExample,
}: {
  disabled: boolean;
  chooseExample: (example: string) => void;
}) {
  return (
    <div className="ai-conversation-empty" aria-label="Supported operations questions">
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="Start with a supported operations question"
      />
      <section className="ai-conversation-welcome">
        <Space align="start" size={10}>
          <BulbOutlined aria-hidden className="ai-conversation-welcome-icon" />
          <div>
            <Typography.Title level={4}>Supported operations questions</Typography.Title>
            <Typography.Paragraph>
              Completed jobs, technician performance, workload, service activity,
              and operational totals across supported date periods. Requests outside
              this scope are declined rather than guessed.
            </Typography.Paragraph>
          </div>
        </Space>
        <Space wrap>
          {supportedExamples.map((example) => (
            <Button
              key={example}
              size="small"
              onClick={() => chooseExample(example)}
              disabled={disabled}
            >
              {example}
            </Button>
          ))}
        </Space>
      </section>
    </div>
  );
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
  const conversationEndRef = useRef<HTMLDivElement | null>(null);
  contextRef.current = context;

  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(conversationStorageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<PersistedConversation>;
        if (Array.isArray(parsed.turns)) {
          setTurns(
            parsed.turns.filter(
              (turn): turn is ConversationTurn =>
                Boolean(
                  turn &&
                    typeof turn.question === "string" &&
                    turn.status !== "loading" &&
                    "requestContext" in turn,
                ),
            ),
          );
        }
        if (parsed.context && typeof parsed.context === "object") {
          setContext(parsed.context as ConversationContext);
        }
      }
    } catch {
      /* A malformed browser-only draft is safely discarded. */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.sessionStorage.setItem(
      conversationStorageKey,
      JSON.stringify({
        turns: turns.filter((turn) => turn.status !== "loading"),
        context,
      } satisfies PersistedConversation),
    );
  }, [context, hydrated, turns]);

  useEffect(() => {
    if (!hydrated || turns.length === 0) return;
    conversationEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [hydrated, turns]);

  const runTurn = async (turn: ConversationTurn, retrying = false) => {
    if (!canStartConversationRequest(activeTurnIdRef.current, turn.id)) return;
    const prior = requestsRef.current.get(turn.id);
    prior?.abort();
    const controller = new AbortController();
    const requestEpoch = requestEpochRef.current;
    activeTurnIdRef.current = turn.id;
    requestsRef.current.set(turn.id, controller);
    if (retrying) {
      setTurns((previous) =>
        previous.map((item) =>
          item.id === turn.id ? retryConversationTurn(item) : item,
        ),
      );
    }
    try {
      const response = await askAIOperations(
        { question: turn.question, context: turn.requestContext },
        controller.signal,
      );
      const isActive = requestsRef.current.get(turn.id) === controller;
      if (!canApplyConversationResult(requestEpoch, requestEpochRef.current, isActive)) {
        return;
      }
      setContext(response.context);
      setTurns((previous) =>
        previous.map((item) =>
          item.id === turn.id ? { ...item, status: "complete", response } : item,
        ),
      );
    } catch (error) {
      const isActive = requestsRef.current.get(turn.id) === controller;
      if (
        !canApplyConversationResult(requestEpoch, requestEpochRef.current, isActive) ||
        controller.signal.aborted
      ) {
        return;
      }
      const details =
        error instanceof AIOperationsClientError
          ? error.details
          : ({
              code: "AI_PROVIDER_UNAVAILABLE",
              message: "The AI request could not be completed. Please retry.",
              retryable: true,
              action: "RETRY",
            } as const);
      setTurns((previous) =>
        previous.map((item) =>
          item.id === turn.id ? { ...item, status: "error", error: details } : item,
        ),
      );
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

  return (
    <main className="ai-operations-page">
      <section className="ai-operations-heading">
        <div>
          <Typography.Text className="dashboard-kicker">
            Manager decision support
          </Typography.Text>
          <Typography.Title level={1}>AI Operations Assistant</Typography.Title>
          <Typography.Paragraph>
            Ask focused questions about completed work, workload, technicians, and
            operational totals. Answers are grounded in approved SejukOps data tools,
            not unrestricted database access.
          </Typography.Paragraph>
        </div>
        <Button
          icon={<ClearOutlined />}
          onClick={reset}
          disabled={turns.length === 0 && !draft}
        >
          New conversation
        </Button>
      </section>

      <Card
        className="ai-operations-chat"
        variant="borderless"
        title="Conversation"
        extra={
          <Typography.Text type="secondary">
            Session-only context · clearable
          </Typography.Text>
        }
      >
        <div className="ai-conversation-body">
          {turns.length === 0 ? (
            <SupportedQuestionWelcome disabled={pending} chooseExample={setDraft} />
          ) : (
            <List
              className="ai-conversation-list"
              split={false}
              dataSource={turns}
              renderItem={(turn) => (
                <List.Item key={turn.id}>
                  <div className="ai-conversation-turn">
                    <div className="ai-message-row ai-message-row-manager">
                      <div className="ai-message-stack ai-message-stack-manager">
                        <div className="ai-message-meta ai-message-meta-manager">
                          <Typography.Text type="secondary">Manager</Typography.Text>
                        </div>
                        <div className="ai-message-bubble ai-manager-question">
                          <Typography.Paragraph>{turn.question}</Typography.Paragraph>
                        </div>
                      </div>
                    </div>

                    <div className="ai-message-row ai-message-row-assistant">
                      <Avatar
                        className="ai-assistant-avatar"
                        size={34}
                        icon={<RobotOutlined />}
                      />
                      <div className="ai-message-stack ai-message-stack-assistant">
                        <div className="ai-message-meta">
                          <Typography.Text strong>SejukOps AI</Typography.Text>
                        </div>
                        <AssistantTurn
                          turn={turn}
                          retry={() => void runTurn(turn, true)}
                          retryDisabled={pending}
                        />
                      </div>
                    </div>
                  </div>
                </List.Item>
              )}
            />
          )}
          <div ref={conversationEndRef} aria-hidden />
        </div>

        <div className="ai-composer">
          <Input.TextArea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onPressEnter={(event) => {
              if (!event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder="Ask a supported operations question…"
            autoSize={{ minRows: 2, maxRows: 5 }}
            disabled={pending}
            aria-label="Operations question"
          />
          <div className="ai-composer-actions">
            <Typography.Text type="secondary">
              Enter to send · Shift+Enter for a new line
            </Typography.Text>
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={() => void submit()}
              loading={pending}
              disabled={!draft.trim()}
            >
              Ask Operations
            </Button>
          </div>
        </div>
      </Card>
    </main>
  );
}
