"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, Empty, Input, Space, Tabs, Tag, Upload } from "antd";
import { useLatestRequest } from "@/lib/ui/use-latest-request";

type RequestState = ReturnType<ReturnType<typeof useLatestRequest>["begin"]> & { acceptLocation: () => void };
function assertCurrent(current: RequestState) {
  if (!current.isCurrent()) throw new DOMException("Obsolete knowledge request", "AbortError");
}
async function readResult<T>(request: Promise<Response>, current: RequestState, failure: string): Promise<T> {
  const response = await request;
  assertCurrent(current);
  if (!response.ok) throw new Error(failure);
  const body = await response.json() as T;
  assertCurrent(current);
  return body;
}

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
  const [loadError, setLoadError] = useState(false);
  const [loadVersion, setLoadVersion] = useState(0);
  const [activeTab, setActiveTab] = useState<"search" | "manage">("search");
  const requests = useLatestRequest();
  const beginRequest = useCallback((): RequestState => {
    const current = requests.begin();
    let location = window.location.pathname + window.location.search;
    return { ...current, isCurrent: () => current.isCurrent() && location === window.location.pathname + window.location.search,
      acceptLocation: () => { location = window.location.pathname + window.location.search; } };
  }, [requests]);

  const fetchReview = useCallback(async (nextDocumentId: string, versionId: string, current: RequestState) => {
    const params = new URLSearchParams({ reviewDocumentId: nextDocumentId, reviewVersionId: versionId });
    const body = await readResult<{ generation: number; review: Review }>(
      fetch(`${endpoint}?${params}`, { cache: "no-store", signal: current.signal }), current,
      "Unable to load the persisted version for review.");
    setGeneration(body.generation);
    setDocumentId(nextDocumentId);
    setReview(body.review);
  }, [endpoint]);

  useEffect(() => {
    const navigate = () => { requests.cancel(); setLoadVersion((value) => value + 1); };
    window.addEventListener("popstate", navigate);
    return () => window.removeEventListener("popstate", navigate);
  }, [requests]);

  useEffect(() => {
    const current = beginRequest();
    setGeneration(undefined); setDocumentId(""); setReview(undefined); setHits([]); setMessage("");
    setTitle(""); setSourceLabel(""); setSourceText(""); setPdf(undefined); setQuery("");
    setBusy(true); setLoadError(false);
    const params = new URLSearchParams(window.location.search);
    const reviewDocumentId = params.get("reviewDocumentId");
    const reviewVersionId = params.get("reviewVersionId");
    if (canEdit && reviewDocumentId && reviewVersionId) setActiveTab("manage");
    const load = canEdit && reviewDocumentId && reviewVersionId
      ? fetchReview(reviewDocumentId, reviewVersionId, current)
      : readResult<{ generation: number }>(fetch(endpoint, { cache: "no-store", signal: current.signal }), current,
          "Knowledge workspace unavailable.").then((body) => {
          setGeneration(body.generation);
        });
    void load.catch((error: unknown) => {
      if (!current.isCurrent()) return;
      setLoadError(true); setMessage(error instanceof Error ? error.message : "Knowledge unavailable.");
    }).finally(() => {
      if (current.isCurrent()) setBusy(false);
      current.finish();
    });
    return () => requests.cancel();
  }, [endpoint, fetchReview, beginRequest, requests, canEdit, isDemo, loadVersion]);

  async function command(input: Record<string, unknown>, current: RequestState) {
    assertCurrent(current);
    return readResult<Record<string, unknown>>(fetch(endpoint, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input), signal: current.signal,
    }), current, "Knowledge command rejected. Refresh and try again.");
  }

  async function run(action: (current: RequestState) => Promise<void>) {
    if (requests.pending()) return;
    const current = beginRequest();
    setBusy(true); setMessage("");
    try { await action(current); } catch (error) {
      if (!current.isCurrent()) return;
      setMessage(error instanceof Error ? error.message : "Knowledge unavailable.");
    } finally {
      if (current.isCurrent()) setBusy(false);
      current.finish();
    }
  }

  function replaceReviewUrl(current: RequestState, params?: URLSearchParams) {
    assertCurrent(current);
    window.history.replaceState(null, "", `${window.location.pathname}${params ? `?${params}` : ""}`);
    current.acceptLocation();
  }

  const searchContent = <Card className="workspace-panel product-note" title="Search knowledge" aria-label="Search published knowledge">
    <div className="workspace-action-row"><label className="workspace-field" style={{ flex: 1, minWidth: 220 }}>Search text
      <Input value={query} maxLength={120} disabled={busy}
        onChange={(event) => { setQuery(event.target.value); setHits([]); setMessage(""); }} />
    </label>
    <Button type="primary" aria-label="Search" aria-busy={busy} disabled={busy || !query.trim()} loading={busy} onClick={() => void run(async (current) => {
      setHits([]);
      const params = new URLSearchParams({ query });
      const body = await readResult<{ hits: Hit[] }>(fetch(`${endpoint}?${params}`, { cache: "no-store", signal: current.signal }), current,
        "Search unavailable.");
      setHits(body.hits);
      if (body.hits.length === 0) setMessage("No matching published knowledge. Check the source or ask for clarification.");
    })}>Search</Button></div>
    {hits.length === 0 ? <Empty className="product-note" description="Search for published knowledge in this workspace." /> :
    <div className="workspace-results">{hits.map((hit) => <article className="workspace-result" key={`${hit.citation.versionId}:${hit.citation.ordinal}`}>
      <p>{hit.content}</p>
      <p className="product-muted">{hit.citation.title} — {hit.citation.sourceLabel}, page {hit.citation.page}, {hit.citation.section}</p>
      <details><summary>Technical version ID</summary><code className="workspace-code">{hit.citation.versionId}</code></details>
    </article>)}</div>}
  </Card>;

  const manageContent = canEdit && <div className="workspace-fields">
    <Card className="workspace-panel" title="1 · Create a private draft" aria-label="Create a private draft">
    <div className="workspace-fields">
    <label className="workspace-field">Title <Input value={title} disabled={busy} maxLength={160} onChange={(event) => setTitle(event.target.value)} /></label>
    <label className="workspace-field">Source label <Input value={sourceLabel} disabled={busy} maxLength={160} onChange={(event) => setSourceLabel(event.target.value)} /></label>
    <Button type="primary" disabled={busy || !generation || !title.trim() || !sourceLabel.trim()} loading={busy} onClick={() => void run(async (current) => {
      const result = await command({ action: "create", generation, title, sourceLabel }, current);
      if (typeof result.documentId !== "string") throw new Error("Draft creation failed.");
      setDocumentId(result.documentId); setReview(undefined); setSourceText(""); setPdf(undefined);
      replaceReviewUrl(current); setMessage("Private draft created. Add text next.");
    })}>Create draft</Button></div></Card>
    {documentId && <Card className="workspace-panel" title="2 · Add a source for review">
      <details><summary>Technical draft ID</summary><code className="workspace-code">{documentId}</code></details>
      <label className="workspace-field" htmlFor="source-text">Knowledge text
        <Input.TextArea id="source-text" value={sourceText} disabled={busy} maxLength={100_000}
          onChange={(event) => setSourceText(event.target.value)} rows={9} />
      </label>
      <Button className="product-note" disabled={busy || !generation || !sourceText.trim()} loading={busy} onClick={() => void run(async (current) => {
        const result = await command({ action: "stage", generation, documentId, sourceText }, current);
        if (typeof result.versionId !== "string") throw new Error("Text staging failed.");
        await fetchReview(documentId, result.versionId, current);
        const params = new URLSearchParams({ reviewDocumentId: documentId, reviewVersionId: result.versionId });
        replaceReviewUrl(current, params);
        setMessage("Text added to review as PENDING. Prepare it for search before reviewing and publishing.");
      })}>Add text for review</Button>
      <p className="product-note product-muted">Or select a text-native PDF, up to 5 MB and 12 pages. Scanned images are not supported.</p>
      <label className="workspace-field">Knowledge PDF
        <Upload accept="application/pdf" aria-label="Knowledge PDF" maxCount={1} disabled={busy}
          beforeUpload={(file) => { setPdf(file); return false; }}
          onRemove={() => { setPdf(undefined); return true; }}
          fileList={pdf ? [{ uid: "knowledge-pdf", name: pdf.name }] : []}>
          <Button disabled={busy}>Select PDF</Button>
        </Upload>
      </label>
      <Button className="product-note" disabled={busy || !generation || !pdf} loading={busy} onClick={() => void run(async (current) => {
        if (!pdf) return;
        const form = new FormData();
        form.set("file", pdf);
        form.set("documentId", documentId);
        form.set("generation", String(generation));
        const result = await readResult<{ versionId: string }>(fetch(`${endpoint}/pdf`, { method: "POST", body: form, signal: current.signal }),
          current, "PDF could not be staged. Use a smaller text-native PDF.");
        await fetchReview(documentId, result.versionId, current);
        const params = new URLSearchParams({ reviewDocumentId: documentId, reviewVersionId: result.versionId });
        replaceReviewUrl(current, params);
        setMessage("PDF text added to review as PENDING. Prepare it for search before reviewing and publishing.");
      })}>Add PDF text for review</Button>
    </Card>}
    {review && <Card className="workspace-panel" title="3 · Review and publish" aria-label="Review and publish">
      <p><strong>{review.title}</strong> — {review.sourceLabel}</p>
      <Space wrap><Tag>{review.sourceKind === "PDF_TEXT" ? "Text-native PDF" : "Plain text"}</Tag>
        <Tag color={review.indexState === "READY" ? "green" : review.indexState === "FAILED" ? "red" : "blue"}>{review.indexState}</Tag></Space>
      <p className="product-muted">{{
        PENDING: "This version is waiting for search preparation.",
        PROCESSING: "Search preparation is still running or may need recovery if it expired.",
        READY: "This version is prepared. Publishing makes it available in workspace search.",
        FAILED: "Search preparation failed. Review the error and retry.",
      }[review.indexState]}</p>
      {review.indexError && <Alert className="product-note" type="error" showIcon message={review.indexError} />}
      <pre className="workspace-source-preview product-note">
        {review.sourceText.replace(/\f/g, "\n\n--- next page ---\n\n")}</pre>
      <details><summary>Technical version ID</summary><code className="workspace-code">{review.versionId}</code></details>
      {(review.indexState === "PENDING" || review.indexState === "PROCESSING") &&
        <Button disabled={busy || !generation} loading={busy} onClick={() => void run(async (current) => {
          try {
            await command({ action: "index", generation,
              documentId: review.documentId, versionId: review.versionId }, current);
            setMessage("Search preparation completed. Review the source and publish when satisfied.");
          } finally { if (current.isCurrent()) await fetchReview(review.documentId, review.versionId, current); }
        })}>{review.indexState === "PROCESSING" ? "Recover expired indexing" : "Prepare for search"}</Button>}
      {review.indexState === "FAILED" && <Button disabled={busy || !generation} loading={busy}
        onClick={() => void run(async (current) => {
          await command({ action: "retry", generation,
            documentId: review.documentId, versionId: review.versionId }, current);
          await fetchReview(review.documentId, review.versionId, current);
          setMessage("Version returned to PENDING. Prepare it for search again.");
        })}>Retry failed index</Button>}
      {review.indexState === "READY" && <Button type="primary" disabled={busy || !generation} loading={busy} onClick={() => void run(async (current) => {
        await command({ action: "publish", generation,
          documentId: review.documentId, versionId: review.versionId }, current);
        setReview(undefined);
        setHits([]);
        replaceReviewUrl(current);
        setMessage("Version published for this workspace.");
      })}>Publish this reviewed version</Button>}
    </Card>}
  </div>;

  return <main className="workspace-main" style={{ maxWidth: 920 }}>
    <div className="workspace-heading"><div><h1>Workspace knowledge</h1>
      <p>Published text is available to workspace members with source citations.</p></div></div>
    {isDemo && <Alert type="warning" showIcon message="Demo knowledge is shared" description="Use fictional or licensed text. Do not enter private information." />}
    {message && <Alert className="product-note" type="info" showIcon message={message} />}
    {loadError && <Button className="product-note" onClick={() => setLoadVersion((value) => value + 1)}>Retry knowledge workspace</Button>}
    {canEdit ? <Tabs aria-label="Knowledge workspace sections" activeKey={activeTab}
      onChange={(key) => setActiveTab(key as "search" | "manage")} destroyOnHidden={false}
      items={[{ key: "search", label: "Search knowledge", children: searchContent },
        { key: "manage", label: "Manage knowledge", children: manageContent }]} /> : searchContent}
  </main>;
}
