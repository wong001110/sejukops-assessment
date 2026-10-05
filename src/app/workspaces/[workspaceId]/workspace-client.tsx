"use client";

import { ArrowRightOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Descriptions, Drawer, Empty, Input, Modal, Select, Skeleton, Space, Table, Tag } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { OrderIntakeCard } from "./order-intake";
import { ManualOrderCard } from "./manual-order-card";
import { ScheduledTimePicker } from "./scheduled-time-picker";
import { resolveVisibleOrderId } from "./order-selection";
import { useLatestRequest } from "@/lib/ui/use-latest-request";
import { formatMalaysiaDateTime, malaysiaDateTimeLocalToIso } from "@/lib/time/malaysia";

export { NativeAgentWorkspace as AgentWorkspace } from "./native-agent-workspace";

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

function orderStatusColor(status: string) {
  return status === "COMPLETED" ? "green" : status === "IN_PROGRESS" ? "cyan" : status === "ASSIGNED" ? "blue" : "default";
}

function OrderEvidence({ orders, workspaceId, selectedId, onSelect }: {
  orders: Order[]; workspaceId: string; selectedId?: string; onSelect?: (id: string) => void;
}) {
  if (orders.length === 0) return <Empty description="No recent orders are visible in this workspace." />;
  return <Table<Order> size="small" rowKey="id" dataSource={orders} pagination={{ pageSize: 8, hideOnSinglePage: true }}
    scroll={{ x: 620 }} rowClassName={(order) => selectedId === order.id ? "portal-selected-row" : ""}
    columns={[
      { title: "Order", dataIndex: "order_no", width: 125 },
      { title: "Service", dataIndex: "service_type", width: 180 },
      { title: "Status", dataIndex: "status", width: 125, render: (status: string) => <Tag color={orderStatusColor(status)}>{status}</Tag> },
      { title: "Scheduled (MYT)", dataIndex: "scheduled_at", width: 180, render: formatWorkspaceDate },
      { title: "", key: "inspect", width: 110, render: (_, order) => onSelect
        ? <Button type="link" aria-pressed={selectedId === order.id} aria-controls="workspace-order-detail" onClick={() => onSelect(order.id)}>{selectedId === order.id ? "Selected" : "View details"}</Button>
        : <Link href={`/workspaces/${workspaceId}/orders?orderId=${encodeURIComponent(order.id)}`}>Open order</Link> },
    ]} />;
}

export function OrdersWorkspace({ workspaceId, canAssign, canImport, canCreate, isGuest, canGuestAssign, canManagerReschedule, canAdvanceJob, canUseAi = true, technicianLabel, role, presentation = "orders" }: {
  workspaceId: string; canAssign: boolean; canImport: boolean; canCreate: boolean; isGuest: boolean; canGuestAssign: boolean; canManagerReschedule: boolean; canAdvanceJob: boolean; canUseAi?: boolean; technicianLabel?: string; role?: "ADMIN" | "MANAGER" | "TECHNICIAN"; presentation?: "orders" | "schedule";
}) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [generation, setGeneration] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [jobBusy, setJobBusy] = useState(false);
  const [jobMessage, setJobMessage] = useState("");
  const [panel, setPanel] = useState<"create" | "import" | "assign" | "reschedule" | "assist" | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [panelBusy, setPanelBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const openedManualContext = useRef("");
  const jobRequests = useLatestRequest();
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const loads = useLatestRequest();
  const base = `/workspaces/${workspaceId}`;
  const load = useCallback(async () => {
    const current = loads.begin();
    setState("loading");
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/orders`, { cache: "no-store", signal: current.signal });
      if (!response.ok) throw new Error("Orders unavailable");
      const body = await response.json() as { orders: Order[]; generation: number };
      if (!current.isCurrent()) return;
      setOrders(body.orders);
      setGeneration(body.generation);
      const requested = new URLSearchParams(window.location.search).get("orderId");
      setSelectedId((current) => resolveVisibleOrderId(body.orders, current, requested));
      if (requested) setDetailOpen(true);
      setState("ready");
    } catch {
      if (!current.isCurrent()) return;
      setState("error");
    } finally { current.finish(); }
  }, [workspaceId, loads]);
  useEffect(() => {
    void load();
    return () => loads.cancel();
  }, [load, loads]);
  const selected = state === "ready" ? orders.find((order) => order.id === selectedId) : undefined;
  useEffect(() => {
    if (state !== "ready" || !selectedId) return;
    const hash = window.location.hash;
    const context = `${workspaceId}:${selectedId}:${hash}`;
    if (openedManualContext.current === context) return;
    openedManualContext.current = context;
    if (hash === "#manual-assignment" && canGuestAssign) setPanel("assign");
    if (hash === "#manual-reschedule" && canManagerReschedule) setPanel("reschedule");
  }, [workspaceId, state, selectedId, canGuestAssign, canManagerReschedule]);
  useEffect(() => {
    const openImport = () => { if (canImport && window.location.hash === "#import-document") setPanel("import"); };
    const requestImport = () => { if (canImport) setPanel("import"); };
    openImport(); window.addEventListener("hashchange", openImport); window.addEventListener("popstate", openImport);
    window.addEventListener("workspace:import-document", requestImport);
    return () => { window.removeEventListener("hashchange", openImport); window.removeEventListener("popstate", openImport); window.removeEventListener("workspace:import-document", requestImport); };
  }, [canImport]);
  const visibleOrders = orders.filter((order) => (statusFilter === "ALL" || order.status === statusFilter) &&
    `${order.order_no} ${order.service_type} ${order.problem_description}`.toLowerCase().includes(query.toLowerCase()));
  useEffect(() => {
    jobRequests.cancel(); setJobBusy(false); setJobMessage("");
    return () => jobRequests.cancel();
  }, [workspaceId, selectedId, canAdvanceJob, jobRequests]);
  function selectOrder(id: string) {
    setPanel(null); setDetailOpen(true);
    setSelectedId(id);
    // Let Next.js synchronize its router URL and preserve its own history metadata.
    window.history.replaceState(null, "", `${base}/${presentation === "schedule" ? "schedule" : "orders"}?orderId=${encodeURIComponent(id)}`);
    window.requestAnimationFrame(() => {
      detailHeadingRef.current?.focus({ preventScroll: true });
      if (window.matchMedia?.("(max-width: 760px)").matches) {
        detailHeadingRef.current?.scrollIntoView({ block: "start" });
      }
    });
  }
  async function advanceJob(order: Order) {
    if (!generation || !canAdvanceJob || state !== "ready" || jobRequests.pending() || (order.status !== "ASSIGNED" && order.status !== "IN_PROGRESS")) return;
    const current = jobRequests.begin();
    setJobBusy(true); setJobMessage("");
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/orders/${order.id}/status`, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: current.signal,
        body: JSON.stringify({
          expectedGeneration: generation, expectedUpdatedAt: order.updated_at,
          nextStatus: order.status === "ASSIGNED" ? "IN_PROGRESS" : "COMPLETED",
        }),
      });
      if (!current.isCurrent()) return;
      if (!response.ok) throw new Error("Job update was rejected. Refresh the order and try again.");
      setJobMessage(order.status === "ASSIGNED" ? "Job started." : "Job completed.");
      await load();
    } catch (error) {
      if (!current.isCurrent()) return;
      setJobMessage(error instanceof Error ? error.message : "Job could not be updated.");
    } finally { if (current.isCurrent()) setJobBusy(false); current.finish(); }
  }
  const technicianView = role === "TECHNICIAN" || canAdvanceJob;
  return <main className={`workspace-main ${technicianView ? "tech-job-workspace" : "order-workspace page-stack admin-workspace"}`}>
    <div className={technicianView ? "workspace-heading tech-page-heading" : "workspace-heading page-heading modern-page-heading"}><div><h1>{presentation === "schedule" ? "Schedule" : (role === "TECHNICIAN" || canAdvanceJob) ? "My jobs" : "Orders"}</h1><p>{presentation === "schedule" ? "Review visible orders, including unscheduled requests, and reschedule assigned visits. All times are MYT." : canAdvanceJob ? "Review your assigned jobs and update their progress." : "Browse workspace orders. Open a record to inspect details or take an action."}</p></div>
      <Space wrap><Button icon={<ReloadOutlined />} onClick={() => void load()}>Refresh</Button>
        {presentation === "orders" && canCreate && <Button type="primary" onClick={() => setPanel("create")}>New order</Button>}
        {presentation === "orders" && canImport && <Button onClick={() => setPanel("import")}>Import document</Button>}
      </Space></div>
    {!technicianView && state === "ready" && <Card className="order-status-summary" size="small" aria-label="Recent order status filters"><div className="status-summary-buttons">
      {["ALL", "NEW", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CLOSED"].map(status => <Button key={status} aria-pressed={statusFilter === status} type={statusFilter === status ? "primary" : "default"} onClick={() => setStatusFilter(status)}>
        <span>{status === "ALL" ? "All" : status.replaceAll("_", " ")}</span><strong>{status === "ALL" ? orders.length : orders.filter(order => order.status === status).length}</strong>
      </Button>)}
    </div><p className="product-muted">Recent visible records only (up to 20).</p></Card>}
    <Card className={technicianView ? "tech-job-toolbar" : "order-toolbar"} size="small">
      <Space wrap className="portal-order-filters"><Input aria-label="Search orders" placeholder="Search order or service" value={query} onChange={(event) => setQuery(event.target.value)} />
        <Select aria-label="Filter order status" value={statusFilter} onChange={setStatusFilter} options={["ALL", "NEW", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CLOSED"].map((value) => ({ value, label: value === "ALL" ? "All statuses" : value }))} /></Space>
    </Card>
    {technicianView ? <div className="tech-job-list" aria-label="Assigned jobs">
      {state === "loading" && <Skeleton active paragraph={{ rows: 5 }} />}
      {state === "error" && <Alert type="error" showIcon message="Orders could not be loaded." description="Refresh to try again." />}
      {state === "ready" && (visibleOrders.length === 0 ? <Empty description="No assigned jobs are visible." /> : visibleOrders.map(order => <Card key={order.id} className="tech-job-card" size="small">
        <div className="workspace-order-top"><h2>{order.order_no}</h2><Tag color={orderStatusColor(order.status)}>{order.status}</Tag></div>
        <p className="tech-service-type">{order.service_type}</p><p className="tech-job-meta">{formatWorkspaceDate(order.scheduled_at)}</p>
        <p>{order.problem_description}</p><Button block onClick={() => selectOrder(order.id)}>View details</Button>
      </Card>))}
    </div> : <Card className="order-table-card" aria-label="Recent orders" styles={{ body: { padding: 0 } }}>
      {state === "loading" && <div className="table-skeleton"><Skeleton active paragraph={{ rows: 5 }} /></div>}
      {state === "error" && <Alert type="error" showIcon message="Orders could not be loaded." description="Refresh to try again." />}
      {state === "ready" && <OrderEvidence orders={visibleOrders} workspaceId={workspaceId} selectedId={selectedId} onSelect={selectOrder} />}
    </Card>}
    <Drawer rootClassName="operations-legacy-overlay" className="legacy-order-detail" title="Order detail" width={760} open={detailOpen && panel === null} onClose={() => setDetailOpen(false)}>
      <Card id="workspace-order-detail" className="workspace-panel" aria-label="Order detail">
        {selected ? <>
          <div className="workspace-order-top"><h2 ref={detailHeadingRef} tabIndex={-1}>{selected.order_no}</h2><Tag color={orderStatusColor(selected.status)}>{selected.status}</Tag></div>
          <p>{selected.problem_description}</p>
          <Descriptions column={1} size="small" bordered items={[
            { key: "service", label: "Service", children: selected.service_type },
            { key: "schedule", label: "Scheduled (MYT)", children: formatWorkspaceDate(selected.scheduled_at) },
            { key: "technician", label: "Technician", children: selected.assigned_technician_id
              ? canAdvanceJob ? "You" : isGuest ? "Demo technician" : technicianLabel ?? selected.assigned_technician_id
              : "Not assigned" },
            { key: "updated", label: "Last updated", children: formatWorkspaceDate(selected.updated_at) },
          ]} />
          {canAdvanceJob && (selected.status === "ASSIGNED" || selected.status === "IN_PROGRESS") &&
            <div className="product-note"><Button type="primary" disabled={jobBusy} loading={jobBusy} onClick={() => void advanceJob(selected)}>
              {selected.status === "ASSIGNED" ? "Start assigned job" : "Complete job"}
            </Button></div>}
          {jobMessage && <Alert type={jobMessage.includes("rejected") || jobMessage.includes("could not") ? "error" : "success"} showIcon message={jobMessage} />}
          <Space wrap className="product-note">
            {canGuestAssign && <Button disabled={!["NEW", "ASSIGNED"].includes(selected.status)} onClick={() => setPanel("assign")}>Assign order</Button>}
            {canManagerReschedule && <Button disabled={selected.status !== "ASSIGNED" || !selected.assigned_technician_id} onClick={() => setPanel("reschedule")}>Reschedule order</Button>}
            {canAssign && <Link href={`${base}/assignment?orderId=${encodeURIComponent(selected.id)}`}>Prepare an assignment</Link>}
            {!canAdvanceJob && canUseAi && <Button onClick={() => setPanel("assist")}>AI Assist</Button>}
          </Space>
          {!canAdvanceJob && canUseAi && <p className="product-note"><Link href={`${base}/agent?orderId=${encodeURIComponent(selected.id)}`}>Open this order in AI Workspace <ArrowRightOutlined /></Link></p>}
        </> : <Empty description={canUseAi ? "Select an order to inspect it. You can continue manually if AI Assist is unavailable." : "Select an order to inspect it."} />}
        <Space wrap className="product-note"><Link href={`${base}/knowledge`}>Search knowledge</Link></Space>
      </Card>
    </Drawer>
    <Drawer rootClassName="operations-legacy-overlay" title={panel === "create" ? "New order" : panel === "import" ? "Import document" : panel === "assign" ? "Assign order" : "Reschedule order"} width={620}
      open={panel !== null && panel !== "assist"} closable={!panelBusy} maskClosable={!panelBusy} keyboard={!panelBusy} onClose={() => { if (!panelBusy) setPanel(null); }}>
    {panel === "create" && canCreate && <ManualOrderCard workspaceId={workspaceId} isGuest={isGuest} onBusyChange={setPanelBusy} onCreated={() => void load()} />}
    {panel === "assign" && canGuestAssign && <div id="manual-assignment"><GuestManualAssignmentCard workspaceId={workspaceId} orders={orders}
      selectedOrderId={orders.some((item) => item.id === selectedId && ["NEW", "ASSIGNED"].includes(item.status)) ? selectedId : ""}
      generation={state === "ready" ? generation : null} onBusyChange={setPanelBusy} onAssigned={() => void load()} /></div>}
    {panel === "reschedule" && canManagerReschedule && <div id="manual-reschedule"><ManagerScheduleCard workspaceId={workspaceId} orders={orders}
      selectedOrderId={orders.some((item) => item.id === selectedId && item.status === "ASSIGNED" && item.assigned_technician_id) ? selectedId : ""}
      generation={state === "ready" ? generation : null} onBusyChange={setPanelBusy} onRescheduled={() => void load()} isGuest={isGuest} /></div>}
    {panel === "import" && canImport && <OrderIntakeCard workspaceId={workspaceId} isGuest={isGuest} onBusyChange={setPanelBusy} onCreated={() => void load()} />}
    </Drawer>
    <Modal rootClassName="operations-legacy-overlay" title={selected ? `AI Assist · ${selected.order_no}` : "AI Assist"} open={panel === "assist" && Boolean(selected)} onCancel={() => setPanel(null)} footer={null} destroyOnHidden width={720}>
      {panel === "assist" && selected && canUseAi && !canAdvanceJob && <OrderAssistPanel key={selected.id} workspaceId={workspaceId} focusOrderId={selected.id} compact isGuest={isGuest} />}
    </Modal>
  </main>;
}

function GuestManualAssignmentCard({ workspaceId, orders, selectedOrderId, generation, onAssigned, onBusyChange }: {
  workspaceId: string; orders: Order[]; selectedOrderId: string; generation: number | null; onAssigned: () => void; onBusyChange?: (busy: boolean) => void;
}) {
  type Technician = { id: string; branch_id: string };
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [orderId, setOrderId] = useState("");
  const [technicianId, setTechnicianId] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  const [message, setMessage] = useState("");
  const [technicianState, setTechnicianState] = useState<"loading" | "ready" | "error">("loading");
  const assignments = useLatestRequest();
  const technicianLoads = useLatestRequest();
  const order = orders.find((item) => item.id === orderId && ["NEW", "ASSIGNED"].includes(item.status));
  const available = technicians.filter((item) => item.branch_id === order?.branch_id);
  useEffect(() => {
    assignments.cancel(); setBusy(false);
    setOrderId(selectedOrderId);
    setTechnicianId("");
    setScheduledAt("");
    setMessage("");
    return () => assignments.cancel();
  }, [selectedOrderId, workspaceId, assignments]);
  const loadTechnicians = useCallback(async () => {
    const current = technicianLoads.begin();
    setTechnicianState("loading"); setTechnicians([]); setTechnicianId("");
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/technicians`, { cache: "no-store", signal: current.signal });
      if (!response.ok) throw new Error();
      const data = await response.json() as { technicians: Technician[] };
      if (!current.isCurrent()) return;
      setTechnicians(data.technicians); setTechnicianState("ready");
    } catch {
      if (current.isCurrent()) setTechnicianState("error");
    } finally { current.finish(); }
  }, [workspaceId, technicianLoads]);
  useEffect(() => {
    void loadTechnicians();
    return () => technicianLoads.cancel();
  }, [loadTechnicians, technicianLoads]);

  async function assign() {
    if (!order || !technicianId || !generation || technicianState !== "ready" || assignments.pending()) return;
    const current = assignments.begin();
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/orders/${order.id}/assignment`, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: current.signal,
        body: JSON.stringify({
          expectedGeneration: generation,
          expectedUpdatedAt: order.updated_at,
          technicianId,
          scheduledAt: scheduledAt ? malaysiaDateTimeLocalToIso(scheduledAt) : null,
        }),
      });
      if (!current.isCurrent()) return;
      if (!response.ok) throw new Error(response.status === 409
        ? "The order or Demo data changed. Refresh and review it before assigning."
        : "Assignment could not be completed. Refresh and try again.");
      setOrderId(""); setTechnicianId(""); setScheduledAt("");
      setMessage("Demo order assigned. The Technician perspective can now view it.");
      onAssigned();
    } catch (error) {
      if (!current.isCurrent()) return;
      setMessage(error instanceof Error ? error.message : "Assignment could not be completed.");
    } finally { if (current.isCurrent()) setBusy(false); current.finish(); }
  }

  return <Card className="workspace-panel" title="Assign technician">
    <p className="product-muted">This changes shared fictional Demo data. Review the selected order and technician before assigning.</p>
    <div className="workspace-fields">
      {technicianState === "loading" && <Alert type="info" showIcon message="Loading technician choices…" />}
      {technicianState === "error" && <Alert type="error" showIcon message="Technicians are unavailable. Retry the choices."
        action={<Button disabled={busy} onClick={() => void loadTechnicians()}>Retry technician choices</Button>} />}
      <label className="workspace-field">Order
        <Select aria-label="Demo order to assign" disabled={busy || !generation} value={orderId || undefined} placeholder="Choose an order"
          onChange={(value) => { setOrderId(value); setTechnicianId(""); setMessage(""); }}
          options={orders.filter((item) => ["NEW", "ASSIGNED"].includes(item.status))
            .map((item) => ({ value: item.id, label: `${item.order_no} (${item.status})` }))} />
      </label>
      <label className="workspace-field">Technician in the same branch
        <Select aria-label="Demo technician" value={technicianId || undefined} placeholder="Choose a technician"
          disabled={busy || !generation || !order || technicianState !== "ready"} onChange={setTechnicianId}
          options={available.map((item, index) => ({ value: item.id, label: `Demo technician ${index + 1}` }))} />
      </label>
      <label className="workspace-field">Scheduled time (optional)
        <ScheduledTimePicker label="Scheduled time (optional)" disabled={busy || !generation} value={scheduledAt} onChange={setScheduledAt} />
      </label>
      {order && technicianId && <Alert type="info" showIcon message={`Assign ${order.order_no} to the selected Demo technician${scheduledAt ? ` at ${scheduledAt}` : ""}.`} />}
      {technicianState === "ready" && order && !available.length && <Alert type="info" showIcon message="No technician is available in this order's branch." />}
      <Button type="primary" loading={busy} disabled={busy || technicianState !== "ready" || !order || !technicianId || !generation}
        onClick={() => void assign()}>Assign this order</Button>
      {message && <Alert type={message.startsWith("Demo order assigned") ? "success" : "error"} showIcon message={message} />}
    </div>
  </Card>;
}

function ManagerScheduleCard({ workspaceId, orders, selectedOrderId, generation, onRescheduled, isGuest, onBusyChange }: {
  workspaceId: string; orders: Order[]; selectedOrderId: string; generation: number | null; onRescheduled: () => void; onBusyChange?: (busy: boolean) => void; isGuest: boolean;
}) {
  const [orderId, setOrderId] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  const [message, setMessage] = useState("");
  const schedules = useLatestRequest();
  const order = orders.find((item) => item.id === orderId && item.status === "ASSIGNED" && item.assigned_technician_id);
  const newTime = scheduledAt ? new Date(malaysiaDateTimeLocalToIso(scheduledAt)) : null;
  const changed = Boolean(order && newTime && Number.isFinite(newTime.getTime()) &&
    (!order.scheduled_at || newTime.getTime() !== new Date(order.scheduled_at).getTime()));
  useEffect(() => {
    schedules.cancel(); setBusy(false);
    setOrderId(selectedOrderId);
    setScheduledAt("");
    setMessage("");
    return () => schedules.cancel();
  }, [selectedOrderId, workspaceId, schedules]);

  async function reschedule() {
    if (!order || !generation || !newTime || !changed || schedules.pending()) return;
    const current = schedules.begin();
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/orders/${order.id}/schedule`, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: current.signal,
        body: JSON.stringify({
          expectedGeneration: generation, expectedUpdatedAt: order.updated_at,
          scheduledAt: newTime.toISOString(),
        }),
      });
      if (!current.isCurrent()) return;
      if (!response.ok) throw new Error(response.status === 409
        ? "The order or Demo data changed. Refresh and review the schedule again."
        : "Schedule could not be changed. Refresh and try again.");
      setOrderId(""); setScheduledAt("");
      setMessage("Schedule changed. The assigned technician is unchanged.");
      onRescheduled();
    } catch (error) {
      if (!current.isCurrent()) return;
      setMessage(error instanceof Error ? error.message : "Schedule could not be changed.");
    } finally { if (current.isCurrent()) setBusy(false); current.finish(); }
  }

  return <Card className="workspace-panel" title="Reschedule order">
    <p className="product-muted">{isGuest ? "This changes shared fictional Demo data. " : ""}The assigned technician stays the same.</p>
    <div className="workspace-fields">
      <label className="workspace-field">Assigned order
        <Select aria-label="Order to reschedule" disabled={busy || !generation} value={orderId || undefined} placeholder="Choose an assigned order"
          onChange={(value) => { setOrderId(value); setScheduledAt(""); setMessage(""); }}
          options={orders.filter((item) => item.status === "ASSIGNED" && item.assigned_technician_id)
            .map((item) => ({ value: item.id, label: item.order_no }))} />
      </label>
      <label className="workspace-field">New scheduled time
        <ScheduledTimePicker label="New scheduled time" disabled={busy || !generation} value={scheduledAt} onChange={setScheduledAt} />
      </label>
      {order && changed && <Alert type="info" showIcon message={`Review ${order.order_no}: ${order.scheduled_at ? formatMalaysiaDateTime(order.scheduled_at) : "Not scheduled"} → ${newTime ? formatMalaysiaDateTime(newTime) : ""}. Technician unchanged.`} />}
      <Button type="primary" loading={busy} disabled={busy || !changed || !generation}
        onClick={() => void reschedule()}>Confirm new schedule</Button>
      {message && <Alert type={message.startsWith("Schedule changed") ? "success" : "error"} showIcon message={message} />}
    </div>
  </Card>;
}

function OrderAssistPanel({ workspaceId, focusOrderId, compact = false, isGuest }: {
  workspaceId: string; focusOrderId?: string; compact?: boolean; isGuest: boolean;
}) {
  type Activity = { type: "RECENT_ORDERS_READ" | "ORDER_READ"; orderCount: number };
  const [question, setQuestion] = useState(focusOrderId ? "Review this order" : "Find relevant recent orders");
  const [orders, setOrders] = useState<Order[]>([]);
  const [answer, setAnswer] = useState("");
  const [activity, setActivity] = useState<Activity[]>([]);
  const [traceId, setTraceId] = useState("");
  const [errorMessage, setErrorMessage] = useState("AI Assist is unavailable. Use Orders to continue manually.");
  const [state, setState] = useState<"idle" | "running" | "ready" | "empty" | "error" | "cancelled">("idle");
  const requests = useLatestRequest();
  const router = useRouter();
  const base = `/workspaces/${workspaceId}`;
  async function ask() {
    if (!question.trim() || requests.pending()) return;
    const current = requests.begin();
    setState("running"); setAnswer(""); setOrders([]); setActivity([]); setTraceId("");
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/agent/orders`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question.trim(), focusOrderId }), signal: current.signal,
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
      if (!current.isCurrent()) return;
      setAnswer(result.answer);
      setOrders(result.orders);
      setActivity(result.activity);
      setTraceId(result.traceId);
      setState(result.orders.length ? "ready" : "empty");
    } catch (error) {
      if (!current.isCurrent()) return;
      setErrorMessage(error instanceof Error ? error.message : "AI Assist is unavailable. Use Orders to continue manually.");
      setState("error");
    } finally {
      const active = current.isCurrent();
      current.finish();
      if (isGuest && active) router.refresh();
    }
  }
  function cancel() { requests.cancel(); setState("cancelled"); if (isGuest) router.refresh(); }
  return <section id={compact ? undefined : "order-assistant"} aria-label={compact ? "AI Assist for this order" : "Order assistant"} className="workspace-assist product-note">
    <div><h2>{compact ? "AI Assist for this order" : "Order assistant"}</h2>
      <p className="product-muted">{focusOrderId
        ? "The assistant reads this selected order only if it is visible to your account."
        : "The assistant searches up to 20 recent orders visible to your account; use Orders for older records."} It does not change orders.</p>
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
          {event.type === "ORDER_READ" ? "Read selected order" : "Read recent orders"} in this workspace · {event.orderCount} returned
        </li>)}</ol>
        <p className="product-muted">Trace ID: <code className="workspace-code">{traceId}</code></p>
      </section>}
    {state === "empty" && <Alert type="info" showIcon message={answer} description="Check another workspace task or clarify the question." />}
    {state === "ready" && <><Alert type="info" showIcon message={answer} />
      <h3>Orders from scoped evidence</h3><OrderEvidence orders={orders} workspaceId={workspaceId} /></>}
    <Link href={`${base}/orders${focusOrderId ? `?orderId=${encodeURIComponent(focusOrderId)}` : ""}`}>Continue in Orders <ArrowRightOutlined /></Link>
  </section>;
}
