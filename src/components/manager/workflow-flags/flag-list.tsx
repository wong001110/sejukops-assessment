"use client";

import { BulbOutlined, ReloadOutlined, SafetyCertificateOutlined, WarningOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Descriptions, Empty, List, Space, Tag, Typography } from "antd";
import { useEffect, useRef, useState } from "react";

import type { ManagerWorkflowFlag } from "@/domain/manager-review/contracts";
import { formatMalaysiaDateTime } from "@/lib/time/malaysia";
import { requestWorkflowExplanation, WorkflowExplanationApiError } from "./api";

const safeUnavailableCopy: Readonly<Record<string, string>> = {
  AI_NOT_CONFIGURED: "AI is not configured for Workflow Explanation. The rule result remains available for review.",
  AI_AUTH_FAILED: "The configured provider rejected its credential. An Admin should verify AI Settings and run Test Connection.",
  AI_RATE_LIMITED: "The provider is temporarily rate limited. Retry later; the workflow flag is unchanged.",
  AI_TIMEOUT: "The provider did not respond in time. Retry when ready; the deterministic flag remains available.",
  AI_PROVIDER_UNAVAILABLE: "The provider is temporarily unavailable. Retry later; the deterministic flag remains available.",
  AI_INVALID_RESPONSE: "The provider response could not be validated safely. No AI recommendation was shown.",
  AI_CAPABILITY_MISMATCH: "The routed model is not compatible with Workflow Explanation. Ask an Admin to review AI Settings.",
};

function detailLabel(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function detailValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return "Not recorded";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number" && /ratio$/i.test(key)) return `${(value * 100).toFixed(0)}%`;
  if (typeof value === "number" && /amount|price|charges|minimum$/i.test(key)) return `RM ${value.toFixed(2)}`;
  if (typeof value === "object") return "Structured rule evidence recorded";
  return String(value);
}

function ExplanationPanel({ flag, onUpdate }: { flag: ManagerWorkflowFlag; onUpdate: (flag: ManagerWorkflowFlag) => void }) {
  const [loading, setLoading] = useState(false);
  const [requestError, setRequestError] = useState<string>();
  const requestKey = useRef<string>();

  const request = async () => {
    setLoading(true);
    setRequestError(undefined);
    try {
      const result = await requestWorkflowExplanation(flag.id, { requestKey: requestKey.current ??= crypto.randomUUID() });
      requestKey.current = undefined;
      onUpdate(result.flag);
    } catch (cause) {
      setRequestError(cause instanceof WorkflowExplanationApiError ? cause.message : "The optional AI explanation could not be requested.");
    } finally {
      setLoading(false);
    }
  };

  const explanation = flag.explanation;
  if (explanation.status === "AVAILABLE") {
    return <div className="workflow-explanation workflow-explanation-available"><Space align="center" wrap><Tag icon={<BulbOutlined />} color="blue">Optional AI explanation</Tag>{explanation.generatedAt ? <Typography.Text type="secondary">Generated {formatMalaysiaDateTime(explanation.generatedAt)}</Typography.Text> : null}</Space><Typography.Paragraph className="workflow-explanation-summary">{explanation.summary}</Typography.Paragraph><Alert type="info" showIcon message="Suggested review action" description={explanation.recommendation} /><Typography.Text type="secondary" className="workflow-ai-disclaimer">Decision support only. The Manager remains responsible for the review decision.</Typography.Text></div>;
  }

  if (explanation.status === "UNAVAILABLE") {
    return <div className="workflow-explanation"><Alert type="warning" showIcon message="AI explanation unavailable" description={safeUnavailableCopy[explanation.errorCode ?? ""] ?? "The optional explanation could not be generated. Review the deterministic rule facts above."} action={<Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={() => void request()}>Retry</Button>} />{requestError ? <Alert type="error" showIcon message={requestError} /> : null}</div>;
  }

  return <div className="workflow-explanation"><Space direction="vertical" size="small" className="full-width"><Typography.Text type="secondary">Add optional plain-language context. The rule facts remain the source of truth.</Typography.Text>{requestError ? <Alert type="error" showIcon message={requestError} /> : null}<Button icon={<BulbOutlined />} loading={loading} onClick={() => void request()}>Explain this flag</Button></Space></div>;
}

export function WorkflowFlagList({ flags }: { flags: readonly ManagerWorkflowFlag[] }) {
  const [items, setItems] = useState<readonly ManagerWorkflowFlag[]>(flags);
  useEffect(() => setItems(flags), [flags]);
  const update = (next: ManagerWorkflowFlag) => setItems((current) => current.map((item) => item.id === next.id ? next : item));

  if (!items.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No workflow flags" />;
  return <List className="workflow-flag-list" dataSource={[...items]} renderItem={(flag) => <List.Item><Card size="small" className={`workflow-flag-card workflow-flag-${flag.severity.toLowerCase()}`}><Space direction="vertical" size="middle" className="full-width"><div className="workflow-flag-heading"><Space align="start">{flag.severity === "CRITICAL" ? <SafetyCertificateOutlined className="workflow-critical-icon" /> : <WarningOutlined className="workflow-warning-icon" />}<div><Typography.Text strong>{flag.title}</Typography.Text><div><Typography.Text type="secondary">{flag.ruleCode.replaceAll("_", " ")}</Typography.Text></div></div></Space><Space wrap><Tag color={flag.severity === "CRITICAL" ? "red" : "orange"}>{flag.severity}</Tag><Tag color={flag.status === "OPEN" ? "gold" : "green"}>{flag.status}</Tag></Space></div><Alert type={flag.severity === "CRITICAL" ? "error" : "warning"} showIcon message="Deterministic rule finding" description={flag.deterministicSummary} />{Object.keys(flag.details).length ? <Descriptions size="small" column={{ xs: 1, sm: 2 }} items={Object.entries(flag.details).map(([key, value]) => ({ key, label: detailLabel(key), children: detailValue(key, value) }))} /> : <Typography.Text type="secondary">No additional rule evidence was recorded.</Typography.Text>}<Typography.Text type="secondary">Completion revision {flag.completionRevision} · Flagged {formatMalaysiaDateTime(flag.createdAt)}</Typography.Text><ExplanationPanel flag={flag} onUpdate={update} /></Space></Card></List.Item>} />;
}
