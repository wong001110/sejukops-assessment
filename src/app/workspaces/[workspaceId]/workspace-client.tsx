"use client";

import { ArrowRightOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Descriptions, Empty, Input, Select, Skeleton, Space, Tag } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { OrderIntakeCard } from "./order-intake";
import { resolveVisibleOrderId } from "./order-selection";
import { KnowledgeAssistPanel } from "./knowledge-assist-panel";

type Order = {
  id: string; order_no: string; branch_id: string; status: string; problem_description: string;
  service_type: string; scheduled_at: string | null; assigned_technician_id: string | null;
  updated_at: string;
};

function formatWorkspaceDate(value: string | null): string {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return `${new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kuala_Lumpur",
  }).format(date)} MYT`;
}

function OrderEvidence({ orders, workspaceId, selectedId, onSelect }: {
  orders: Order[]; workspaceId: string; selectedId?: string; onSelect?: (id: string) => void;
}) {
  if (orders.length === 0) return <Empty description="No recent orders are visible in this workspace." />;
  return <div className="workspace-order-list">
    {orders.map((order) => <article key={order.id} className={`workspace-order-item ${selectedId === order.id ? "is-selected" : ""}`}>
      <div className="workspace-order-top"><strong>{order.order_no}</strong><Tag color={order.status === "NEW" ? "blue" : "green"}>{order.status}</Tag></div>
      <p>{order.service_type} · {order.problem_description}</p>
      <p className="product-muted">Scheduled: {formatWorkspaceDate(order.scheduled_at)}</p>
      {onSelect ? <Button type="link" aria-pressed={selectedId === order.id}
        aria-controls="workspace-order-detail" onClick={() => onSelect(order.id)}>
        {selectedId === order.id ? "Selected" : "View details"}</Button>
        : <Link href={`/workspaces/${workspaceId}/orders?orderId=${encodeURIComponent(order.id)}`}>Open in Orders <ArrowRightOutlined /></Link>}
    </article>)}
  </div>;
}

export function OrdersWorkspace({ workspaceId, canAssign, canImport, canCreate, isGuest, canGuestAssign, canManagerReschedule, canAdvanceJob }: {
  workspaceId: string; canAssign: boolean; canImport: boolean; canCreate: boolean; isGuest: boolean; canGuestAssign: boolean; canManagerReschedule: boolean; canAdvanceJob: boolean;
}) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [generation, setGeneration] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [jobBusy, setJobBusy] = useState(false);
  const [jobMessage, setJobMessage] = useState("");
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const base = `/workspaces/${workspaceId}`;
  const load = useCallback(async (signal?: AbortSignal) => {
    setState("loading");
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/orders`, { cache: "no-store", signal });
      if (!response.ok) throw new Error("Orders unavailable");
      const body = await response.json() as { orders: Order[]; generation: number };
      setOrders(body.orders);
      setGeneration(body.generation);
      const requested = new URLSearchParams(window.location.search).get("orderId");
      setSelectedId((current) => resolveVisibleOrderId(body.orders, current, requested));
      setState("ready");
    } catch {
      if (signal?.aborted) return;
      setState("error");
    }
  }, [workspaceId]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  const selected = orders.find((order) => order.id === selectedId);
  function selectOrder(id: string) {
    setSelectedId(id);
    window.requestAnimationFrame(() => {
      detailHeadingRef.current?.focus({ preventScroll: true });
      if (window.matchMedia?.("(max-width: 760px)").matches) {
        detailHeadingRef.current?.scrollIntoView({ block: "start" });
      }
    });
  }
  async function advanceJob(order: Order) {
    if (!generation || jobBusy || (order.status !== "ASSIGNED" && order.status !== "IN_PROGRESS")) return;
    setJobBusy(true); setJobMessage("");
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/orders/${order.id}/status`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedGeneration: generation, expectedUpdatedAt: order.updated_at,
          nextStatus: order.status === "ASSIGNED" ? "IN_PROGRESS" : "COMPLETED",
        }),
      });
      if (!response.ok) throw new Error("Job update was rejected. Refresh the order and try again.");
      setJobMessage(order.status === "ASSIGNED" ? "Job started." : "Job completed.");
      await load();
    } catch (error) {
      setJobMessage(error instanceof Error ? error.message : "Job could not be updated.");
    } finally { setJobBusy(false); }
  }
  return <main className="workspace-main">
    <div className="workspace-heading"><div><h1>Orders</h1><p>{canAdvanceJob ? "Review your assigned jobs and update their progress." : "Your workspace orders, with an assistant available in context."}</p></div>
      <Button icon={<ReloadOutlined />} onClick={() => void load()}>Refresh</Button></div>
    <div className="workspace-grid">
      <Card className="workspace-panel" title="Recent orders" aria-label="Recent orders">
        {state === "loading" && <Skeleton active paragraph={{ rows: 5 }} />}
        {state === "error" && <Alert type="error" showIcon message="Orders could not be loaded." description="Refresh to try again." />}
        {state === "ready" && <OrderEvidence orders={orders} workspaceId={workspaceId} selectedId={selectedId} onSelect={selectOrder} />}
      </Card>
      <Card id="workspace-order-detail" className="workspace-panel" title="Order detail" aria-label="Order detail">
        {selected ? <>
          <div className="workspace-order-top"><h2 ref={detailHeadingRef} tabIndex={-1}>{selected.order_no}</h2><Tag color="blue">{selected.status}</Tag></div>
          <p>{selected.problem_description}</p>
          <Descriptions column={1} size="small" bordered items={[
            { key: "service", label: "Service", children: selected.service_type },
            { key: "technician", label: "Technician", children: selected.assigned_technician_id
              ? canAdvanceJob ? "You" : isGuest ? "Demo technician" : selected.assigned_technician_id
              : "Not assigned" },
            { key: "updated", label: "Last updated", children: formatWorkspaceDate(selected.updated_at) },
          ]} />
          {canAdvanceJob && (selected.status === "ASSIGNED" || selected.status === "IN_PROGRESS") &&
            <div className="product-note"><Button type="primary" loading={jobBusy} onClick={() => void advanceJob(selected)}>
              {selected.status === "ASSIGNED" ? "Start assigned job" : "Complete job"}
            </Button></div>}
          {jobMessage && <Alert type={jobMessage.includes("rejected") || jobMessage.includes("could not") ? "error" : "success"} showIcon message={jobMessage} />}
          {!canAdvanceJob && <><p className="product-note"><Link href={`${base}/agent?orderId=${encodeURIComponent(selected.id)}`}>Open this order in Agent Workspace <ArrowRightOutlined /></Link></p>
            <OrderAssistPanel key={selected.id} workspaceId={workspaceId} focusOrderId={selected.id} compact isGuest={isGuest} /></>}
        </> : <Empty description="Select an order to inspect it. You can continue manually if AI Assist is unavailable." />}
        <Space wrap className="product-note">{canAssign && <Link href={`${base}/assignment`}>Prepare an assignment</Link>}<Link href={`${base}/knowledge`}>Search knowledge</Link></Space>
      </Card>
    </div>
    {canCreate && <div className="product-note"><ManualOrderCard workspaceId={workspaceId} isGuest={isGuest} onCreated={() => void load()} /></div>}
    {canGuestAssign && <div id="manual-assignment" className="product-note"><GuestManualAssignmentCard workspaceId={workspaceId} orders={orders} generation={generation} onAssigned={() => void load()} /></div>}
    {canManagerReschedule && <div id="manual-reschedule" className="product-note"><ManagerScheduleCard workspaceId={workspaceId} orders={orders} generation={generation} onRescheduled={() => void load()} isGuest={isGuest} /></div>}
    {canImport && <div className="product-note"><OrderIntakeCard workspaceId={workspaceId} isGuest={isGuest} onCreated={() => void load()} /></div>}
  </main>;
}

function ManualOrderCard({ workspaceId, isGuest, onCreated }: { workspaceId: string; isGuest: boolean; onCreated: () => void }) {
  type Option = { id: string; name: string; code?: string };
  const [options, setOptions] = useState<{ generation: number; branches: Option[]; customers: Option[] } | null>(null);
  const [branchId, setBranchId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [orderNo, setOrderNo] = useState("");
  const [serviceType, setServiceType] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    fetch(`/api/workspaces/${workspaceId}/order-intake/options`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data) => { if (active) setOptions(data); })
      .catch(() => { if (active) setMessage("Order options are unavailable. Refresh the page."); });
    return () => { active = false; };
  }, [workspaceId]);
  async function create() {
    if (!options || !branchId || !customerId || !orderNo.trim() || !serviceType.trim() || !problem.trim()) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/orders`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedGeneration: options.generation, branchId, customerId,
          orderNo: orderNo.trim(), serviceType: serviceType.trim(), problemDescription: problem.trim(),
        }),
      });
      if (!response.ok) throw new Error("Order could not be created. Refresh and check the details.");
      setOrderNo(""); setServiceType(""); setProblem("");
      setMessage("Order created in this workspace.");
      onCreated();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Order could not be created.");
    } finally { setBusy(false); }
  }
  return <Card className="workspace-panel" title="Create an order manually">
    {isGuest && <p className="product-muted">Use fictional details in the shared Demo.</p>}
    <div className="workspace-fields">
      <label className="workspace-field">Branch
        <Select aria-label="Branch" value={branchId || undefined} onChange={setBranchId}
          options={options?.branches.map((item) => ({ value: item.id, label: `${item.code ?? ""} ${item.name}`.trim() })) ?? []} />
      </label>
      <label className="workspace-field">Customer
        <Select aria-label="Customer" value={customerId || undefined} onChange={setCustomerId}
          options={options?.customers.map((item) => ({ value: item.id, label: item.name })) ?? []} />
      </label>
      <label className="workspace-field">Order number
        <Input maxLength={80} value={orderNo} onChange={(event) => setOrderNo(event.target.value)} />
      </label>
      <label className="workspace-field">Service type
        <Input maxLength={120} value={serviceType} onChange={(event) => setServiceType(event.target.value)} />
      </label>
      <label className="workspace-field">Problem description
        <Input.TextArea rows={3} maxLength={4000} value={problem} onChange={(event) => setProblem(event.target.value)} />
      </label>
      <Button type="primary" disabled={!options || busy || !branchId || !customerId || !orderNo.trim() || !serviceType.trim() || !problem.trim()}
        loading={busy} onClick={() => void create()}>Create order</Button>
      {message && <Alert type={message.startsWith("Order created") ? "success" : "error"} showIcon message={message} />}
    </div>
  </Card>;
}

function GuestManualAssignmentCard({ workspaceId, orders, generation, onAssigned }: {
  workspaceId: string; orders: Order[]; generation: number | null; onAssigned: () => void;
}) {
  type Technician = { id: string; branch_id: string };
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [orderId, setOrderId] = useState("");
  const [technicianId, setTechnicianId] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const order = orders.find((item) => item.id === orderId);
  const available = technicians.filter((item) => item.branch_id === order?.branch_id);
  useEffect(() => {
    let active = true;
    fetch(`/api/workspaces/${workspaceId}/technicians`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data: { technicians: Technician[] }) => { if (active) setTechnicians(data.technicians); })
      .catch(() => { if (active) setMessage("Technicians are unavailable. Refresh to try again."); });
    return () => { active = false; };
  }, [workspaceId]);

  async function assign() {
    if (!order || !technicianId || !generation || busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/orders/${order.id}/assignment`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedGeneration: generation,
          expectedUpdatedAt: order.updated_at,
          technicianId,
          scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        }),
      });
      if (!response.ok) throw new Error(response.status === 409
        ? "The order or Demo data changed. Refresh and review it before assigning."
        : "Assignment could not be completed. Refresh and try again.");
      setOrderId(""); setTechnicianId(""); setScheduledAt("");
      setMessage("Demo order assigned. The Technician perspective can now view it.");
      onAssigned();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Assignment could not be completed.");
    } finally { setBusy(false); }
  }

  return <Card className="workspace-panel" title="Assign technician">
    <p className="product-muted">This changes shared fictional Demo data. Review the selected order and technician before assigning.</p>
    <div className="workspace-fields">
      <label className="workspace-field">Order
        <Select aria-label="Demo order to assign" value={orderId || undefined} placeholder="Choose an order"
          onChange={(value) => { setOrderId(value); setTechnicianId(""); setMessage(""); }}
          options={orders.filter((item) => ["NEW", "ASSIGNED"].includes(item.status))
            .map((item) => ({ value: item.id, label: `${item.order_no} (${item.status})` }))} />
      </label>
      <label className="workspace-field">Technician in the same branch
        <Select aria-label="Demo technician" value={technicianId || undefined} placeholder="Choose a technician"
          disabled={!order} onChange={setTechnicianId}
          options={available.map((item, index) => ({ value: item.id, label: `Demo technician ${index + 1}` }))} />
      </label>
      <label className="workspace-field">Scheduled time (optional)
        <Input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} />
      </label>
      {order && technicianId && <Alert type="info" showIcon message={`Assign ${order.order_no} to the selected Demo technician${scheduledAt ? ` at ${scheduledAt}` : ""}.`} />}
      <Button type="primary" loading={busy} disabled={busy || !order || !technicianId || !generation}
        onClick={() => void assign()}>Assign this order</Button>
      {message && <Alert type={message.startsWith("Demo order assigned") ? "success" : "error"} showIcon message={message} />}
    </div>
  </Card>;
}

function ManagerScheduleCard({ workspaceId, orders, generation, onRescheduled, isGuest }: {
  workspaceId: string; orders: Order[]; generation: number | null; onRescheduled: () => void; isGuest: boolean;
}) {
  const [orderId, setOrderId] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const order = orders.find((item) => item.id === orderId && item.status === "ASSIGNED" && item.assigned_technician_id);
  const newTime = scheduledAt ? new Date(scheduledAt) : null;
  const changed = Boolean(order && newTime && Number.isFinite(newTime.getTime()) &&
    (!order.scheduled_at || newTime.getTime() !== new Date(order.scheduled_at).getTime()));

  async function reschedule() {
    if (!order || !generation || !newTime || !changed || busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/orders/${order.id}/schedule`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedGeneration: generation, expectedUpdatedAt: order.updated_at,
          scheduledAt: newTime.toISOString(),
        }),
      });
      if (!response.ok) throw new Error(response.status === 409
        ? "The order or Demo data changed. Refresh and review the schedule again."
        : "Schedule could not be changed. Refresh and try again.");
      setOrderId(""); setScheduledAt("");
      setMessage("Schedule changed. The assigned technician is unchanged.");
      onRescheduled();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Schedule could not be changed.");
    } finally { setBusy(false); }
  }

  return <Card className="workspace-panel" title="Reschedule order">
    <p className="product-muted">{isGuest ? "This changes shared fictional Demo data. " : ""}The assigned technician stays the same.</p>
    <div className="workspace-fields">
      <label className="workspace-field">Assigned order
        <Select aria-label="Order to reschedule" value={orderId || undefined} placeholder="Choose an assigned order"
          onChange={(value) => { setOrderId(value); setScheduledAt(""); setMessage(""); }}
          options={orders.filter((item) => item.status === "ASSIGNED" && item.assigned_technician_id)
            .map((item) => ({ value: item.id, label: item.order_no }))} />
      </label>
      <label className="workspace-field">New scheduled time
        <Input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} />
      </label>
      {order && changed && <Alert type="info" showIcon message={`Review ${order.order_no}: ${order.scheduled_at ? new Date(order.scheduled_at).toLocaleString() : "Not scheduled"} → ${newTime?.toLocaleString()}. Technician unchanged.`} />}
      <Button type="primary" loading={busy} disabled={busy || !changed || !generation}
        onClick={() => void reschedule()}>Confirm new schedule</Button>
      {message && <Alert type={message.startsWith("Schedule changed") ? "success" : "error"} showIcon message={message} />}
    </div>
  </Card>;
}

function OrderAssistPanel({ workspaceId, focusOrderId, compact = false, isGuest }: {
  workspaceId: string; focusOrderId?: string; compact?: boolean; isGuest: boolean;
}) {
  type Activity = { type: "RECENT_ORDERS_READ"; orderCount: number };
  const [question, setQuestion] = useState(focusOrderId ? `Show recent orders relevant to ${focusOrderId}` : "Show recent orders");
  const [orders, setOrders] = useState<Order[]>([]);
  const [answer, setAnswer] = useState("");
  const [activity, setActivity] = useState<Activity[]>([]);
  const [traceId, setTraceId] = useState("");
  const [errorMessage, setErrorMessage] = useState("AI Assist is unavailable. Use Orders to continue manually.");
  const [state, setState] = useState<"idle" | "running" | "ready" | "empty" | "error" | "cancelled">("idle");
  const controller = useRef<AbortController | null>(null);
  const router = useRouter();
  const base = `/workspaces/${workspaceId}`;
  async function ask() {
    if (!question.trim() || state === "running") return;
    const current = new AbortController();
    controller.current = current;
    setState("running"); setAnswer(""); setOrders([]); setActivity([]); setTraceId("");
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/agent/orders`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question.trim() }), signal: current.signal,
      });
      if (!response.ok) {
        if (response.status === 429) {
          const detail = await response.json() as { error?: string; resetAt?: string | null };
          const reset = detail.resetAt && Number.isFinite(Date.parse(detail.resetAt))
            ? new Date(detail.resetAt).toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" })
            : null;
          throw new Error(`${detail.error ?? "Today's Guest AI allowance is used up."}${reset ? ` Resets ${reset} Malaysia time.` : ""}`);
        }
        throw new Error("AI Assist is unavailable. Use Orders to continue manually.");
      }
      const result = await response.json() as { answer: string; orders: Order[]; activity: Activity[]; traceId: string };
      if (current.signal.aborted) return;
      setAnswer(result.answer);
      setOrders(result.orders);
      setActivity(result.activity);
      setTraceId(result.traceId);
      setState(result.orders.length ? "ready" : "empty");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "AI Assist is unavailable. Use Orders to continue manually.");
      setState(current.signal.aborted ? "cancelled" : "error");
    } finally {
      if (controller.current === current) controller.current = null;
      if (isGuest) router.refresh();
    }
  }
  function cancel() { controller.current?.abort(); setState("cancelled"); }
  return <section id={compact ? undefined : "order-assistant"} aria-label={compact ? "AI Assist for this order" : "Order assistant"} className="workspace-assist product-note">
    <div><h2>{compact ? "AI Assist for this order" : "Order assistant"}</h2>
      <p className="product-muted">The assistant reads only recent orders visible to your account. It does not change orders.</p>
      {focusOrderId && <p>Selected order: <code className="workspace-code">{focusOrderId}</code></p>}</div>
    <label className="workspace-field" htmlFor="order-question">Question
      <Input.TextArea id="order-question" rows={3} maxLength={1_000} value={question}
        onChange={(event) => {
          setQuestion(event.target.value);
          setAnswer("");
          setOrders([]);
          setActivity([]);
          setTraceId("");
          setState("idle");
        }} disabled={state === "running"} />
    </label>
    <div className="workspace-action-row"><Button type="primary" icon={<SearchOutlined />} disabled={state === "running" || !question.trim()}
      loading={state === "running"} onClick={() => void ask()}>Check orders</Button>
      {state === "running" && <Button onClick={cancel}>Cancel</Button>}</div>
    {state === "running" && <Alert type="info" showIcon message="Checking your workspace orders…" />}
    {state === "cancelled" && <Alert type="info" showIcon message="Request cancelled. You can retry or use Orders." />}
    {state === "error" && <Alert type="error" showIcon message={errorMessage} />}
    {(state === "ready" || state === "empty") && activity.length > 0 &&
      <section className="product-note" aria-label="This run's activity">
        <h3>This run&apos;s activity</h3>
        <ol>{activity.map((event, index) => <li key={`${event.type}-${index}`}>
          Read recent orders in this workspace · {event.orderCount} returned
        </li>)}</ol>
        <p className="product-muted">Trace ID: <code className="workspace-code">{traceId}</code></p>
      </section>}
    {state === "empty" && <Alert type="info" showIcon message={answer} description="Check another workspace task or clarify the question." />}
    {state === "ready" && <><Alert type="success" showIcon message={answer} />
      <h3>Orders returned by the scoped tool</h3><OrderEvidence orders={orders} workspaceId={workspaceId} /></>}
    <Link href={`${base}/orders${focusOrderId ? `?orderId=${encodeURIComponent(focusOrderId)}` : ""}`}>Continue in Orders <ArrowRightOutlined /></Link>
  </section>;
}

export function AgentWorkspace({ workspaceId, focusOrderId, canAssign, manualTask, isGuest }: {
  workspaceId: string; focusOrderId?: string; canAssign: boolean; manualTask: "assign" | "reschedule" | null; isGuest: boolean;
}) {
  const base = `/workspaces/${workspaceId}`;
  return <main className="workspace-main">
    <div className="workspace-heading"><div><h1>Agent Workspace</h1><p>Choose a guided task. You can switch to traditional screens at any time.</p></div></div>
    <nav aria-label="Guided tasks" className="workspace-task-grid">
      <a href="#order-assistant"><Card className="workspace-panel" title="Review orders"><p>Ask the bounded order assistant.</p></Card></a>
      {canAssign && <Link href={`${base}/assignment`}><Card className="workspace-panel" title="Assign an order"><p>Review a saved proposal before execution.</p></Card></Link>}
      {manualTask === "assign" && <Link href={`${base}/orders#manual-assignment`}><Card className="workspace-panel" title="Assign a Demo order"><p>Choose an order and technician, then make the change manually.</p></Card></Link>}
      {manualTask === "reschedule" && <Link href={`${base}/orders#manual-reschedule`}><Card className="workspace-panel" title="Reschedule an order"><p>Review the assigned order and confirm its new time.</p></Card></Link>}
      <a href="#knowledge-assistant"><Card className="workspace-panel" title="Find knowledge excerpts"><p>Review cited source text or a clear uncertainty result.</p></Card></a>
      <Link href={`${base}/knowledge`}><Card className="workspace-panel" title="Search manually"><p>Inspect published text with citations.</p></Card></Link>
    </nav>
    <Card className="workspace-panel"><OrderAssistPanel workspaceId={workspaceId} focusOrderId={focusOrderId} isGuest={isGuest} /></Card>
    <section id="knowledge-assistant"><KnowledgeAssistPanel workspaceId={workspaceId} isGuest={isGuest} /></section>
  </main>;
}
