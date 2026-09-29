"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, Empty, Input, Space, Tag } from "antd";

type Review = {
  documentId: string;
  versionId: string;
  title: string;
  sourceLabel: string;
  sourceText: string;
  sourceKind: "TEXT" | "PDF_TEXT";
  indexState: "PENDING" | "PROCESSING" | "READY" | "FAILED";
  indexError: string | null;
};
type Hit = {
  content: string;
  citation: {
    documentId: string;
    versionId: string;
    section: string;
    page: number;
    ordinal: number;
    title: string;
    sourceLabel: string;
  };
};

export function KnowledgeWorkspace({ workspaceId, canEdit, isDemo }: {
  workspaceId: string; canEdit: boolean; isDemo: boolean;
}) {
  const endpoint = `/api/workspaces/${workspaceId}/knowledge`;
  const [generation, setGeneration] = useState<number>();
  const [documentId, setDocumentId] = useState("");
  const [title, setTitle] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [pdf, setPdf] = useState<File>();
  const [review, setReview] = useState<Review>();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const fetchReview = useCallback(async (nextDocumentId: string, versionId: string) => {
    const params = new URLSearchParams({ reviewDocumentId: nextDocumentId, reviewVersionId: versionId });
    const response = await fetch(`${endpoint}?${params}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Unable to load the persisted version for review.");
    const body = await response.json() as { generation: number; review: Review };
    setGeneration(body.generation);
    setDocumentId(nextDocumentId);
    setReview(body.review);
  }, [endpoint]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reviewDocumentId = params.get("reviewDocumentId");
    const reviewVersionId = params.get("reviewVersionId");
    const load = reviewDocumentId && reviewVersionId
      ? fetchReview(reviewDocumentId, reviewVersionId)
      : fetch(endpoint, { cache: "no-store" }).then(async (response) => {
          if (!response.ok) throw new Error("Knowledge workspace unavailable.");
          const body = await response.json() as { generation: number };
          setGeneration(body.generation);
        });
    void load.catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Knowledge unavailable."));
  }, [endpoint, fetchReview]);

  async function command(input: Record<string, unknown>) {
    const response = await fetch(endpoint, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error("Knowledge command rejected. Refresh and try again.");
    return response.json() as Promise<Record<string, unknown>>;
  }

  async function run(action: () => Promise<void>) {
    setBusy(true); setMessage("");
    try { await action(); } catch (error) {
      setMessage(error instanceof Error ? error.message : "Knowledge unavailable.");
    } finally { setBusy(false); }
  }

  return <main className="workspace-main" style={{ maxWidth: 920 }}>
    <div className="workspace-heading"><div><h1>Workspace knowledge</h1>
      <p>Published text is available to workspace members with source citations.</p></div></div>
    {isDemo && <Alert type="warning" showIcon message="Demo knowledge is shared" description="Use fictional or licensed text. Do not enter private information." />}
    {message && <Alert className="product-note" type="info" showIcon message={message} />}
    {canEdit && <div className="workspace-fields product-note">
      <Card className="workspace-panel" title="1 · Create a private draft" aria-label="Create a private draft">
      <div className="workspace-fields">
      <label className="workspace-field">Title <Input value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} /></label>
      <label className="workspace-field">Source label <Input value={sourceLabel} maxLength={160} onChange={(event) => setSourceLabel(event.target.value)} /></label>
      <Button type="primary" disabled={busy || !generation} loading={busy} onClick={() => void run(async () => {
        const result = await command({ action: "create", generation, title, sourceLabel });
        if (typeof result.documentId !== "string") throw new Error("Draft creation failed.");
        setDocumentId(result.documentId); setReview(undefined); setMessage("Private draft created. Add text next.");
      })}>Create draft</Button></div></Card>
      {documentId && <Card className="workspace-panel" title="2 · Stage a supported source">
        <p>Draft ID: <code className="workspace-code">{documentId}</code></p>
        <label className="workspace-field" htmlFor="source-text">Knowledge text
          <Input.TextArea id="source-text" value={sourceText} maxLength={100_000}
            onChange={(event) => setSourceText(event.target.value)} rows={9} />
        </label>
        <Button className="product-note" disabled={busy || !generation} loading={busy} onClick={() => void run(async () => {
          const result = await command({ action: "stage", generation, documentId, sourceText });
          if (typeof result.versionId !== "string") throw new Error("Text staging failed.");
          await fetchReview(documentId, result.versionId);
          const params = new URLSearchParams({ reviewDocumentId: documentId, reviewVersionId: result.versionId });
          window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
          setMessage("Text staged as PENDING. Index it, then review before publishing.");
        })}>Stage text</Button>
        <p className="product-note product-muted">Or select a text-native PDF, up to 5 MB and 12 pages. Scanned images are not supported.</p>
        <label className="workspace-field">Knowledge PDF
          <input type="file" accept="application/pdf" aria-label="Knowledge PDF"
            onChange={(event) => setPdf(event.target.files?.[0])} />
        </label>
        <Button className="product-note" disabled={busy || !generation || !pdf} loading={busy} onClick={() => void run(async () => {
          if (!pdf) return;
          const form = new FormData();
          form.set("file", pdf);
          form.set("documentId", documentId);
          form.set("generation", String(generation));
          const response = await fetch(`${endpoint}/pdf`, { method: "POST", body: form });
          if (!response.ok) throw new Error("PDF could not be staged. Use a smaller text-native PDF.");
          const result = await response.json() as { versionId: string };
          await fetchReview(documentId, result.versionId);
          const params = new URLSearchParams({ reviewDocumentId: documentId, reviewVersionId: result.versionId });
          window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
          setMessage("PDF text staged as PENDING. Index it, then review before publishing.");
        })}>Stage PDF text</Button>
      </Card>}
      {review && <Card className="workspace-panel" title="3 · Index, review and publish" aria-label="Index, review and publish">
        <p><strong>{review.title}</strong> — {review.sourceLabel}</p>
        <Space wrap><Tag>{review.sourceKind === "PDF_TEXT" ? "Text-native PDF" : "Plain text"}</Tag>
          <Tag color={review.indexState === "READY" ? "green" : review.indexState === "FAILED" ? "red" : "blue"}>{review.indexState}</Tag></Space>
        {review.indexError && <Alert className="product-note" type="error" showIcon message={review.indexError} />}
        <pre className="workspace-source-preview product-note">
          {review.sourceText.replace(/\f/g, "\n\n--- next page ---\n\n")}</pre>
        {(review.indexState === "PENDING" || review.indexState === "PROCESSING") &&
          <Button disabled={busy || !generation} loading={busy} onClick={() => void run(async () => {
            try {
              await command({ action: "index", generation,
                documentId: review.documentId, versionId: review.versionId });
              setMessage("Index READY. Review the source and publish when satisfied.");
            } finally { await fetchReview(review.documentId, review.versionId); }
          })}>{review.indexState === "PROCESSING" ? "Recover expired indexing" : "Index this version"}</Button>}
        {review.indexState === "FAILED" && <Button disabled={busy || !generation} loading={busy}
          onClick={() => void run(async () => {
            await command({ action: "retry", generation,
              documentId: review.documentId, versionId: review.versionId });
            await fetchReview(review.documentId, review.versionId);
            setMessage("Version returned to PENDING. Start indexing again.");
          })}>Retry failed index</Button>}
        {review.indexState === "READY" && <Button type="primary" disabled={busy || !generation} loading={busy} onClick={() => void run(async () => {
          await command({ action: "publish", generation,
            documentId: review.documentId, versionId: review.versionId });
          setReview(undefined);
          setHits([]);
          window.history.replaceState(null, "", window.location.pathname);
          setMessage("Version published for this workspace.");
        })}>Publish this reviewed version</Button>}
      </Card>}
    </div>}
    <Card className="workspace-panel product-note" title="Search published knowledge" aria-label="Search published knowledge">
      <div className="workspace-action-row"><label className="workspace-field" style={{ flex: 1, minWidth: 220 }}>Search text
        <Input value={query} maxLength={120} disabled={busy}
          onChange={(event) => setQuery(event.target.value)} />
      </label>
      <Button type="primary" disabled={busy || !query.trim()} loading={busy} onClick={() => void run(async () => {
        setHits([]);
        const params = new URLSearchParams({ query });
        const response = await fetch(`${endpoint}?${params}`, { cache: "no-store" });
        if (!response.ok) throw new Error("Search unavailable.");
        const body = await response.json() as { hits: Hit[] };
        setHits(body.hits);
        if (body.hits.length === 0) setMessage("No matching published knowledge. Check the source or ask for clarification.");
      })}>Search</Button></div>
      {hits.length === 0 ? <Empty className="product-note" description="Search for published knowledge in this workspace." /> :
      <div className="workspace-results">{hits.map((hit) => <article className="workspace-result" key={`${hit.citation.versionId}:${hit.citation.ordinal}`}>
        <p>{hit.content}</p>
        <p className="product-muted">{hit.citation.title} — {hit.citation.sourceLabel}, page {hit.citation.page}, {hit.citation.section}
          {" "}(version <code className="workspace-code">{hit.citation.versionId}</code>)</p>
      </article>)}</div>}
    </Card>
  </main>;
}
