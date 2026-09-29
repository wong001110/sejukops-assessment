"use client";

import { ArrowRightOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Descriptions, Empty, Input, Skeleton, Space, Tag } from "antd";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { OrderIntakeCard } from "./order-intake";

type Order = {
  id: string; order_no: string; status: string; problem_description: string;
  service_type: string; scheduled_at: string | null; assigned_technician_id: string | null;
  updated_at: string;
};

function OrderEvidence({ orders, workspaceId, selectedId, onSelect }: {
  orders: Order[]; workspaceId: string; selectedId?: string; onSelect?: (id: string) => void;
}) {
  if (orders.length === 0) return <Empty description="No recent orders are visible in this workspace." />;
  return <div className="workspace-order-list">
    {orders.map((order) => <article key={order.id} className={`workspace-order-item ${selectedId === order.id ? "is-selected" : ""}`}>
      <div className="workspace-order-top"><strong>{order.order_no}</strong><Tag color={order.status === "NEW" ? "blue" : "green"}>{order.status}</Tag></div>
      <p>{order.service_type} · {order.problem_description}</p>
      <p className="product-muted">Scheduled: {order.scheduled_at ?? "Not scheduled"}</p>
      {onSelect ? <Button type="link" onClick={() => onSelect(order.id)}>{selectedId === order.id ? "Selected" : "View details"}</Button>
        : <Link href={`/workspaces/${workspaceId}/orders?orderId=${encodeURIComponent(order.id)}`}>Open in Orders <ArrowRightOutlined /></Link>}
    </article>)}
  </div>;
}

export function OrdersWorkspace({ workspaceId, canAssign, canImport }: { workspaceId: string; canAssign: boolean; canImport: boolean }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const base = `/workspaces/${workspaceId}`;
  const load = useCallback(async (signal?: AbortSignal) => {
    setState("loading");
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/orders`, { cache: "no-store", signal });
      if (!response.ok) throw new Error("Orders unavailable");
      const body = await response.json() as { orders: Order[] };
      setOrders(body.orders);
      const requested = new URLSearchParams(window.location.search).get("orderId");
      setSelectedId((current) => current || (requested && body.orders.some((order) => order.id === requested) ? requested : ""));
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
  return <main className="workspace-main">
    <div className="workspace-heading"><div><h1>Orders</h1><p>Your workspace orders, with an assistant available in context.</p></div>
      <Button icon={<ReloadOutlined />} onClick={() => void load()}>Refresh</Button></div>
    <div className="workspace-grid">
      <Card className="workspace-panel" title="Recent orders" aria-label="Recent orders">
        {state === "loading" && <Skeleton active paragraph={{ rows: 5 }} />}
        {state === "error" && <Alert type="error" showIcon message="Orders could not be loaded." description="Refresh to try again." />}
        {state === "ready" && <OrderEvidence orders={orders} workspaceId={workspaceId} selectedId={selectedId} onSelect={setSelectedId} />}
      </Card>
      <Card className="workspace-panel" title="Order detail" aria-label="Order detail">
        {selected ? <>
          <div className="workspace-order-top"><h2>{selected.order_no}</h2><Tag color="blue">{selected.status}</Tag></div>
          <p>{selected.problem_description}</p>
          <Descriptions column={1} size="small" bordered items={[
            { key: "service", label: "Service", children: selected.service_type },
            { key: "technician", label: "Technician", children: selected.assigned_technician_id ?? "Not assigned" },
            { key: "updated", label: "Last updated", children: selected.updated_at },
          ]} />
          <p className="product-note"><Link href={`${base}/agent?orderId=${encodeURIComponent(selected.id)}`}>Open this order in Agent Workspace <ArrowRightOutlined /></Link></p>
          <OrderAssistPanel key={selected.id} workspaceId={workspaceId} focusOrderId={selected.id} compact />
        </> : <Empty description="Select an order to inspect it. You can continue manually if AI Assist is unavailable." />}
        <Space wrap className="product-note">{canAssign && <Link href={`${base}/assignment`}>Prepare an assignment</Link>}<Link href={`${base}/knowledge`}>Search knowledge</Link></Space>
      </Card>
    </div>
    {canImport && <div className="product-note"><OrderIntakeCard workspaceId={workspaceId} onCreated={() => void load()} /></div>}
  </main>;
}

function OrderAssistPanel({ workspaceId, focusOrderId, compact = false }: {
  workspaceId: string; focusOrderId?: string; compact?: boolean;
}) {
  const [question, setQuestion] = useState(focusOrderId ? `Show recent orders relevant to ${focusOrderId}` : "Show recent orders");
  const [orders, setOrders] = useState<Order[]>([]);
  const [answer, setAnswer] = useState("");
  const [state, setState] = useState<"idle" | "running" | "ready" | "empty" | "error" | "cancelled">("idle");
  const controller = useRef<AbortController | null>(null);
  const base = `/workspaces/${workspaceId}`;
  async function ask() {
    if (!question.trim() || state === "running") return;
    const current = new AbortController();
    controller.current = current;
    setState("running"); setAnswer(""); setOrders([]);
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/agent/orders`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question.trim() }), signal: current.signal,
      });
      if (!response.ok) throw new Error("AI Assist is unavailable. Use Orders to continue manually.");
      const result = await response.json() as { answer: string; orders: Order[] };
      setAnswer(result.answer);
      setOrders(result.orders);
      setState(result.orders.length ? "ready" : "empty");
    } catch {
      setState(current.signal.aborted ? "cancelled" : "error");
    } finally {
      if (controller.current === current) controller.current = null;
    }
  }
  function cancel() { controller.current?.abort(); setState("cancelled"); }
  return <section id={compact ? undefined : "order-assistant"} aria-label={compact ? "AI Assist for this order" : "Order assistant"} className="workspace-assist product-note">
    <div><h2>{compact ? "AI Assist for this order" : "Order assistant"}</h2>
      <p className="product-muted">The assistant reads only recent orders visible to your account. It does not change orders.</p>
      {focusOrderId && <p>Selected order: <code className="workspace-code">{focusOrderId}</code></p>}</div>
    <label className="workspace-field" htmlFor="order-question">Question
      <Input.TextArea id="order-question" rows={3} maxLength={1_000} value={question}
        onChange={(event) => setQuestion(event.target.value)} disabled={state === "running"} />
    </label>
    <div className="workspace-action-row"><Button type="primary" icon={<SearchOutlined />} disabled={state === "running" || !question.trim()}
      loading={state === "running"} onClick={() => void ask()}>Check orders</Button>
      {state === "running" && <Button onClick={cancel}>Cancel</Button>}</div>
    {state === "running" && <Alert type="info" showIcon message="Checking your workspace orders…" />}
    {state === "cancelled" && <Alert type="info" showIcon message="Request cancelled. You can retry or use Orders." />}
    {state === "error" && <Alert type="error" showIcon message="AI Assist is unavailable. Use Orders to continue manually." />}
    {state === "empty" && <Alert type="info" showIcon message={answer} description="Check another workspace task or clarify the question." />}
    {state === "ready" && <><Alert type="success" showIcon message={answer} />
      <h3>Orders returned by the scoped tool</h3><OrderEvidence orders={orders} workspaceId={workspaceId} /></>}
    <Link href={`${base}/orders${focusOrderId ? `?orderId=${encodeURIComponent(focusOrderId)}` : ""}`}>Continue in Orders <ArrowRightOutlined /></Link>
  </section>;
}

export function AgentWorkspace({ workspaceId, focusOrderId, canAssign }: {
  workspaceId: string; focusOrderId?: string; canAssign: boolean;
}) {
  const base = `/workspaces/${workspaceId}`;
  return <main className="workspace-main">
    <div className="workspace-heading"><div><h1>Agent Workspace</h1><p>Choose a guided task. You can switch to traditional screens at any time.</p></div></div>
    <nav aria-label="Guided tasks" className="workspace-task-grid">
      <a href="#order-assistant"><Card className="workspace-panel" title="Review orders"><p>Ask the bounded order assistant.</p></Card></a>
      {canAssign && <Link href={`${base}/assignment`}><Card className="workspace-panel" title="Assign an order"><p>Review a saved proposal before execution.</p></Card></Link>}
      <Link href={`${base}/knowledge`}><Card className="workspace-panel" title="Search knowledge"><p>Find published text with citations.</p></Card></Link>
    </nav>
    <Card className="workspace-panel"><OrderAssistPanel workspaceId={workspaceId} focusOrderId={focusOrderId} /></Card>
  </main>;
}
