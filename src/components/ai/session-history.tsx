"use client";
import { Alert, Button, Drawer, Empty, List, Spin, Tag } from "antd";
import { useEffect, useState } from "react";
import { aiSessionDetailResponseSchema, aiSessionListResponseSchema, type AiSessionSurface, type AiSessionSummary } from "@/domain/ai-sessions/contracts";
import type { z } from "zod";
import { useLatestRequest } from "@/lib/ui/use-latest-request";
import { formatMalaysiaDateTime } from "@/lib/time/malaysia";
export type AiSessionDetail = z.infer<typeof aiSessionDetailResponseSchema>;
type Props = { workspaceId: string; surface: AiSessionSurface; disabled: boolean; onRestore: (detail: AiSessionDetail) => void };
export function SessionHistory({ workspaceId, surface, disabled, onRestore }: Props) {
  const [open, setOpen] = useState(false);
  return <><Button disabled={disabled} onClick={() => setOpen(true)}>Conversation history</Button>
    <Drawer title="Your conversations" open={open} width={420} onClose={() => setOpen(false)} destroyOnHidden>
      {open && <HistoryList key={`${workspaceId}:${surface}`} workspaceId={workspaceId} surface={surface}
        onRestore={(detail) => { onRestore(detail); setOpen(false); }} />}
    </Drawer></>;
}
function HistoryList({ workspaceId, surface, onRestore }: Omit<Props, "disabled">) {
  const [sessions, setSessions] = useState<AiSessionSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const requests = useLatestRequest();
  const endpoint = `/api/workspaces/${workspaceId}/ai-sessions`;
  useEffect(() => {
    const current = requests.begin(); setLoading(true); setError("");
    void fetch(`${endpoint}?surface=${surface}`, { cache: "no-store", signal: current.signal }).then(async (response) => {
      if (!response.ok) throw new Error();
      const data = aiSessionListResponseSchema.parse(await response.json());
      if (current.isCurrent()) { setSessions(data.sessions); setCursor(data.nextCursor); }
    }).catch(() => { if (current.isCurrent()) setError("Conversation history is unavailable. You can continue with a new conversation."); })
      .finally(() => { if (current.isCurrent()) setLoading(false); current.finish(); });
    return () => requests.cancel();
  }, [endpoint, surface, requests, revision]);
  async function more() {
    if (!cursor || requests.pending()) return;
    const current = requests.begin(); setLoading(true); setError("");
    try {
      const response = await fetch(`${endpoint}?surface=${surface}&cursor=${encodeURIComponent(cursor)}`, { cache: "no-store", signal: current.signal });
      if (!response.ok) throw new Error();
      const data = aiSessionListResponseSchema.parse(await response.json());
      if (current.isCurrent()) { setSessions((items) => [...items, ...data.sessions.filter((item) => !items.some(({ id }) => id === item.id))]); setCursor(data.nextCursor); }
    } catch { if (current.isCurrent()) setError("More conversations could not be loaded. Retry history."); }
    finally { if (current.isCurrent()) setLoading(false); current.finish(); }
  }
  async function restore(id: string) {
    if (requests.pending()) return;
    const current = requests.begin(); setLoading(true); setError("");
    try {
      const response = await fetch(`${endpoint}/${id}?surface=${surface}`, { cache: "no-store", signal: current.signal });
      if (!response.ok) throw new Error();
      const detail = aiSessionDetailResponseSchema.parse(await response.json());
      if (detail.session.id !== id || detail.session.workspaceId !== workspaceId || detail.session.surface !== surface) throw new Error();
      if (current.isCurrent()) onRestore(detail);
    } catch { if (current.isCurrent()) setError("This conversation is no longer available in your current scope."); }
    finally { if (current.isCurrent()) setLoading(false); current.finish(); }
  }
  return <div className="session-history-list"><p>History is private to your current workspace and role. Older browser-only conversations were not saved.</p>
    <p>Opening history does not restart tasks. Historical results need a fresh request before any action.</p>
    {error && <Alert type="warning" message={error} action={<Button onClick={() => setRevision((value) => value + 1)}>Retry history</Button>} />}
    {loading && <Spin aria-label="Loading conversation history" />}
    {!loading && !sessions.length && !error && <Empty description="No recorded conversations yet" />}
    <List dataSource={sessions} renderItem={(session) => <List.Item><Button block type="text" disabled={loading}
      style={{ height: "auto", textAlign: "left", whiteSpace: "normal" }} onClick={() => void restore(session.id)}>
      <span><strong>{session.title}</strong><br /><Tag>{session.role}</Tag>{session.turnCount} request(s) · {formatMalaysiaDateTime(session.updatedAt)} MYT</span>
    </Button></List.Item>} />
    {cursor && <Button disabled={loading} onClick={() => void more()}>Load more conversations</Button>}
  </div>;
}
