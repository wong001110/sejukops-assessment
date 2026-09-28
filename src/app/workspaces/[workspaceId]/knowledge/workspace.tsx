"use client";

import { useCallback, useEffect, useState } from "react";

type Review = {
  documentId: string;
  versionId: string;
  title: string;
  sourceLabel: string;
  sourceText: string;
  indexState: "READY";
};
type Hit = {
  content: string;
  citation: {
    documentId: string;
    versionId: string;
    section: string;
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

  return <main style={{ maxWidth: 760, margin: "3rem auto", padding: "0 1rem", lineHeight: 1.6 }}>
    <h1>Workspace knowledge</h1>
    <p>Plain text only. Published knowledge is visible to members of this workspace. Search matches literal text.</p>
    {isDemo && <p>Demo knowledge is shared. Use fictional or licensed text; do not enter private information.</p>}
    {message && <p role="status">{message}</p>}
    {canEdit && <section aria-labelledby="create-heading">
      <h2 id="create-heading">1. Create a private draft</h2>
      <label>Title <input value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} /></label>{" "}
      <label>Source label <input value={sourceLabel} maxLength={160} onChange={(event) => setSourceLabel(event.target.value)} /></label>{" "}
      <button disabled={busy || !generation} onClick={() => void run(async () => {
        const result = await command({ action: "create", generation, title, sourceLabel });
        if (typeof result.documentId !== "string") throw new Error("Draft creation failed.");
        setDocumentId(result.documentId); setReview(undefined); setMessage("Private draft created. Add text next.");
      })}>Create draft</button>
      {documentId && <>
        <h2>2. Stage text</h2>
        <p>Draft ID: <code>{documentId}</code></p>
        <label htmlFor="source-text">Knowledge text</label>
        <textarea id="source-text" value={sourceText} maxLength={100_000}
          onChange={(event) => setSourceText(event.target.value)} rows={10}
          style={{ display: "block", width: "100%" }} />
        <button disabled={busy || !generation} onClick={() => void run(async () => {
          const result = await command({ action: "stage", generation, documentId, sourceText });
          if (typeof result.versionId !== "string") throw new Error("Text staging failed.");
          await fetchReview(documentId, result.versionId);
          const params = new URLSearchParams({ reviewDocumentId: documentId, reviewVersionId: result.versionId });
          window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
          setMessage("Text staged. Review the persisted version before publishing.");
        })}>Stage text for review</button>
      </>}
      {review && <section aria-labelledby="review-heading">
        <h2 id="review-heading">3. Review and publish</h2>
        <p><strong>{review.title}</strong> — {review.sourceLabel}</p>
        <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{review.sourceText}</pre>
        <button disabled={busy || !generation} onClick={() => void run(async () => {
          await command({ action: "publish", generation,
            documentId: review.documentId, versionId: review.versionId });
          setReview(undefined);
          window.history.replaceState(null, "", window.location.pathname);
          setMessage("Version published for this workspace.");
        })}>Publish this reviewed version</button>
      </section>}
    </section>}
    <section aria-labelledby="search-heading">
      <h2 id="search-heading">Search published knowledge</h2>
      <label>Search text <input value={query} maxLength={120} onChange={(event) => setQuery(event.target.value)} /></label>{" "}
      <button disabled={busy} onClick={() => void run(async () => {
        const params = new URLSearchParams({ query });
        const response = await fetch(`${endpoint}?${params}`, { cache: "no-store" });
        if (!response.ok) throw new Error("Search unavailable.");
        const body = await response.json() as { hits: Hit[] };
        setHits(body.hits);
        if (body.hits.length === 0) setMessage("No matching published knowledge. Check the source or ask for clarification.");
      })}>Search</button>
      <ul>{hits.map((hit) => <li key={`${hit.citation.versionId}:${hit.citation.ordinal}`}>
        <p>{hit.content}</p>
        <small>{hit.citation.title} — {hit.citation.sourceLabel}, {hit.citation.section}
          {" "}(version <code>{hit.citation.versionId}</code>)</small>
      </li>)}</ul>
    </section>
  </main>;
}
