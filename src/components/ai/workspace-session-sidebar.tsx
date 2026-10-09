"use client";

import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Empty, Spin } from "antd";
import { useEffect, useRef, useState } from "react";
import { aiSessionDetailResponseSchema, aiSessionListResponseSchema, type AiSessionSummary } from "@/domain/ai-sessions/contracts";
import { formatMalaysiaDateTime } from "@/lib/time/malaysia";
import { useLatestRequest } from "@/lib/ui/use-latest-request";
import type { AiSessionDetail } from "./session-history";
import styles from "./workspace-session-sidebar.module.css";

export type WorkspaceSessionSidebarProps = {
  workspaceId: string;
  contextKey: string;
  selectedSessionId?: string;
  busy: boolean;
  revision: number;
  onNew: () => void;
  onRestore: (detail: AiSessionDetail) => void;
};

const MAX_VISIBLE_SESSIONS = 120;

/** The parent owns the desktop aside/mobile drawer and active conversation. */
export function WorkspaceSessionSidebar(props: WorkspaceSessionSidebarProps) {
  return <SessionSidebarBody key={JSON.stringify([props.workspaceId, props.contextKey])} {...props} />;
}

function SessionSidebarBody({ workspaceId, selectedSessionId, busy, revision, onNew, onRestore }: WorkspaceSessionSidebarProps) {
  const [sessions, setSessions] = useState<AiSessionSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [retryRevision, setRetryRevision] = useState(0);
  const listRequests = useLatestRequest();
  const detailRequests = useLatestRequest();
  const endpoint = `/api/workspaces/${encodeURIComponent(workspaceId)}/ai-sessions`;
  const latest = useRef({ busy, revision, onRestore });

  useEffect(() => { latest.current = { busy, revision, onRestore }; }, [busy, revision, onRestore]);

  useEffect(() => {
    if (busy) {
      detailRequests.cancel();
      setRestoringId(null);
    }
  }, [busy, detailRequests]);

  useEffect(() => {
    detailRequests.cancel();
    setRestoringId(null);
    setSessions([]);
    setCursor(null);
    const current = listRequests.begin();
    setLoading(true);
    setError("");
    void fetch(`${endpoint}?surface=WORKSPACE`, { cache: "no-store", signal: current.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const data = aiSessionListResponseSchema.parse(await response.json());
        if (data.sessions.some((session) => session.workspaceId !== workspaceId || session.surface !== "WORKSPACE")) throw new Error();
        if (current.isCurrent()) {
          setSessions(data.sessions);
          setCursor(data.nextCursor);
        }
      })
      .catch(() => { if (current.isCurrent()) setError("Conversation history is unavailable. You can start a new conversation or retry."); })
      .finally(() => { if (current.isCurrent()) setLoading(false); current.finish(); });
    return () => { listRequests.cancel(); detailRequests.cancel(); };
  }, [endpoint, workspaceId, revision, retryRevision, listRequests, detailRequests]);

  async function loadMore() {
    if (!cursor || listRequests.pending() || detailRequests.pending() || sessions.length >= MAX_VISIBLE_SESSIONS) return;
    const current = listRequests.begin();
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${endpoint}?surface=WORKSPACE&cursor=${encodeURIComponent(cursor)}`, { cache: "no-store", signal: current.signal });
      if (!response.ok) throw new Error();
      const data = aiSessionListResponseSchema.parse(await response.json());
      if (data.sessions.some((session) => session.workspaceId !== workspaceId || session.surface !== "WORKSPACE")) throw new Error();
      if (current.isCurrent()) {
        setSessions((items) => [...items, ...data.sessions.filter((session) => !items.some(({ id }) => id === session.id))].slice(0, MAX_VISIBLE_SESSIONS));
        setCursor(data.nextCursor === cursor ? null : data.nextCursor);
      }
    } catch {
      if (current.isCurrent()) setError("More conversations could not be loaded. Retry history.");
    } finally {
      if (current.isCurrent()) setLoading(false);
      current.finish();
    }
  }

  async function restore(id: string) {
    if (busy || listRequests.pending() || detailRequests.pending() || !sessions.some((session) => session.id === id)) return;
    const current = detailRequests.begin();
    const startedRevision = revision;
    setRestoringId(id);
    setError("");
    try {
      const response = await fetch(`${endpoint}/${encodeURIComponent(id)}?surface=WORKSPACE`, { cache: "no-store", signal: current.signal });
      if (!response.ok) throw new Error();
      const detail = aiSessionDetailResponseSchema.parse(await response.json());
      if (detail.session.id !== id || detail.session.workspaceId !== workspaceId || detail.session.surface !== "WORKSPACE") throw new Error();
      if (detail.turns.some((turn) => turn.workspace && turn.workspace.workspaceId !== workspaceId)) throw new Error();
      if (current.isCurrent() && !latest.current.busy && latest.current.revision === startedRevision) latest.current.onRestore(detail);
    } catch {
      if (current.isCurrent()) setError("This conversation is no longer available in your current scope. Retry history.");
    } finally {
      if (current.isCurrent()) setRestoringId(null);
      current.finish();
    }
  }

  function startNew() {
    detailRequests.cancel();
    setRestoringId(null);
    setError("");
    onNew();
  }

  return <div className={styles.sidebar}>
    <Button block icon={<PlusOutlined />} aria-label="New conversation" onClick={startNew}>New conversation</Button>
    <div className={styles.heading}>
      <h2>Conversations</h2>
      <Button type="text" size="small" icon={<ReloadOutlined />} aria-label="Refresh conversations" disabled={loading || !!restoringId} onClick={() => setRetryRevision((value) => value + 1)} />
    </div>
    <p className={styles.scope}>Private to your current workspace and role.</p>
    <div className={styles.list} aria-busy={loading || !!restoringId}>
      {error && <Alert type="warning" showIcon message={error} action={<Button size="small" disabled={loading || !!restoringId} onClick={() => setRetryRevision((value) => value + 1)}>Retry history</Button>} />}
      {loading && <div className={styles.loading}><Spin size="small" aria-label="Loading conversation history" /><span role="status">Loading conversations…</span></div>}
      {!loading && !sessions.length && !error && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No saved conversations yet" />}
      <ul className={styles.sessions}>
        {sessions.map((session) => <li key={session.id}>
          <button type="button" className={`${styles.session} ${selectedSessionId === session.id ? styles.selected : ""}`}
            aria-label={`Open saved conversation: ${session.title || "Untitled conversation"}`}
            aria-current={selectedSessionId === session.id ? "page" : undefined}
            disabled={busy || loading || !!restoringId} onClick={() => void restore(session.id)}>
            <span className={styles.title}>{session.title || "Untitled conversation"}</span>
            <span className={styles.meta}>{session.turnCount} request{session.turnCount === 1 ? "" : "s"} · {session.role}</span>
            <span className={styles.meta}>{formatMalaysiaDateTime(session.updatedAt)} MYT</span>
            {restoringId === session.id && <span role="status">Opening saved conversation…</span>}
          </button>
        </li>)}
      </ul>
      {cursor && sessions.length < MAX_VISIBLE_SESSIONS && <Button block type="text" disabled={loading || !!restoringId} onClick={() => void loadMore()}>Load more conversations</Button>}
      {sessions.length >= MAX_VISIBLE_SESSIONS && <p className={styles.scope}>Showing the latest {MAX_VISIBLE_SESSIONS} conversations.</p>}
    </div>
    <p className={styles.historyNotice}>Saved conversations open as read-only history. Results are snapshots; opening one does not restart tasks or enable past approvals.</p>
  </div>;
}
