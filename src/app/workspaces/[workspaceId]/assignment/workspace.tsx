"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Card, Descriptions, Empty, Select, Tag } from "antd";
import { ScheduledTimePicker } from "../scheduled-time-picker";
import { formatMalaysiaDateTime, malaysiaDateTimeLocalToIso } from "@/lib/time/malaysia";

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
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const contextVersion = useRef(0);
  const previewVersion = useRef(0);
  const submitting = useRef(false);
  const actionController = useRef<AbortController | null>(null);
  const selectedOrder = orders.find((order) => order.id === orderId);
  const availableTechnicians = useMemo(() =>
    technicians.filter((tech) => tech.branch_id === selectedOrder?.branch_id),
  [technicians, selectedOrder?.branch_id]);
  const base = `/api/workspaces/${encodeURIComponent(workspaceId)}`;

  useEffect(() => {
    const version = ++contextVersion.current;
    const savedPreviewVersion = ++previewVersion.current;
    const controller = new AbortController();
    submitting.current = false;
    setLoading(true); setBusy(false); setMessage(""); setOrders([]); setTechnicians([]);
    setOrderId(""); setTechnicianId(""); setScheduledAt(""); setProposal(null); setPreviewToken("");
    const params = new URLSearchParams(window.location.search);
    const requestedOrderId = params.get("orderId");
    Promise.all([
      fetch(`${base}/orders`, { cache: "no-store", signal: controller.signal }).then((response) => response.ok ? response.json() : Promise.reject()),
      fetch(`${base}/technicians`, { cache: "no-store", signal: controller.signal }).then((response) => response.ok ? response.json() : Promise.reject()),
    ]).then(([orderData, techData]) => {
      if (version !== contextVersion.current || controller.signal.aborted) return;
      setOrders(orderData.orders ?? []);
      setTechnicians(techData.technicians ?? []);
      const focus = (orderData.orders ?? []).find((order: Order) => order.id === requestedOrderId && ["NEW", "ASSIGNED"].includes(order.status));
      if (focus) setOrderId(focus.id);
    }).catch(() => {
      if (version === contextVersion.current && !controller.signal.aborted) setMessage("Orders or technicians could not be loaded. Reload choices to retry.");
    }).finally(() => { if (version === contextVersion.current && !controller.signal.aborted) setLoading(false); });
    const requestedProposalId = params.get("proposalId");
    if (requestedProposalId) {
      fetch(`${base}/assignment-proposals/${encodeURIComponent(requestedProposalId)}`, { cache: "no-store", signal: controller.signal })
        .then((response) => response.ok ? response.json() : Promise.reject())
        .then((detail) => {
          if (version !== contextVersion.current || savedPreviewVersion !== previewVersion.current || controller.signal.aborted) return;
          setProposal(detail.proposal);
          setPreviewToken(detail.previewToken);
        })
        .catch(() => {
          if (version === contextVersion.current && savedPreviewVersion === previewVersion.current && !controller.signal.aborted) setMessage("This saved proposal is unavailable for this account. Sign in as its initiator or create a new one.");
        });
    }
    return () => {
      contextVersion.current += 1;
      controller.abort(); actionController.current?.abort();
    };
  }, [base, reload]);

  function clearPreview() { previewVersion.current += 1; setProposal(null); setPreviewToken(""); setMessage(""); }

  async function prepare() {
    if (!selectedOrder || !technicianId || loading || submitting.current) return;
    submitting.current = true;
    previewVersion.current += 1;
    const version = contextVersion.current;
    const controller = new AbortController();
    actionController.current = controller;
    setBusy(true);
    setMessage("");
    setProposal(null); setPreviewToken("");
    try {
      const response = await fetch(`${base}/assignment-proposals`, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({
          orderId: selectedOrder.id, technicianId,
          expectedUpdatedAt: selectedOrder.updated_at,
          scheduledAt: scheduledAt ? malaysiaDateTimeLocalToIso(scheduledAt) : null,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      if (!response.ok) throw new Error();
      const created = await response.json();
      if (version !== contextVersion.current || controller.signal.aborted) return;
      const preview = await fetch(`${base}/assignment-proposals/${created.proposal.id}`, { cache: "no-store", signal: controller.signal });
      if (!preview.ok) throw new Error();
      const detail = await preview.json();
      if (version !== contextVersion.current || controller.signal.aborted) return;
      setProposal(detail.proposal);
      setPreviewToken(detail.previewToken);
    } catch {
      if (version === contextVersion.current && !controller.signal.aborted) setMessage("The proposal could not be prepared. Reload choices and try again.");
    } finally {
      if (version === contextVersion.current) { submitting.current = false; setBusy(false); }
      if (actionController.current === controller) actionController.current = null;
    }
  }

  async function confirm() {
    if (!proposal || !previewToken || !["PENDING", "APPROVED"].includes(proposal.status) || submitting.current) return;
    submitting.current = true;
    const version = contextVersion.current;
    const controller = new AbortController();
    actionController.current = controller;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`${base}/assignment-proposals/${proposal.id}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ confirm: true, previewToken }),
      });
      const result = await response.json();
      if (version !== contextVersion.current || controller.signal.aborted) return;
      setProposal(result.proposal ?? proposal);
      if (!response.ok) setPreviewToken("");
      setMessage(response.ok && result.proposal?.status === "EXECUTED" ? "Assignment executed." : "The proposal is stale or was rejected. Reload choices before retrying.");
    } catch {
      if (version === contextVersion.current && !controller.signal.aborted) setMessage("Confirmation failed. The same proposal can be retried if still valid.");
    } finally {
      if (version === contextVersion.current) { submitting.current = false; setBusy(false); }
      if (actionController.current === controller) actionController.current = null;
    }
  }

  return <main className="workspace-main" style={{ maxWidth: 790 }}>
    <div className="workspace-heading"><div><h1>Assign an order</h1><p>Choose the details, then review the saved change before confirming.</p></div></div>
    <div className="workspace-fields">
      {loading && <Alert type="info" showIcon message="Loading orders and technicians…" />}
      <Button disabled={busy || loading} onClick={() => setReload((current) => current + 1)}>Reload choices</Button>
      {!loading && !orders.some((order) => ["NEW", "ASSIGNED"].includes(order.status)) && !message &&
        <Empty description="No orders are available for assignment. Create an order in Orders first." />}
      <Card className="workspace-panel" title="Prepare an assignment">
        <div className="workspace-fields">
          <label className="workspace-field">Order
            <Select aria-label="Order" disabled={busy || loading} placeholder="Choose an order" value={orderId || undefined} onChange={(value) => {
              setOrderId(value); setTechnicianId(""); clearPreview();
            }} options={orders.filter((order) => ["NEW", "ASSIGNED"].includes(order.status)).map((order) => ({
              value: order.id, label: `${order.order_no} (${order.status})`,
            }))} />
          </label>
          <label className="workspace-field">Technician for this branch
            <Select aria-label="Technician for this branch" placeholder="Choose a technician" value={technicianId || undefined}
              disabled={busy || loading || !selectedOrder} onChange={(value) => { setTechnicianId(value); clearPreview(); }}
              options={availableTechnicians.map((tech) => ({ value: tech.id, label: `Technician ${tech.id.slice(0, 8)}` }))} />
          </label>
          <label className="workspace-field">Scheduled time (optional)
            <ScheduledTimePicker label="Scheduled time (optional)" disabled={busy || loading} value={scheduledAt}
              onChange={(value) => { setScheduledAt(value); clearPreview(); }} />
          </label>
          <Button type="primary" disabled={busy || loading || !selectedOrder || !technicianId} loading={busy} onClick={() => void prepare()}>
            Prepare proposal
          </Button>
        </div>
      </Card>
      {proposal && <Card className="workspace-panel workspace-description" title="Review saved proposal" aria-label="Saved assignment proposal">
        <Alert type="warning" showIcon message="Confirm only after checking the exact order, technician, and schedule below." description="This action changes the shared workspace." />
        <Descriptions className="product-note" bordered column={1} size="small" items={[
          { key: "order", label: "Order", children: orders.find((order) => order.id === proposal.canonicalPayload.orderId)?.order_no ?? "Inspect stored order identifier" },
          { key: "tech", label: "Technician", children: `Technician ${proposal.canonicalPayload.technicianId.slice(0, 8)}` },
          { key: "schedule", label: "Scheduled (MYT)", children: proposal.canonicalPayload.scheduledAt ? `${formatMalaysiaDateTime(proposal.canonicalPayload.scheduledAt)} MYT` : "Unscheduled" },
          { key: "expires", label: "Expires", children: `${formatMalaysiaDateTime(proposal.expiresAt)} MYT` },
          { key: "status", label: "Status", children: <Tag color={proposal.status === "EXECUTED" ? "green" : "blue"}>{proposal.status}</Tag> },
        ]} />
        <details className="product-note"><summary>Stored identifiers and version</summary><p>Order: {proposal.canonicalPayload.orderId}</p><p>Technician: {proposal.canonicalPayload.technicianId}</p><p>Order version: {proposal.targetUpdatedAt}</p></details>
        {["PENDING", "APPROVED"].includes(proposal.status) &&
          <Button className="product-note" type="primary" disabled={busy || !previewToken} loading={busy} onClick={() => void confirm()}>
            Confirm and execute this assignment
          </Button>}
      </Card>}
      {message && <Alert type={message === "Assignment executed." ? "success" : "error"} showIcon message={message} />}
    </div>
  </main>;
}
