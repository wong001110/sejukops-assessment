"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type Order = {
  id: string; order_no: string; status: string; problem_description: string;
  service_type: string; scheduled_at: string | null; assigned_technician_id: string | null;
  updated_at: string;
};

function OrderEvidence({ orders, workspaceId, selectedId, onSelect }: {
  orders: Order[]; workspaceId: string; selectedId?: string; onSelect?: (id: string) => void;
}) {
  if (orders.length === 0) return <p>No recent orders are visible in this workspace.</p>;
  return <ul className="space-y-3">
    {orders.map((order) => <li key={order.id} className="rounded border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong>{order.order_no}</strong><span>{order.status}</span>
      </div>
      <p>{order.service_type} · {order.problem_description}</p>
      <p className="text-sm text-slate-600">Scheduled: {order.scheduled_at ?? "Not scheduled"}</p>
      {onSelect && <button type="button" className="text-blue-700 underline" onClick={() => onSelect(order.id)}>
        {selectedId === order.id ? "Selected" : "View details"}
      </button>}
      {!onSelect && <Link className="text-blue-700 underline" href={`/workspaces/${workspaceId}/orders?orderId=${encodeURIComponent(order.id)}`}>
        Open in Orders
      </Link>}
    </li>)}
  </ul>;
}

export function OrdersWorkspace({ workspaceId, canAssign }: { workspaceId: string; canAssign: boolean }) {
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
  return <main className="mx-auto max-w-5xl space-y-6 p-6">
    <div><h1 className="text-2xl font-semibold">Orders</h1><p>Traditional order view using your workspace permissions.</p></div>
    <div className="grid gap-6 md:grid-cols-2">
      <section aria-labelledby="orders-heading" className="space-y-3">
        <div className="flex items-center justify-between"><h2 id="orders-heading" className="text-xl font-medium">Recent orders</h2>
          <button type="button" className="text-blue-700 underline" onClick={() => void load()}>Refresh</button></div>
        {state === "loading" && <p role="status">Loading orders…</p>}
        {state === "error" && <p role="alert">Orders could not be loaded. Refresh to try again.</p>}
        {state === "ready" && <OrderEvidence orders={orders} workspaceId={workspaceId} selectedId={selectedId} onSelect={setSelectedId} />}
      </section>
      <section aria-labelledby="order-detail-heading" className="space-y-3 rounded border p-4">
        <h2 id="order-detail-heading" className="text-xl font-medium">Order detail</h2>
        {selected ? <>
          <p><strong>{selected.order_no}</strong> · {selected.status}</p>
          <p>{selected.problem_description}</p>
          <p>Service: {selected.service_type}</p>
          <p>Technician: {selected.assigned_technician_id ?? "Not assigned"}</p>
          <p>Last updated: {selected.updated_at}</p>
          <Link className="text-blue-700 underline" href={`${base}/agent?orderId=${encodeURIComponent(selected.id)}`}>
            Open this order in Agent Workspace
          </Link>
          <div className="border-t pt-3"><OrderAssistPanel key={selected.id} workspaceId={workspaceId}
            focusOrderId={selected.id} compact /></div>
        </> : <p>Select an order to inspect it. You can continue manually if AI Assist is unavailable.</p>}
        <div className="flex flex-wrap gap-4 border-t pt-3">
          {canAssign && <Link className="text-blue-700 underline" href={`${base}/assignment`}>Prepare an assignment</Link>}
          <Link className="text-blue-700 underline" href={`${base}/knowledge`}>Search knowledge</Link>
        </div>
      </section>
    </div>
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
  return <section id={compact ? undefined : "order-assistant"} aria-labelledby={compact ? "inline-assistant-heading" : "assistant-heading"}
    className={compact ? "space-y-3" : "space-y-3 rounded border p-4"}>
      <h2 id={compact ? "inline-assistant-heading" : "assistant-heading"} className="text-xl font-medium">
        {compact ? "AI Assist for this order" : "Order assistant"}</h2>
      <p>The assistant can only read recent orders visible to your account. It does not change orders.</p>
      {focusOrderId && <p>Selected order: <code>{focusOrderId}</code>. The assistant searches the recent-order set.</p>}
      <label htmlFor="order-question">Question</label>
      <textarea id="order-question" className="block w-full rounded border p-2" rows={3} maxLength={1_000}
        value={question} onChange={(event) => setQuestion(event.target.value)} disabled={state === "running"} />
      <div className="flex gap-3">
        <button type="button" className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
          disabled={state === "running" || !question.trim()} onClick={() => void ask()}>Check orders</button>
        {state === "running" && <button type="button" className="rounded border px-4 py-2" onClick={cancel}>Cancel</button>}
      </div>
      {state === "running" && <p role="status">Checking your workspace orders…</p>}
      {state === "cancelled" && <p role="status">Request cancelled. You can retry or use Orders.</p>}
      {state === "error" && <p role="alert">AI Assist is unavailable. Use Orders to continue manually.</p>}
      {state === "empty" && <p role="status">{answer} Check another workspace task or clarify the question.</p>}
      {state === "ready" && <><p role="status">{answer}</p>
        <h3 className="font-medium">Orders returned by the scoped tool</h3>
        <OrderEvidence orders={orders} workspaceId={workspaceId} /></>}
      <Link className="text-blue-700 underline" href={`${base}/orders${focusOrderId ? `?orderId=${encodeURIComponent(focusOrderId)}` : ""}`}>
        Continue in Orders
      </Link>
    </section>;
}

export function AgentWorkspace({ workspaceId, focusOrderId, canAssign }: {
  workspaceId: string; focusOrderId?: string; canAssign: boolean;
}) {
  const base = `/workspaces/${workspaceId}`;
  return <main className="mx-auto max-w-5xl space-y-6 p-6">
    <div><h1 className="text-2xl font-semibold">Agent Workspace</h1>
      <p>Choose a task. You can switch to the traditional screens at any time.</p></div>
    <nav aria-label="Guided tasks" className="grid gap-3 sm:grid-cols-3">
      <a href="#order-assistant" className="rounded border p-4"><strong>Review orders</strong><br />Ask the bounded order assistant.</a>
      {canAssign && <Link href={`${base}/assignment`} className="rounded border p-4"><strong>Assign an order</strong><br />Review a saved proposal before execution.</Link>}
      <Link href={`${base}/knowledge`} className="rounded border p-4"><strong>Search knowledge</strong><br />Find published text with citations.</Link>
    </nav>
    <OrderAssistPanel workspaceId={workspaceId} focusOrderId={focusOrderId} />
  </main>;
}
