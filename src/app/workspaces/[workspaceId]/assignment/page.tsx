"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type Order = { id: string; order_no: string; branch_id: string; status: string; updated_at: string };
type Technician = { id: string; branch_id: string; profile_id: string };
type Proposal = {
  id: string;
  status: string;
  canonicalPayload: { orderId: string; technicianId: string; scheduledAt: string | null };
  targetUpdatedAt: string;
  expiresAt: string;
};

export default function AssignmentProposalPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const [orders, setOrders] = useState<Order[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [orderId, setOrderId] = useState("");
  const [technicianId, setTechnicianId] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [previewToken, setPreviewToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const selectedOrder = orders.find((order) => order.id === orderId);
  const availableTechnicians = useMemo(() =>
    technicians.filter((tech) => tech.branch_id === selectedOrder?.branch_id),
  [technicians, selectedOrder?.branch_id]);
  const base = `/api/workspaces/${encodeURIComponent(workspaceId)}`;

  useEffect(() => {
    let mounted = true;
    Promise.all([
      fetch(`${base}/orders`, { cache: "no-store" }).then((response) => response.ok ? response.json() : Promise.reject()),
      fetch(`${base}/technicians`, { cache: "no-store" }).then((response) => response.ok ? response.json() : Promise.reject()),
    ]).then(([orderData, techData]) => {
      if (!mounted) return;
      setOrders(orderData.orders ?? []);
      setTechnicians(techData.technicians ?? []);
    }).catch(() => { if (mounted) setMessage("Orders or technicians could not be loaded."); });
    return () => { mounted = false; };
  }, [base]);

  async function prepare() {
    if (!selectedOrder || !technicianId) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`${base}/assignment-proposals`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: selectedOrder.id, technicianId,
          expectedUpdatedAt: selectedOrder.updated_at,
          scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      if (!response.ok) throw new Error();
      const created = await response.json();
      const preview = await fetch(`${base}/assignment-proposals/${created.proposal.id}`, { cache: "no-store" });
      if (!preview.ok) throw new Error();
      const detail = await preview.json();
      setProposal(detail.proposal);
      setPreviewToken(detail.previewToken);
    } catch {
      setMessage("The proposal could not be prepared. Refresh the order and try again.");
    } finally { setBusy(false); }
  }

  async function confirm() {
    if (!proposal || !previewToken) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`${base}/assignment-proposals/${proposal.id}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true, previewToken }),
      });
      const result = await response.json();
      setProposal(result.proposal ?? proposal);
      setMessage(response.ok ? "Assignment executed." : "The proposal is stale or was rejected. Refresh before retrying.");
    } catch { setMessage("Confirmation failed. The same proposal can be retried if still valid."); }
    finally { setBusy(false); }
  }

  return <main className="mx-auto max-w-2xl space-y-6 p-6">
    <h1 className="text-2xl font-semibold">Assign an order</h1>
    <p>Select an order and technician, then review the exact saved change before confirming.</p>
    <section className="space-y-4 rounded-lg border p-4">
      <label className="block">Order
        <select className="mt-1 block w-full border p-2" value={orderId}
          onChange={(event) => { setOrderId(event.target.value); setTechnicianId(""); setProposal(null); }}>
          <option value="">Choose an order</option>
          {orders.filter((order) => ["NEW", "ASSIGNED"].includes(order.status)).map((order) =>
            <option key={order.id} value={order.id}>{order.order_no} ({order.status})</option>)}
        </select>
      </label>
      <label className="block">Technician for this branch
        <select className="mt-1 block w-full border p-2" value={technicianId}
          onChange={(event) => { setTechnicianId(event.target.value); setProposal(null); }}>
          <option value="">Choose a technician</option>
          {availableTechnicians.map((tech) => <option key={tech.id} value={tech.id}>{tech.profile_id}</option>)}
        </select>
      </label>
      <label className="block">Scheduled time (optional)
        <input className="mt-1 block w-full border p-2" type="datetime-local" value={scheduledAt}
          onChange={(event) => { setScheduledAt(event.target.value); setProposal(null); }} />
      </label>
      <button type="button" disabled={busy || !selectedOrder || !technicianId}
        className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50" onClick={prepare}>
        Prepare proposal
      </button>
    </section>
    {proposal && <section className="space-y-3 rounded-lg border p-4" aria-label="Saved assignment proposal">
      <h2 className="text-xl font-medium">Review saved proposal</h2>
      <dl className="grid grid-cols-2 gap-2 break-all">
        <dt>Order</dt><dd>{proposal.canonicalPayload.orderId}</dd>
        <dt>Technician</dt><dd>{proposal.canonicalPayload.technicianId}</dd>
        <dt>Scheduled time</dt><dd>{proposal.canonicalPayload.scheduledAt ?? "Unscheduled"}</dd>
        <dt>Order version</dt><dd>{proposal.targetUpdatedAt}</dd>
        <dt>Expires</dt><dd>{proposal.expiresAt}</dd>
        <dt>Status</dt><dd>{proposal.status}</dd>
      </dl>
      {!["EXECUTED", "STALE", "EXPIRED"].includes(proposal.status) &&
        <button type="button" disabled={busy || !previewToken}
          className="rounded bg-emerald-800 px-4 py-2 text-white disabled:opacity-50" onClick={confirm}>
          Confirm and execute this assignment
        </button>}
    </section>}
    {message && <p role="status">{message}</p>}
  </main>;
}
