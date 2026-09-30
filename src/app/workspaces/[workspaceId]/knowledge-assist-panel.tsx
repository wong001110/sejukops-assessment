"use client";

import { Alert, Button, Card, Input } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLatestRequest } from "@/lib/ui/use-latest-request";

type Citation = {
  documentId: string; versionId: string; title: string;
  sourceLabel: string; section: string; page: number; ordinal: number;
};
type Excerpt = { text: string; citation: Citation };
type KnowledgeAnswer = {
  status: "EXCERPTS_FOUND" | "INSUFFICIENT";
  answer: string;
  excerpts: Excerpt[];
  activity: { type: "KNOWLEDGE_SEARCH"; hitCount: number }[];
  traceId: string;
};

export function KnowledgeAssistPanel({ workspaceId, isGuest }: { workspaceId: string; isGuest: boolean }) {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<KnowledgeAnswer>();
  const [error, setError] = useState("");
  const [state, setState] = useState<"idle" | "running" | "ready" | "cancelled" | "error">("idle");
  const requests = useLatestRequest();
  const router = useRouter();

  async function ask() {
    if (!question.trim() || requests.pending()) return;
    const current = requests.begin();
    setState("running"); setResult(undefined); setError("");
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/agent/knowledge`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question.trim() }), signal: current.signal,
      });
      if (!response.ok) {
        if (response.status === 429) {
          const detail = await response.json() as { error?: string; resetAt?: string | null };
          const reset = detail.resetAt && Number.isFinite(Date.parse(detail.resetAt))
            ? new Date(detail.resetAt).toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" }) : null;
          throw new Error(`${detail.error ?? "Today's Guest AI allowance is used up."}${reset ? ` Resets ${reset} Malaysia time.` : ""}`);
        }
        throw new Error("Knowledge AI is unavailable. Search the published sources manually.");
      }
      const body = await response.json() as KnowledgeAnswer;
      if (!current.isCurrent()) return;
      setResult(body);
      setState("ready");
    } catch (cause) {
      if (!current.isCurrent()) return;
      setError(cause instanceof Error ? cause.message : "Knowledge AI is unavailable.");
      setState("error");
    } finally {
      const active = current.isCurrent();
      current.finish();
      if (isGuest && active) router.refresh();
    }
  }

  function cancel() { requests.cancel(); setState("cancelled"); if (isGuest) router.refresh(); }

  return <Card className="workspace-panel product-note" title="Find cited excerpts">
    <p className="product-muted">The assistant selects original text from published workspace sources. Check whether each excerpt answers your question before acting.</p>
    <label className="workspace-field" htmlFor="knowledge-question">Question
      <Input.TextArea id="knowledge-question" rows={3} maxLength={120} value={question}
        disabled={state === "running"} onChange={(event) => {
          setQuestion(event.target.value);
          setResult(undefined);
          setState("idle");
        }} />
    </label>
    <div className="workspace-action-row product-note">
      <Button type="primary" disabled={state === "running" || !question.trim()}
        loading={state === "running"} onClick={() => void ask()}>Find cited excerpts</Button>
      {state === "running" && <Button onClick={cancel}>Cancel</Button>}
    </div>
    {state === "running" && <Alert type="info" showIcon message="Searching published knowledge…" />}
    {state === "cancelled" && <Alert type="info" showIcon message="Request cancelled. You can search manually." />}
    {state === "error" && <Alert type="error" showIcon message={error} />}
    {state === "ready" && result && <section className="product-note" aria-label="Cited knowledge excerpts">
      <Alert type="info" showIcon
        message={result.answer} description={result.status === "INSUFFICIENT"
          ? "Try a more specific question or inspect the published sources." : undefined} />
      {result.excerpts.length > 0 && <ol className="workspace-results">
        {result.excerpts.map((excerpt, index) => <li className="workspace-result"
          key={`${excerpt.citation.versionId}:${excerpt.citation.ordinal}:${index}`}>
          <blockquote>{excerpt.text}</blockquote>
          <p className="product-muted">{excerpt.citation.title} — {excerpt.citation.sourceLabel},
            page {excerpt.citation.page}, {excerpt.citation.section} (version
            {" "}<code className="workspace-code">{excerpt.citation.versionId}</code>)</p>
        </li>)}
      </ol>}
      <p className="product-muted">Activity: {result.activity[0]?.hitCount ?? 0} published source hits ·
        trace <code className="workspace-code">{result.traceId}</code></p>
    </section>}
    <p className="product-note"><Link href={`/workspaces/${workspaceId}/knowledge`}>Search published knowledge manually</Link></p>
  </Card>;
}
