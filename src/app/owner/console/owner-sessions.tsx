"use client";

import { Alert, Button, Empty, Select, Skeleton, Tag } from "antd";
import { useCallback, useEffect, useState } from "react";
import { aiSessionDetailResponseSchema, aiSessionListResponseSchema, type AiSessionSummary } from "@/domain/ai-sessions/contracts";
import { formatMalaysiaDateTime } from "@/lib/time/malaysia";
import { useLatestRequest } from "@/lib/ui/use-latest-request";
import styles from "./owner-console.module.css";
import type { z } from "zod";

type SessionDetail = z.infer<typeof aiSessionDetailResponseSchema>;
type WorkspaceOption = z.infer<typeof aiSessionListResponseSchema>["workspaces"][number];
type LoadState = "loading" | "ready" | "error" | "stopped";
const activityLabels = { recentOrders: "Read recent orders", readOrder: "Read an order", searchKnowledge: "Search published knowledge",
  listTechnicians: "Read active technicians", prepareAssignment: "Save an assignment proposal" };
const statuses = { RUNNING: "Running", COMPLETED: "Completed", FAILED: "Failed", INTERRUPTED: "Interrupted" };

export function OwnerSessions() {
  const [workspaceId, setWorkspaceId] = useState("");
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [sessions, setSessions] = useState<AiSessionSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [listState, setListState] = useState<LoadState>("loading");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail>();
  const [detailState, setDetailState] = useState<LoadState>("ready");
  const [reload, setReload] = useState(0);
  const listRequests = useLatestRequest();
  const detailRequests = useLatestRequest();

  const loadList = useCallback(async (cursor?: string) => {
    const request = listRequests.begin();
    setListState("loading");
    const params = new URLSearchParams();
    if (workspaceId) params.set("workspaceId", workspaceId);
    if (cursor) params.set("cursor", cursor);
    try {
      const response = await fetch(`/api/owner/ai-sessions${params.size ? `?${params}` : ""}`, { cache: "no-store", signal: request.signal });
      if (!response.ok) throw new Error("Session list unavailable");
      const result = aiSessionListResponseSchema.parse(await response.json());
      if (!request.isCurrent()) return;
      if (workspaceId && result.sessions.some((item) => item.workspaceId !== workspaceId)) throw new Error("Session scope mismatch");
      setSessions((previous) => cursor ? [...previous, ...result.sessions.filter((item) => !previous.some((old) => old.id === item.id))] : result.sessions);
      setWorkspaces(result.workspaces); setNextCursor(result.nextCursor); setListState("ready");
    } catch {
      if (request.isCurrent()) setListState("error");
    } finally { request.finish(); }
  }, [listRequests, workspaceId]);
  useEffect(() => {
    setSessions([]); setNextCursor(null); setSelectedId(null); setDetail(undefined);
    detailRequests.cancel();
    void loadList();
    return () => listRequests.cancel();
  }, [detailRequests, listRequests, loadList]);

  useEffect(() => {
    if (!selectedId) return;
    const request = detailRequests.begin();
    setDetail(undefined); setDetailState("loading");
    void (async () => {
      try {
        const response = await fetch(`/api/owner/ai-sessions/${encodeURIComponent(selectedId)}`, { cache: "no-store", signal: request.signal });
        if (!response.ok) throw new Error("Session detail unavailable");
        const result = aiSessionDetailResponseSchema.parse(await response.json());
        if (!request.isCurrent()) return;
        if (result.session.id !== selectedId || (workspaceId && result.session.workspaceId !== workspaceId)) throw new Error("Session scope mismatch");
        setDetail(result); setDetailState("ready");
      } catch {
        if (request.isCurrent()) setDetailState("error");
      } finally { request.finish(); }
    })();
    return () => detailRequests.cancel();
  }, [detailRequests, reload, selectedId, workspaceId]);

  function filter(next: string) {
    listRequests.cancel(); detailRequests.cancel(); setSelectedId(null); setDetail(undefined); setSessions([]); setWorkspaceId(next);
  }
  const selectedDetail = detail?.session.id === selectedId ? detail : undefined;
  return <section className={styles.sessions} aria-label="Saved AI sessions">
    <div className={styles.sessionToolbar}>
      <label htmlFor="owner-session-workspace">Workspace</label>
      <Select id="owner-session-workspace" aria-label="Workspace" className={styles.workspaceFilter} value={workspaceId} onChange={filter}
        virtual={false} options={[{ value: "", label: "All workspaces" }, ...workspaces.map((item) => ({
          value: item.id, label: `${item.name} · ${item.kind === "OWNER" ? "Owner" : "Demo"}`,
        }))]} />
      <Button disabled={listState === "loading"} onClick={() => void loadList()}>Refresh sessions</Button>
      {listState === "loading" ? <Button onClick={() => { listRequests.cancel(); setListState("stopped"); }}>Cancel loading sessions</Button> : null}
    </div>
    <p className={styles.sessionNotice}>Read-only history. Sessions are recorded from this update onward; earlier browser-only conversations are unavailable.</p>
    <div className={styles.sessionGrid}>
      <section className={styles.sessionList} aria-label="Session list" aria-busy={listState === "loading"}>
        {listState === "error" ? <Alert type="error" showIcon message="Sessions could not be loaded."
          description="Check the connection and your current Owner access, then retry."
          action={<Button onClick={() => void loadList()}>Retry session list</Button>} /> : null}
        {listState === "stopped" ? <Alert type="info" message="Session loading stopped." action={<Button onClick={() => void loadList()}>Retry session list</Button>} /> : null}
        {listState === "loading" && !sessions.length ? <div role="status" aria-label="Loading sessions"><Skeleton active /></div> : null}
        {listState === "ready" && !sessions.length ? <Empty description="No recorded sessions in this workspace." /> : null}
        <ul>{sessions.map((session) => <li key={session.id}><button type="button" aria-pressed={selectedId === session.id} onClick={() => setSelectedId(session.id)}>
          <strong>{session.title}</strong><small>{session.workspaceKind === "OWNER" ? "Owner" : "Demo"} · {session.surface === "WORKSPACE" ? "AI Workspace" : "Chatbot"} · {session.turnCount} turn{session.turnCount === 1 ? "" : "s"}</small>
          <small>{formatMalaysiaDateTime(session.updatedAt)} MYT</small>
        </button></li>)}</ul>
        {nextCursor ? <div className={styles.sessionActions}><Button loading={listState === "loading"} disabled={listState === "loading"}
          onClick={() => void loadList(nextCursor)}>Load more sessions</Button></div> : null}
      </section>
      <section className={styles.sessionDetail} aria-label="Session detail" aria-busy={detailState === "loading"}>
        {!selectedId ? <Empty description="Select a session to inspect its recorded conversation." /> : null}
        {selectedId && detailState === "loading" ? <><div role="status" aria-label="Loading session detail"><Skeleton active /></div>
          <Button onClick={() => { detailRequests.cancel(); setDetailState("stopped"); }}>Cancel loading detail</Button></> : null}
        {selectedId && (detailState === "error" || detailState === "stopped") ? <Alert type={detailState === "error" ? "error" : "info"} showIcon
          message={detailState === "error" ? "This session could not be loaded." : "Session detail loading stopped."}
          description="It may be unavailable for your current account. Retry to check the saved record."
          action={<Button onClick={() => setReload((value) => value + 1)}>Retry session detail</Button>} /> : null}
        {selectedDetail ? <><h2>{selectedDetail.session.title}</h2>
          <p className={styles.sessionNotice}>{selectedDetail.session.workspaceKind === "OWNER" ? "Owner" : "Demo"} · {selectedDetail.session.role} · Recorded results; actions are unavailable here.</p>
          <p className={styles.sessionNotice}>Historical snapshot. Current records may have changed; browsing this history does not update them.</p>
          {!selectedDetail.turns.length ? <Empty description="No recorded turns are available for this session." /> : null}
          <ol className={styles.sessionTurns}>{selectedDetail.turns.map((turn) => <li key={turn.id}>
            <h3>Request</h3><p>{turn.question}</p>
            <div className={styles.turnMeta}><Tag color={turn.status === "COMPLETED" ? "green" : turn.status === "FAILED" ? "red" : "default"}>{statuses[turn.status]}</Tag>
              <time dateTime={turn.createdAt}>{formatMalaysiaDateTime(turn.createdAt)} MYT</time></div>
            {turn.answer ? <><h3>Recorded answer</h3><p>{turn.answer}</p></> : !turn.workspace ? <p className={styles.sessionNotice}>No completed answer was recorded.</p> : null}
            {turn.workspace ? <div className={styles.recordedResult}><h3>{turn.workspace.title}</h3><p>{turn.workspace.summary}</p>
              <Tag>{turn.workspace.status}</Tag><Tag>{turn.workspace.mode === "mock" ? "Mock result" : "Live result"}</Tag>
              {turn.workspace.items.map((item) => <div key={item.order.id}><p><strong>{item.order.order_no}</strong> · {item.order.service_type} · {item.order.status}</p>
                <p>{item.order.problem_description}</p><p className={styles.sessionNotice}>{item.order.scheduled_at && Number.isFinite(Date.parse(item.order.scheduled_at))
                  ? `Recorded schedule: ${formatMalaysiaDateTime(item.order.scheduled_at)} MYT` : "No schedule recorded."}</p></div>)}
              {turn.workspace.excerpts.map((excerpt) => <blockquote key={`${excerpt.citation.versionId}:${excerpt.citation.ordinal}`}>{excerpt.text}<footer>{excerpt.citation.title} · {excerpt.citation.section} · p. {excerpt.citation.page}</footer></blockquote>)}
              {turn.workspace.proposal ? <p>Recorded proposal: {turn.workspace.proposal.orderNo} · {turn.workspace.proposal.status}. Open the current workspace to review its present state.</p> : null}
              {turn.workspace.missingInformation.length ? <><h3>Recorded missing information</h3><ul>{turn.workspace.missingInformation.map((item, index) => <li key={index}>{item}</li>)}</ul></> : null}
            </div> : null}
            {turn.activity.length ? <><h3>Recorded execution</h3><ul className={styles.activity}>{turn.activity.map((event) => <li key={event.id}>{activityLabels[event.tool]} · {event.status === "running" ? "Last recorded: running; outcome unconfirmed" : event.status}{event.count !== undefined ? ` · ${event.count} returned` : ""}</li>)}</ul></> : null}
          </li>)}</ol>
        </> : null}
      </section>
    </div>
  </section>;
}
