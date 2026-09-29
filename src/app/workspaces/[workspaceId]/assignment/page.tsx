"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Descriptions, Input, Select, Tag } from "antd";

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
    const requestedProposalId = new URLSearchParams(window.location.search).get("proposalId");
    if (requestedProposalId) {
      fetch(`${base}/assignment-proposals/${encodeURIComponent(requestedProposalId)}`, { cache: "no-store" })
        .then((response) => response.ok ? response.json() : Promise.reject())
        .then((detail) => {
          if (!mounted) return;
          setProposal(detail.proposal);
          setPreviewToken(detail.previewToken);
        })
        .catch(() => {
          if (mounted) setMessage("This saved proposal is unavailable for this account. Sign in as its initiator or create a new one.");
        });
    }
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

  return <main className="workspace-main" style={{ maxWidth: 790 }}>
    <div className="workspace-heading"><div><h1>Assign an order</h1><p>Choose the details, then review the saved change before confirming.</p></div></div>
    <div className="workspace-fields">
      <Card className="workspace-panel" title="Prepare an assignment">
        <div className="workspace-fields">
          <label className="workspace-field">Order
            <Select aria-label="Order" placeholder="Choose an order" value={orderId || undefined} onChange={(value) => {
              setOrderId(value); setTechnicianId(""); setProposal(null);
            }} options={orders.filter((order) => ["NEW", "ASSIGNED"].includes(order.status)).map((order) => ({
              value: order.id, label: `${order.order_no} (${order.status})`,
            }))} />
          </label>
          <label className="workspace-field">Technician for this branch
            <Select aria-label="Technician for this branch" placeholder="Choose a technician" value={technicianId || undefined}
              disabled={!selectedOrder} onChange={(value) => { setTechnicianId(value); setProposal(null); }}
              options={availableTechnicians.map((tech) => ({ value: tech.id, label: tech.profile_id }))} />
          </label>
          <label className="workspace-field">Scheduled time (optional)
            <Input type="datetime-local" value={scheduledAt}
              onChange={(event) => { setScheduledAt(event.target.value); setProposal(null); }} />
          </label>
          <Button type="primary" disabled={busy || !selectedOrder || !technicianId} loading={busy} onClick={() => void prepare()}>
            Prepare proposal
          </Button>
        </div>
      </Card>
      {proposal && <Card className="workspace-panel workspace-description" title="Review saved proposal" aria-label="Saved assignment proposal">
        <Alert type="warning" showIcon message="Confirm only after checking the exact order, technician, and schedule below." description="This action changes the shared workspace." />
        <Descriptions className="product-note" bordered column={1} size="small" items={[
          { key: "order", label: "Order", children: <code className="workspace-code">{proposal.canonicalPayload.orderId}</code> },
          { key: "tech", label: "Technician", children: <code className="workspace-code">{proposal.canonicalPayload.technicianId}</code> },
          { key: "schedule", label: "Scheduled time", children: proposal.canonicalPayload.scheduledAt ?? "Unscheduled" },
          { key: "version", label: "Order version", children: proposal.targetUpdatedAt },
          { key: "expires", label: "Expires", children: proposal.expiresAt },
          { key: "status", label: "Status", children: <Tag color={proposal.status === "EXECUTED" ? "green" : "blue"}>{proposal.status}</Tag> },
        ]} />
        {!["EXECUTED", "STALE", "EXPIRED"].includes(proposal.status) &&
          <Button className="product-note" type="primary" disabled={busy || !previewToken} loading={busy} onClick={() => void confirm()}>
            Confirm and execute this assignment
          </Button>}
      </Card>}
      {message && <Alert type={message === "Assignment executed." ? "success" : "error"} showIcon message={message} />}
    </div>
  </main>;
}
