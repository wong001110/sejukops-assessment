"use client";

import { ArrowUpOutlined, CheckCircleOutlined, CloseOutlined, ExpandOutlined, MenuOutlined, MessageOutlined, ReloadOutlined, RobotOutlined, ShrinkOutlined, StopOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Descriptions, Drawer, Empty, Input, Skeleton, Tag } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { nativeProposalSchema, type NativeActivity, type NativeAgentRequest, type NativeProposal, type NativeWorkspace } from "@/domain/agent-workspace/contracts";
import { readNativeAgentStream } from "@/lib/ai/client/native-agent-stream";
import { formatMalaysiaDateTime } from "@/lib/time/malaysia";
import { useLatestRequest } from "@/lib/ui/use-latest-request";
import { AI_SESSION_HEADER } from "@/domain/ai-sessions/contracts";
import { SessionHistory, type AiSessionDetail } from "@/components/ai/session-history";
import { WorkspaceSessionSidebar } from "@/components/ai/workspace-session-sidebar";
import "./native-task-workspace.css";
import "./native-studio.css";

type Props = {
  workspaceId: string;
  focusOrderId?: string;
  canAssign: boolean;
  manualTask: "assign" | "reschedule" | null;
  isGuest: boolean;
  contextKey?: string;
  presentation?: "floating" | "embedded" | "studio";
};
type Message = { id: number; role: "user" | "assistant"; content: string };
type RunState = "idle" | "running" | "ready" | "error" | "cancelled";
const labels: Record<NativeActivity["tool"], string> = {
  recentOrders: "Read recent orders", readOrder: "Read an order", searchKnowledge: "Search published knowledge",
  listTechnicians: "Read active technicians", prepareAssignment: "Save an assignment proposal",
};
const viewLabels: Record<NativeWorkspace["type"], string> = {
  focus: "Focus", investigation: "Investigation", comparison: "Comparison", knowledge: "Knowledge", clarification: "Clarification",
};

function ExecutionPanel({ activity, state, sourceOnly }: { activity: NativeActivity[]; state: RunState; sourceOnly: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const eventList = useRef<HTMLOListElement>(null);
  const busy = state === "running";
  useEffect(() => { eventList.current?.scrollTo({ top: eventList.current.scrollHeight, behavior: "auto" }); }, [activity, busy, expanded]);
  const completed = activity.filter((item) => item.status === "succeeded").length;
  const failed = activity.filter((item) => item.status === "failed").length;
  const status = busy ? "Running" : state === "cancelled" ? "Stopped" : state === "error" ? "Failed" : sourceOnly ? "Sources only" : "Completed";
  const rows = <ol ref={eventList} className="native-execution-events">{activity.map((item) => {
    const unfinished = item.status === "running" && !busy;
    const label = unfinished ? state === "cancelled" ? "Stopped waiting" : "Outcome unconfirmed" : item.status;
    return <li key={item.id} data-tool-status={item.status}>
      <span className={`native-event-marker ${unfinished ? "unconfirmed" : item.status}`} aria-hidden="true" />
      <div><strong>{labels[item.tool]}</strong><span>{label}{item.count !== undefined ? ` · ${item.count} returned` : ""}</span>
        {unfinished && <small>Last event: running. No completion event received.</small>}</div>
    </li>;
  })}</ol>;
  return <section className={`native-execution ${busy ? "is-running" : ""}`} aria-label="Agent execution">
    <div className="native-execution-heading"><h3>Execution</h3><span className={`native-execution-state ${state}`} role="status">{status}</span></div>
    <p className="native-execution-summary">{activity.length ? `${completed} completed${failed ? ` · ${failed} failed` : ""} · ${activity.length} tool${activity.length === 1 ? "" : "s"}`
      : busy ? "Request pending · waiting for execution events" : "No tool execution events received"}</p>
    {activity.length > 0 && (busy ? rows : <>
      <Button type="text" size="small" className="native-execution-toggle" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
        {expanded ? "Hide tool activity" : "Show tool activity"}</Button>{expanded && rows}
    </>)}
    {busy && activity.length > 0 && !activity.some((item) => item.status === "running") && <p className="native-execution-note">Waiting for the next execution event or result.</p>}
    {state === "cancelled" && <p className="native-execution-note">Stopped waiting. Saved proposals and executed changes are not undone.</p>}
  </section>;
}
function date(value: string | null) {
  return value && Number.isFinite(Date.parse(value)) ? `${formatMalaysiaDateTime(value)} MYT` : "Not scheduled";
}
function statusColor(status: string) {
  return status === "COMPLETED" || status === "EXECUTED" ? "green" : status === "IN_PROGRESS" ? "cyan" : status === "ASSIGNED" ? "blue" : "default";
}

const savedProposalSchema = nativeProposalSchema.omit({ orderNo: true, technicianLabel: true }).passthrough();
const proposalPreviewSchema = z.object({ proposal: savedProposalSchema, previewToken: z.string().length(64) });

function AssignmentProposalCard({ proposal, workspaceId, disabled, canConfirm }: {
  proposal: NativeProposal; workspaceId: string; disabled: boolean; canConfirm: boolean;
}) {
  const [preview, setPreview] = useState<z.infer<typeof proposalPreviewSchema>>();
  const [displayStatus, setDisplayStatus] = useState(proposal.status);
  const [state, setState] = useState<"loading" | "ready" | "saving" | "executed" | "error">("loading");
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);
  const requests = useLatestRequest();
  const endpoint = `/api/workspaces/${workspaceId}/assignment-proposals/${proposal.id}`;
  useEffect(() => {
    if (!canConfirm) { setState("error"); return; }
    const current = requests.begin();
    setPreview(undefined); setState("loading"); setMessage("");
    void (async () => {
      try {
        const response = await fetch(endpoint, { cache: "no-store", signal: current.signal });
        if (!response.ok) throw new Error("This saved proposal is unavailable for your current account.");
        const result = proposalPreviewSchema.parse(await response.json());
        if (!current.isCurrent()) return;
        const saved = result.proposal;
        if (saved.id !== proposal.id || saved.canonicalPayload.orderId !== proposal.canonicalPayload.orderId ||
            saved.canonicalPayload.technicianId !== proposal.canonicalPayload.technicianId ||
            saved.canonicalPayload.scheduledAt !== proposal.canonicalPayload.scheduledAt ||
            saved.targetUpdatedAt !== proposal.targetUpdatedAt || saved.expiresAt !== proposal.expiresAt) {
          throw new Error("The saved proposal changed. Prepare and review a new proposal.");
        }
        setPreview(result); setDisplayStatus(saved.status);
        if (saved.status === "EXECUTED") setState("executed");
        else if (!["PENDING", "APPROVED"].includes(saved.status) || Date.parse(saved.expiresAt) <= Date.now()) {
          throw new Error("This proposal is stale or expired. Prepare a new proposal.");
        } else setState("ready");
      } catch (error) {
        if (!current.isCurrent()) return;
        setPreview(undefined); setState("error");
        setMessage(error instanceof Error && !(error instanceof z.ZodError) ? error.message : "The saved proposal could not be verified.");
      } finally { current.finish(); }
    })();
    return () => requests.cancel();
  }, [canConfirm, endpoint, proposal, reload, requests]);

  async function confirm() {
    if (disabled || !canConfirm || state !== "ready" || !preview || requests.pending()) return;
    const current = requests.begin();
    setState("saving"); setMessage("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        signal: current.signal, body: JSON.stringify({ confirm: true, previewToken: preview.previewToken }) });
      const body = await response.json() as { proposal?: unknown };
      if (!current.isCurrent()) return;
      const executed = savedProposalSchema.safeParse(body.proposal);
      if (executed.success && executed.data.id === proposal.id &&
          executed.data.canonicalPayload.orderId === preview.proposal.canonicalPayload.orderId &&
          executed.data.canonicalPayload.technicianId === preview.proposal.canonicalPayload.technicianId &&
          executed.data.canonicalPayload.scheduledAt === preview.proposal.canonicalPayload.scheduledAt &&
          executed.data.targetUpdatedAt === preview.proposal.targetUpdatedAt &&
          executed.data.expiresAt === preview.proposal.expiresAt) {
        setDisplayStatus(executed.data.status);
      }
      if (!response.ok || !executed.success || executed.data.id !== proposal.id || executed.data.status !== "EXECUTED" ||
          executed.data.canonicalPayload.orderId !== preview.proposal.canonicalPayload.orderId ||
          executed.data.canonicalPayload.technicianId !== preview.proposal.canonicalPayload.technicianId ||
          executed.data.canonicalPayload.scheduledAt !== preview.proposal.canonicalPayload.scheduledAt) {
        throw new Error("The proposal was rejected or changed. Refresh the saved proposal before retrying.");
      }
      setPreview({ ...preview, proposal: executed.data }); setState("executed");
    } catch (error) {
      if (!current.isCurrent()) return;
      setPreview(undefined); setState("error");
      setMessage(error instanceof Error ? error.message : "Confirmation failed. Refresh the saved proposal to check its status.");
    } finally { current.finish(); }
  }
  const saved = preview?.proposal;
  return <Card className="workspace-panel native-proposal" title="Review saved assignment" aria-label="Saved assignment proposal">
    {state === "loading" ? <Skeleton active paragraph={{ rows: 3 }} /> : <>
      <p>Review the stored change before confirming. The agent has not executed this assignment.</p>
      <Descriptions bordered size="small" column={1} items={[
        { key: "order", label: "Order", children: proposal.orderNo },
        { key: "technician", label: "Technician", children: proposal.technicianLabel },
        { key: "time", label: "Scheduled time", children: date(proposal.canonicalPayload.scheduledAt) },
        { key: "expires", label: "Expires", children: date(proposal.expiresAt) },
        { key: "status", label: "Status", children: <Tag color={statusColor(saved?.status ?? displayStatus)}>{saved?.status ?? displayStatus}</Tag> },
      ]} />
      <details className="native-technical"><summary>Stored identifiers and version</summary><p>Order: {proposal.canonicalPayload.orderId}</p>
        <p>Technician: {proposal.canonicalPayload.technicianId}</p><p>Order version: {proposal.targetUpdatedAt}</p></details>
    </>}
    {(state === "ready" || state === "saving") && canConfirm && <Button className="product-note" type="primary" disabled={disabled || state === "saving"}
      loading={state === "saving"} onClick={() => void confirm()}>Confirm and execute assignment</Button>}
    {state === "executed" && <Alert className="product-note" type="success" showIcon message="Assignment executed."
      description={<Link href={`/workspaces/${workspaceId}/orders?orderId=${encodeURIComponent(proposal.canonicalPayload.orderId)}`}>Open the updated order</Link>} />}
    {state === "error" && <Alert className="product-note" type="error" showIcon message={message || "Confirmation is unavailable in this perspective."}
      action={canConfirm ? <Button disabled={disabled} onClick={() => setReload((value) => value + 1)}>Refresh saved proposal</Button> : undefined} />}
  </Card>;
}

function AdaptiveCanvas({ workspace, busy, canAssign, manualTask, onAsk }: {
  workspace: NativeWorkspace; busy: boolean; canAssign: boolean; manualTask: Props["manualTask"];
  onAsk: (prompt: string, ids?: string[]) => void;
}) {
  const base = `/workspaces/${workspace.workspaceId}`;
  const items = workspace.items;
  const orderLink = (id: string) => `${base}/orders?orderId=${encodeURIComponent(id)}`;
  return <section aria-label="Adaptive workspace" data-agent-view={workspace.type} className="native-canvas-result">
    <div className="native-result-heading"><Tag>{viewLabels[workspace.type]} view</Tag><Tag color={workspace.mode === "mock" ? "orange" : "green"}>{workspace.mode === "mock" ? "MOCK preview" : "Live model"}</Tag>
      <h2>{workspace.title}</h2><p>{workspace.summary}</p></div>
    <div className="native-scope"><span>{workspace.scope.ordersRead} orders read</span><span>{workspace.scope.knowledgeHits} published knowledge hits</span>
      <span>Run checked {date(workspace.scope.checkedAt)} · read-time record versions</span></div>
    {workspace.status === "SOURCE_ONLY" && <Alert type="warning" showIcon message="Retrieved sources only"
      description="The model could not produce a verified layout. These are records actually read in this run; retry for a complete response." />}
    {workspace.type === "comparison" && items.length >= 2 ? <Card className="workspace-panel" title="Compare source records">
      <div className="native-comparison" tabIndex={0} role="region" aria-label="Order comparison"><table>
        <caption>Fields and source observations from records read during this run.</caption>
        <thead><tr><th scope="col">Source field</th>{items.map(({ order }) => <th scope="col" key={order.id}>{order.order_no}</th>)}</tr></thead>
        <tbody>{[
          ["Status", (item: NativeWorkspace["items"][number]) => item.order.status],
          ["Service", (item: NativeWorkspace["items"][number]) => item.order.service_type],
          ["Reported problem", (item: NativeWorkspace["items"][number]) => item.order.problem_description],
          ["Scheduled", (item: NativeWorkspace["items"][number]) => date(item.order.scheduled_at)],
          ["Assignment", (item: NativeWorkspace["items"][number]) => item.order.assigned_technician_id ? "Assigned" : "Not assigned"],
          ["Updated", (item: NativeWorkspace["items"][number]) => date(item.order.updated_at)],
          ["Source observations", (item: NativeWorkspace["items"][number]) => item.interpretation || "Inspect the source fields."],
        ].map(([label, render]) => <tr key={String(label)}><th scope="row">{String(label)}</th>{items.map((item) => <td key={item.order.id}>{(render as (item: NativeWorkspace["items"][number]) => string)(item)}</td>)}</tr>)}</tbody>
        <tfoot><tr><th scope="row">Inspect</th>{items.map(({ order }) => <td key={order.id}><Button disabled={busy} onClick={() => onAsk(`Review order ${order.order_no}.`, [order.id])}>Investigate</Button>
          <p><Link href={orderLink(order.id)}>Open in Orders</Link></p></td>)}</tr></tfoot>
      </table></div>
      <details className="native-technical"><summary>Source record identifiers</summary>{items.map(({ order }) => <div key={order.id}>
        <strong>{order.order_no}</strong><p>Branch ID: {order.branch_id}</p><p>Technician ID: {order.assigned_technician_id ?? "Not assigned"}</p>
      </div>)}</details>
    </Card> : items.length > 0 ? <div className={`native-order-cards ${workspace.type === "investigation" ? "is-investigation" : ""}`}>
      {items.map(({ order, interpretation }) => <Card key={order.id} className="workspace-panel native-order-card"
        title={order.order_no} extra={<Tag color={statusColor(order.status)}>{order.status}</Tag>}>
        <span className="native-label">Source record</span><h3>{order.service_type}</h3><p>{order.problem_description}</p>
        <Descriptions column={1} size="small" items={[
          { key: "time", label: "Scheduled", children: date(order.scheduled_at) },
          { key: "assignment", label: "Technician", children: order.assigned_technician_id ? "Assigned · inspect order for details" : "Not assigned" },
          { key: "updated", label: "Updated", children: date(order.updated_at) },
        ]} />
        <details className="native-technical"><summary>Source record identifiers</summary><p>Branch ID: {order.branch_id}</p>
          <p>Technician ID: {order.assigned_technician_id ?? "Not assigned"}</p></details>
        {interpretation && <div className="native-interpretation"><span className="native-label">Source observations</span><p>{interpretation}</p></div>}
        <div className="native-card-actions"><Button disabled={busy} onClick={() => onAsk(`Review order ${order.order_no} and identify any missing information.`, [order.id])}>Investigate order</Button>
          <Link href={orderLink(order.id)}>Open in Orders</Link></div>
        {!workspace.proposal && canAssign && <Button type="link" disabled={busy} onClick={() => onAsk(`Prepare an assignment proposal for order ${order.order_no}. Ask me for any missing details.`, [order.id])}>Prepare assignment</Button>}
        {manualTask && <p><Link href={`${orderLink(order.id)}#manual-${manualTask === "assign" ? "assignment" : "reschedule"}`}>{manualTask === "assign" ? "Assign manually in Demo" : "Reschedule manually"}</Link></p>}
      </Card>)}
    </div> : workspace.excerpts.length === 0 && workspace.missingInformation.length === 0 && <Empty description="No matching source records were returned. Refine your request or inspect Orders manually." />}
    {workspace.excerpts.length > 0 && <Card className="workspace-panel" title="Published source evidence"><ol className="native-citations">
      {workspace.excerpts.map(({ text, citation }) => <li key={`${citation.versionId}:${citation.ordinal}`}><blockquote>{text}</blockquote>
        <p>{citation.title} · {citation.sourceLabel} · Page {citation.page} · {citation.section}</p>
        <details className="native-technical"><summary>Published source version</summary><p>Version ID: {citation.versionId}</p><p>Source excerpt ordinal: {citation.ordinal}</p></details>
        <Link href={`${base}/knowledge`}>Inspect published knowledge</Link></li>)}
    </ol></Card>}
    {workspace.missingInformation.length > 0 && <Card className="workspace-panel" title="Information to clarify"><ul>{workspace.missingInformation.map((item, index) => <li key={index}>{item}</li>)}</ul>
      <p className="product-muted">Reply in the conversation to continue. Changes still need explicit confirmation.</p></Card>}
    {workspace.proposal && <AssignmentProposalCard key={workspace.proposal.id} workspaceId={workspace.workspaceId} proposal={workspace.proposal} disabled={busy} canConfirm={canAssign} />}
    {workspace.followUps.length > 0 && <div className="native-follow-ups" aria-label="Suggested follow-up requests">{workspace.followUps.map((prompt, index) =>
      <Button key={index} disabled={busy} onClick={() => onAsk(prompt)}>{prompt}</Button>)}</div>}
  </section>;
}

export function NativeAgentWorkspace(props: Props) {
  return <NativeAgentSession key={`${props.workspaceId}:${props.contextKey ?? ""}:${props.canAssign}:${props.manualTask}:${props.isGuest}:${props.focusOrderId ?? ""}`} {...props} />;
}

function NativeAgentSession({ workspaceId, focusOrderId, canAssign, manualTask, isGuest, contextKey = "", presentation = "floating" }: Props) {
  const router = useRouter();
  const requests = useLatestRequest();
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState("");
  const [workspace, setWorkspace] = useState<NativeWorkspace>();
  const [contextIds, setContextIds] = useState<string[]>(focusOrderId ? [focusOrderId] : []);
  const [activity, setActivity] = useState<NativeActivity[]>([]);
  const [state, setState] = useState<RunState>("idle");
  const [error, setError] = useState("");
  const [lastPrompt, setLastPrompt] = useState("");
  const [open, setOpen] = useState(presentation !== "floating");
  const [compact, setCompact] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [resultsMaximized, setResultsMaximized] = useState(false);
  const [mobileView, setMobileView] = useState<"conversation" | "results">("conversation");
  const [historyRevision, setHistoryRevision] = useState(0);
  const [historySaved, setHistorySaved] = useState<boolean>();
  const [historical, setHistorical] = useState(false);
  const sessionId = useRef<string>();
  const nextId = useRef(0);
  const input = useRef<React.ElementRef<typeof Input.TextArea>>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const resultsExpander = useRef<HTMLButtonElement>(null);
  const resultsReturn = useRef<HTMLButtonElement>(null);
  const busy = state === "running";
  const base = `/workspaces/${workspaceId}`;
  const studio = presentation === "studio";

  useEffect(() => {
    if (!studio) return;
    const media = window.matchMedia("(max-width: 1100px)");
    const update = () => { setCompact(media.matches); setSidebarOpen(false); };
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [studio]);
  useEffect(() => { if (resultsMaximized) resultsReturn.current?.focus(); }, [resultsMaximized]);

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setOpen(true); setMobileView("conversation"); setResultsMaximized(false); requestAnimationFrame(() => input.current?.focus()); }
      if (event.key === "Escape" && resultsMaximized) { setResultsMaximized(false); requestAnimationFrame(() => resultsExpander.current?.focus()); }
      if (event.key === "Escape" && open && presentation === "floating") { setOpen(false); requestAnimationFrame(() => opener.current?.focus()); }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [open, presentation, resultsMaximized]);
  useEffect(() => { if (open) input.current?.focus({ preventScroll: true }); }, [open]);
  useEffect(() => { if (open) transcript.current?.scrollTo({ top: transcript.current.scrollHeight,
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }, [messages, busy, open]);

  async function send(text: string, orderIds?: string[]) {
    const question = text.trim();
    if (!question || question.length > 1_000 || requests.pending()) return;
    const conversation: NativeAgentRequest["conversation"] = messages.slice(-6).map(({ role, content }) => ({ role, content: content.slice(0, 700) }));
    const selectedIds = (orderIds ?? contextIds).slice(0, 4);
    const current = requests.begin();
    setMessages((previous) => [...previous.slice(-23), { id: ++nextId.current, role: "user", content: question }]);
    const requestSignal = AbortSignal.any([current.signal, AbortSignal.timeout(55_000)]);
    sessionId.current ??= crypto.randomUUID();
    setPrompt(""); setLastPrompt(question); setState("running"); setError(""); setActivity([]); setOpen(true); setHistorical(false); setMobileView("conversation"); setResultsMaximized(false);
    let completed: NativeWorkspace | undefined;
    let runError: string | undefined;
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/agent/run`, { method: "POST", headers: { "Content-Type": "application/json", [AI_SESSION_HEADER]: sessionId.current },
        signal: requestSignal, body: JSON.stringify({ prompt: question, contextOrderIds: selectedIds, conversation }) });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: unknown; resetAt?: string };
        const reason = response.status === 429 ? "Today's Guest AI allowance is used up."
          : response.status === 403 ? "Your current perspective cannot use this agent."
          : "The agent is unavailable. You can continue in Orders or Knowledge.";
        throw new Error(`${reason}${body.resetAt ? ` Resets ${date(body.resetAt)}.` : ""}`);
      }
      await readNativeAgentStream(response, (event) => {
        if (!current.isCurrent()) return;
        if (event.type === "activity") setActivity((previous) => {
          const index = previous.findIndex((item) => item.id === event.activity.id);
          return index < 0 ? [...previous, event.activity] : previous.map((item, row) => row === index ? event.activity : item);
        });
        if (event.type === "workspace") {
          if (event.workspace.workspaceId !== workspaceId || event.workspace.mode !== "live" && process.env.NODE_ENV === "production") {
            throw new Error("The result did not match this workspace. Please retry.");
          }
          completed = event.workspace;
          setHistorySaved(event.historySaved);
        }
        if (event.type === "error") runError = `${event.message}${event.resetAt ? ` Resets ${date(event.resetAt)}.` : ""}`;
      }, requestSignal);
      if (!current.isCurrent()) return;
      if (runError || !completed) throw new Error(runError ?? "The agent returned no completed result. Please retry.");
      setWorkspace(completed); setContextIds(completed.items.map(({ order }) => order.id).slice(0, 4)); setState("ready");
      setResultsOpen(true); setHistoryRevision((value) => value + 1);
      if (presentation === "floating" && window.matchMedia("(max-width: 760px)").matches) {
        setOpen(false);
        requestAnimationFrame(() => canvas.current?.scrollIntoView({ block: "start",
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }));
      }
      const content = `${completed.title}\n\n${completed.summary}${completed.missingInformation.length ? `\n\n${completed.missingInformation.join("\n")}` : ""}${completed.proposal ? "\n\nAn assignment proposal is saved. Review its exact details in the workspace before confirming." : ""}`.slice(0, 1_500);
      setMessages((previous) => [...previous, { id: ++nextId.current, role: "assistant", content }]);
    } catch (cause) {
      if (!current.isCurrent()) return;
      const message = requestSignal.aborted && !current.signal.aborted ? "The request timed out. Please retry or continue manually."
        : cause instanceof Error ? cause.message : "The agent could not complete this request. Please retry.";
      setState("error"); setError(message);
      setMessages((previous) => [...previous, { id: ++nextId.current, role: "assistant", content: `Request not completed. ${message}` }]);
    } finally {
      const active = current.isCurrent(); current.finish();
      if (active && isGuest) router.refresh();
    }
  }
  function cancel() {
    requests.cancel(); setState("cancelled");
    setMessages((previous) => [...previous, { id: ++nextId.current, role: "assistant", content: "Request cancelled. A proposal prepared before cancellation may still exist; cancellation does not undo a saved proposal or an executed change." }]);
    if (isGuest) router.refresh();
  }
  function newConversation() {
    sessionId.current = undefined; setHistorySaved(undefined); setHistorical(false);
    requests.cancel(); setMessages([]); setWorkspace(undefined); setContextIds([]); setActivity([]); setPrompt(""); setLastPrompt(""); setError(""); setState("idle");
    setOpen(true); input.current?.focus();
    setResultsOpen(false); setResultsMaximized(false); setMobileView("conversation"); setSidebarOpen(false); setHistoryRevision((value) => value + 1);
    if (busy && isGuest) router.refresh();
  }
  const starters = ["Which recent orders need attention?", "Compare the recent orders.", "Find guidance for filter inspection."];
  function restoreConversation(detail: AiSessionDetail) {
    if (requests.pending()) return;
    sessionId.current = detail.session.id;
    setMessages(detail.turns.slice(-12).flatMap((turn) => [
      { id: ++nextId.current, role: "user" as const, content: turn.question },
      { id: ++nextId.current, role: "assistant" as const, content: turn.answer ?? (turn.status === "RUNNING" ? "Request outcome not recorded yet." : "Request did not produce a recorded answer.") },
    ]));
    setWorkspace(detail.turns.at(-1)?.workspace ?? undefined); setContextIds([]); setActivity([]);
    setState("idle"); setHistorical(true); setError(""); setLastPrompt(""); setPrompt(""); setOpen(true); setHistorySaved(true);
    setResultsOpen(Boolean(detail.turns.at(-1)?.workspace)); setResultsMaximized(false); setMobileView("conversation"); setSidebarOpen(false);
  }
  const canvasContent = <div ref={canvas} className="native-canvas">
        {busy && <div className="native-run-status" role="status"><RobotOutlined /><div><strong>{activity.length ? "Request in progress" : "Request pending"}</strong>
          <p>{activity.at(-1) ? `${labels[activity.at(-1)!.tool]} · ${activity.at(-1)!.status}` : "Waiting for execution events. Tool progress appears in Conversation."}</p></div></div>}
        {state === "error" && <Alert type="error" showIcon message="Request not completed" description={error}
          action={<Button onClick={() => void send(lastPrompt)} disabled={!lastPrompt}>Retry request</Button>} />}
        {state === "cancelled" && <Alert type="info" showIcon message="Request cancelled." description="You can retry, start another request, or continue with traditional screens." />}
        {workspace && state !== "ready" && !historical && <Alert className="native-earlier-result" type="info" showIcon message="Earlier result"
          description="This canvas belongs to the previous completed request. Agent actions and proposal confirmation stay disabled until a new result completes." />}
        {workspace ? <AdaptiveCanvas workspace={workspace} busy={state !== "ready"} canAssign={canAssign && !isGuest} manualTask={manualTask} onAsk={(text, ids) => void send(text, ids)} />
          : !busy && <section className="native-agent-welcome" aria-label="Adaptive workspace"><div className="native-welcome-mark"><RobotOutlined /></div>
            <h2>Your task, a working view.</h2><p>Review orders, compare records, or find published guidance. The agent chooses the view from what it actually reads.</p>
            {!studio && <div className="native-starters">{starters.map((text) => <Button key={text} onClick={() => void send(text)}>{text}</Button>)}</div>}
            <p className="native-welcome-note">{canAssign && !isGuest ? "Assignment proposals need your explicit confirmation before execution." : "Data changes continue through the manual actions available to your role."}
              {isGuest ? " Demo records are shared fictional data." : ""}</p></section>}
        <div className="native-manual-links"><Link href={`${base}/orders${contextIds[0] ? `?orderId=${encodeURIComponent(contextIds[0])}` : ""}`}>Operations</Link>
          <Link href={`${base}/knowledge`}>Search knowledge manually</Link></div>
      </div>;
  const conversationContent = <section id="native-agent-conversation" className="native-conversation" role="region" aria-label="Agent conversation">
        <header><div className="native-conversation-title"><RobotOutlined /><div><h2>Conversation</h2><p>SejukOps agent · workspace context</p></div></div>
          <div className="native-conversation-tools"><Button type="text" icon={<ReloadOutlined />} aria-label={studio ? "Start new conversation" : "New conversation"} title="New conversation" onClick={newConversation} />
            {presentation === "floating" && <Button type="text" icon={<CloseOutlined />} aria-label="Minimize conversation" title="Minimize conversation" onClick={() => { setOpen(false); requestAnimationFrame(() => opener.current?.focus()); }} />}</div></header>
        <div ref={transcript} className="native-messages" role="log" aria-live="polite" aria-relevant="additions text">
          {messages.length === 0 ? <div className="native-thread-empty"><MessageOutlined /><h3>Start with an outcome.</h3><p>Ask a question, then follow up. Source records and action previews appear in the working view.</p>
            {contextIds.length > 0 && <Tag>Selected order context retained</Tag>}<p>{studio ? "Your saved conversations appear in the sidebar." : "Recorded conversations are available in Conversation history."}</p>
            {studio && <div className="native-starters">{starters.map((text) => <Button key={text} onClick={() => void send(text)}>{text}</Button>)}</div>}</div>
            : messages.map((message) => <article key={message.id} className={`native-message ${message.role}`}><span>{message.role === "user" ? "You" : "SejukOps agent"}</span><p>{message.content}</p></article>)}
        </div>
        {state !== "idle" && <ExecutionPanel key={messages.filter((message) => message.role === "user").at(-1)?.id}
          activity={activity} state={state} sourceOnly={state === "ready" && workspace?.status === "SOURCE_ONLY"} />}
        <form className="native-composer" onSubmit={(event) => { event.preventDefault(); void send(prompt); }}>
          <label htmlFor="native-agent-message">Message the agent</label>
          <Input.TextArea ref={input} id="native-agent-message" rows={3} maxLength={1_000} value={prompt} disabled={busy}
            placeholder="Ask a follow-up or describe a new task…" onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(prompt); } }} />
          <div className="native-composer-footer"><span>Enter to send · Shift + Enter for a new line</span>
            <div className="native-composer-buttons">{busy && <Button icon={<StopOutlined />} aria-label="Cancel request" onClick={cancel}>Cancel request</Button>}
              <Button type="primary" htmlType="submit" icon={<ArrowUpOutlined />} aria-label="Send message" disabled={busy || !prompt.trim()} loading={busy}>Send message</Button></div></div>
        </form>
      </section>;
  const notices = <>
    {historySaved === false && <Alert type="warning" showIcon message="This result was not saved to conversation history."
      description="The current result is still available. You can continue here or retry history later." />}
    {historical && <Alert type="info" showIcon message="Historical conversation"
      description="These are recorded results, not a current record check. Send a fresh request to continue; saved actions are not replayed." />}
  </>;
  const sidebar = <WorkspaceSessionSidebar workspaceId={workspaceId} contextKey={contextKey} selectedSessionId={sessionId.current}
    busy={busy} revision={historyRevision} onNew={newConversation} onRestore={restoreConversation} />;
  return <main className={`workspace-main native-agent-main${presentation === "embedded" ? " native-agent-embedded" : ""}${studio ? " native-agent-studio" : ""}`}>
    <div className="workspace-heading"><div><span className="product-eyebrow">Intent → evidence → action</span><h1>AI Workspace</h1>
      <p>{studio ? "Conversation, execution and evidence in one task workspace." : "Describe the task. Keep the conversation; let the working view follow your request."}</p></div>
      {studio ? <div className="native-studio-toolbar">
        {compact && <Button icon={<MenuOutlined />} onClick={() => setSidebarOpen(true)} aria-label="Open conversations">Conversations</Button>}
        <Button className="native-studio-results-toggle" aria-expanded={resultsOpen} aria-controls="native-studio-results" onClick={() => { setResultsOpen((value) => !value); setResultsMaximized(false); setMobileView("conversation"); }}> {resultsOpen ? "Hide results" : "Show results"}</Button>
      </div> : <SessionHistory workspaceId={workspaceId} surface="WORKSPACE" disabled={busy} onRestore={restoreConversation} />}</div>
    {studio ? <>
      <div className="native-studio-notices">{notices}</div>
      <div className="native-studio-mobile-tabs" aria-label="Workspace view">
        <Button type={mobileView === "conversation" ? "primary" : "default"} aria-pressed={mobileView === "conversation"} onClick={() => { setMobileView("conversation"); setResultsMaximized(false); }}>Conversation</Button>
        <Button type={mobileView === "results" ? "primary" : "default"} aria-pressed={mobileView === "results"} onClick={() => { setResultsOpen(true); setMobileView("results"); }}>{workspace ? "View results" : "Working view"}</Button>
      </div>
      <div className={`native-studio-grid${resultsOpen ? " has-results" : ""}${resultsMaximized ? " is-maximized" : ""} view-${mobileView}`}>
        {!compact && <aside className="native-studio-sidebar" aria-label="Your workspace conversations">{sidebar}</aside>}
        <div className="native-studio-chat">
          {state === "error" && <Alert type="error" showIcon message="Request not completed" description={error}
            action={<Button onClick={() => void send(lastPrompt)} disabled={!lastPrompt}>Retry request</Button>} />}
          {conversationContent}
        </div>
        <section id="native-studio-results" className="native-studio-results" aria-label="Business results" hidden={!resultsOpen}>
          <header><div><h2>Working view</h2><span>{historical ? "Recorded snapshot" : busy ? "Request in progress" : workspace ? "Result and source records" : "Waiting for a task"}</span></div>
            <div><Button ref={resultsExpander} type="text" icon={resultsMaximized ? <ShrinkOutlined /> : <ExpandOutlined />} aria-label={resultsMaximized ? "Restore result size" : "Expand results"}
              aria-expanded={resultsMaximized} onClick={() => setResultsMaximized((value) => !value)} />
              {resultsMaximized ? <Button ref={resultsReturn} onClick={() => { setResultsMaximized(false); setMobileView("conversation"); requestAnimationFrame(() => input.current?.focus()); }}>Back to conversation</Button>
                : <Button type="text" icon={<CloseOutlined />} aria-label="Close results" onClick={() => { setResultsOpen(false); setMobileView("conversation"); requestAnimationFrame(() => input.current?.focus()); }} />}</div></header>
          <div className="native-studio-result-scroll">{canvasContent}</div>
        </section>
      </div>
      {compact && <Drawer title="Your conversations" placement="left" width="min(360px, 90vw)" open={sidebarOpen} onClose={() => setSidebarOpen(false)} styles={{ body: { padding: 0 } }}>{sidebar}</Drawer>}
    </> : <>{notices}<div className="native-working-area"><div className="native-agent-layout">{canvasContent}</div>{open && conversationContent}</div></>}
    {presentation === "floating" && <Button ref={opener} className="native-conversation-launcher" type="primary" icon={<MessageOutlined />} aria-label={open ? "Close conversation" : "Open conversation"}
      aria-expanded={open} aria-controls="native-agent-conversation" onClick={() => setOpen((value) => !value)}>{busy ? "Working…" : "Conversation"}</Button>}
    {!studio && <p className="native-footer"><CheckCircleOutlined /> Records, observations and citations come from scoped reads. Changes need explicit confirmation. Ctrl / ⌘ K opens the conversation.</p>}
  </main>;
}
