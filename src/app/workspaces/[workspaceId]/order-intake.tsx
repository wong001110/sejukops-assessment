"use client";

import { Alert, Button, Card, Descriptions, Input, Select, Space, Tag } from "antd";
import { useEffect, useRef, useState } from "react";

type ExtractedField = { value: unknown; confidence: unknown; issues: unknown };
type Draft = {
  customerName: ExtractedField;
  serviceType: ExtractedField;
  serviceDetails: ExtractedField;
  amount: ExtractedField;
  date: ExtractedField;
};
type BranchOption = { id: string; code: string; name: string };
type CustomerOption = { id: string; name: string; address: string };
type Options = { branches: BranchOption[]; customers: CustomerOption[] };
type Reviewed = {
  orderNo: string; branchId: string; customerId: string;
  problemDescription: string; serviceType: string;
};
const emptyReview: Reviewed = {
  orderNo: "", branchId: "", customerId: "", problemDescription: "", serviceType: "",
};
function fieldText(field: ExtractedField | undefined) {
  if (field?.value === null || field?.value === undefined) return "";
  return String(field.value);
}
function issueText(field: ExtractedField | undefined) {
  return Array.isArray(field?.issues) ? field.issues.filter((issue): issue is string => typeof issue === "string").join("; ") : "";
}

export function OrderIntakeCard({ workspaceId, onCreated }: { workspaceId: string; onCreated: () => void }) {
  const base = `/api/workspaces/${encodeURIComponent(workspaceId)}/order-intake`;
  const [file, setFile] = useState<File>();
  const [draft, setDraft] = useState<Draft>();
  const [generation, setGeneration] = useState<number>();
  const [sourceSha256, setSourceSha256] = useState("");
  const [reviewed, setReviewed] = useState<Reviewed>(emptyReview);
  const [customerMode, setCustomerMode] = useState<"EXISTING" | "NEW">("EXISTING");
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [newCustomerAddress, setNewCustomerAddress] = useState("");
  const [options, setOptions] = useState<Options>({ branches: [], customers: [] });
  const [state, setState] = useState<"idle" | "extracting" | "review" | "confirming" | "complete">("idle");
  const [message, setMessage] = useState("");
  const [optionsError, setOptionsError] = useState(false);
  const requestVersion = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${base}/options`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) { setOptionsError(true); return; }
        const result = await response.json() as Options;
        setOptions({ branches: result.branches ?? [], customers: result.customers ?? [] });
        setOptionsError(false);
      })
      .catch(() => { if (!controller.signal.aborted) setOptionsError(true); });
    return () => controller.abort();
  }, [base]);

  async function extract() {
    if (!file) return;
    const currentVersion = ++requestVersion.current;
    setState("extracting"); setMessage(""); setDraft(undefined);
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch(`${base}/draft`, { method: "POST", body });
      if (!response.ok) {
        if (response.status === 429) {
          const detail = await response.json() as { error?: string; resetAt?: string | null };
          const reset = detail.resetAt && Number.isFinite(Date.parse(detail.resetAt))
            ? new Date(detail.resetAt).toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" }) : null;
          throw new Error(`${detail.error ?? "Today's Guest AI allowance is used up."}${reset ? ` Resets ${reset} Malaysia time.` : ""}`);
        }
        throw new Error("Extraction failed. Check that the file is supported and try again. Manual order entry is still available.");
      }
      const result = await response.json() as { draft: Draft; generation: number; sourceSha256: string };
      if (requestVersion.current !== currentVersion) return;
      setDraft(result.draft);
      setGeneration(result.generation);
      setSourceSha256(result.sourceSha256);
      setReviewed({
        ...emptyReview,
        problemDescription: fieldText(result.draft.serviceDetails),
        serviceType: fieldText(result.draft.serviceType),
      });
      setCustomerMode("EXISTING");
      setNewCustomerName(fieldText(result.draft.customerName));
      setNewCustomerPhone("");
      setNewCustomerAddress("");
      setState("review");
    } catch (error) {
      if (requestVersion.current !== currentVersion) return;
      setState("idle");
      setMessage(error instanceof Error ? error.message : "Extraction failed.");
    }
  }

  async function confirm() {
    if (!draft || !generation) return;
    setState("confirming"); setMessage("");
    try {
      const response = await fetch(`${base}/confirm`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmed: true, expectedGeneration: generation,
          orderNo: reviewed.orderNo, branchId: reviewed.branchId,
          customer: customerMode === "EXISTING"
            ? { mode: "EXISTING", customerId: reviewed.customerId }
            : { mode: "NEW", name: newCustomerName, phone: newCustomerPhone.trim() || null, address: newCustomerAddress },
          problemDescription: reviewed.problemDescription, serviceType: reviewed.serviceType,
        }),
      });
      if (!response.ok) throw new Error("Order creation was rejected. Check the fields and workspace state before retrying.");
      setState("complete");
      setMessage("Order created from your reviewed fields.");
      onCreated();
    } catch (error) {
      setState("review");
      setMessage(error instanceof Error ? error.message : "Order creation failed.");
    }
  }

  function update<K extends keyof Reviewed>(key: K, value: Reviewed[K]) {
    setReviewed((current) => ({ ...current, [key]: value }));
  }
  const phoneValid = !newCustomerPhone.trim() || /^\+?[0-9][0-9 -]{6,20}$/.test(newCustomerPhone.trim());
  const ready = reviewed.orderNo.trim() && reviewed.branchId &&
    (customerMode === "EXISTING" ? reviewed.customerId : newCustomerName.trim() && newCustomerAddress.trim()) &&
    reviewed.problemDescription.trim() && reviewed.serviceType.trim() && phoneValid;

  return <Card className="workspace-panel" title="Create from document" aria-label="Document to order intake">
    <p className="product-muted">Extract an editable draft from plain text (up to 2 MB) or a text-native PDF (up to 5 MB and 12 pages). No order is created until you review the required fields and confirm.</p>
    <div className="workspace-fields">
      <label className="workspace-field">Source file
        <input type="file" accept="text/plain,application/pdf" disabled={state === "extracting" || state === "confirming"} onChange={(event) => {
          requestVersion.current += 1;
          setFile(event.target.files?.[0]); setDraft(undefined); setState("idle"); setMessage("");
        }} />
      </label>
      <Button disabled={!file || state === "extracting" || state === "confirming"} loading={state === "extracting"}
        onClick={() => void extract()}>Extract draft</Button>
      {message && <Alert type={state === "complete" ? "success" : "error"} showIcon message={message} />}
      {draft && <div className="workspace-fields">
        {optionsError && <Alert type="error" showIcon message="Branch and customer choices could not be loaded. Refresh this page before confirming." />}
        <Alert type="info" showIcon message="Review every required field before creating the order"
          description="Extraction is a suggestion. Select existing records from this workspace and edit the order details below." />
        <Descriptions bordered size="small" column={1} title="Extracted reference" items={[
          { key: "customer", label: "Customer name", children: fieldText(draft.customerName) || "Not found" },
          { key: "amount", label: "Amount", children: fieldText(draft.amount) || "Not found" },
          { key: "date", label: "Date", children: fieldText(draft.date) || "Not found" },
        ]} />
        {[draft.customerName, draft.amount, draft.date, draft.serviceType, draft.serviceDetails]
          .map(issueText).filter(Boolean).map((issue, index) =>
            <Alert key={index} type="warning" showIcon message={issue} />)}
        <p className="product-muted">Amount and date are shown as source reference; the current order record does not store them. Source SHA-256: <code className="workspace-code">{sourceSha256}</code></p>
        <div className="workspace-fields">
          <label className="workspace-field">Order number
            <Input value={reviewed.orderNo} maxLength={80} onChange={(event) => update("orderNo", event.target.value)} />
          </label>
          <label className="workspace-field">Existing branch
            <Select aria-label="Existing branch" placeholder="Choose a branch" value={reviewed.branchId || undefined}
              onChange={(value) => update("branchId", value)} options={options.branches.map((option) => ({ value: option.id, label: `${option.code} · ${option.name}` }))} />
          </label>
          <label className="workspace-field">Customer
            <Select aria-label="Customer mode" value={customerMode} onChange={setCustomerMode} options={[
              { value: "EXISTING", label: "Use an existing customer" },
              { value: "NEW", label: "Create a new customer with the order" },
            ]} />
          </label>
          {customerMode === "EXISTING" ? <label className="workspace-field">Existing customer
            <Select aria-label="Existing customer" placeholder="Choose a customer" value={reviewed.customerId || undefined}
              onChange={(value) => update("customerId", value)} options={options.customers.map((option) => ({ value: option.id, label: `${option.name} · ${option.address}` }))} />
          </label> : <div className="workspace-fields">
            <Alert type="info" showIcon message="The new customer and order are created together only after confirmation." />
            <label className="workspace-field">Customer name
              <Input value={newCustomerName} maxLength={160} onChange={(event) => setNewCustomerName(event.target.value)} />
            </label>
            <label className="workspace-field">Customer phone (optional)
              <Input value={newCustomerPhone} maxLength={22} onChange={(event) => setNewCustomerPhone(event.target.value)} />
            </label>
            {!phoneValid && <Alert type="warning" showIcon message="Enter a phone number such as +60123456789, or leave it blank." />}
            <label className="workspace-field">Customer address
              <Input.TextArea rows={2} value={newCustomerAddress} maxLength={800} onChange={(event) => setNewCustomerAddress(event.target.value)} />
            </label>
          </div>}
          {options.branches.length === 0 && <Alert type="warning" showIcon message="No branch choices are available." />}
          {customerMode === "EXISTING" && options.customers.length === 0 &&
            <Alert type="info" showIcon message="No existing customers are available. Choose new customer to continue." />}
          <label className="workspace-field">Problem description
            <Input.TextArea rows={4} value={reviewed.problemDescription} maxLength={4000}
              onChange={(event) => update("problemDescription", event.target.value)} />
          </label>
          <label className="workspace-field">Service type
            <Input value={reviewed.serviceType} maxLength={120}
              onChange={(event) => update("serviceType", event.target.value)} />
          </label>
        </div>
        <Space wrap><Tag color="blue">Draft only</Tag><Button type="primary" danger disabled={!ready || optionsError || state === "confirming" || state === "complete"}
          loading={state === "confirming"} onClick={() => void confirm()}>Confirm and create this order</Button></Space>
      </div>}
    </div>
  </Card>;
}
