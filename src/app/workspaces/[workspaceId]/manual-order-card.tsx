"use client";

import { Alert, Button, Card, Input, Select } from "antd";
import { useCallback, useEffect, useId, useRef, useState } from "react";

type Option = { id: string; name: string; code?: string };
type Options = { generation: number; branches: Option[]; customers: Option[] };

export function ManualOrderCard({ workspaceId, isGuest, onCreated, onBusyChange }: {
  workspaceId: string; isGuest: boolean; onCreated: () => void; onBusyChange?: (busy: boolean) => void;
}) {
  const base = `/api/workspaces/${encodeURIComponent(workspaceId)}`;
  const prefix = useId();
  const [options, setOptions] = useState<Options | null>(null);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [optionsError, setOptionsError] = useState("");
  const [branchId, setBranchId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [customerMode, setCustomerMode] = useState<"EXISTING" | "NEW">("EXISTING");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [orderNo, setOrderNo] = useState("");
  const [serviceType, setServiceType] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  const [message, setMessage] = useState("");
  const [succeeded, setSucceeded] = useState(false);
  const contextVersion = useRef(0);
  const submitting = useRef(false);
  const optionsController = useRef<AbortController | null>(null);

  const loadOptions = useCallback(async () => {
    optionsController.current?.abort();
    const controller = new AbortController();
    optionsController.current = controller;
    setLoadingOptions(true); setOptionsError(""); setOptions(null);
    try {
      const response = await fetch(`${base}/order-intake/options`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error();
      const data = await response.json() as Options;
      if (controller.signal.aborted) return;
      if (!Number.isSafeInteger(data.generation) || data.generation < 1 ||
          !Array.isArray(data.branches) || !Array.isArray(data.customers)) throw new Error();
      setOptions(data);
      setBranchId((current) => data.branches.some((item) => item.id === current) ? current : "");
      setCustomerId((current) => data.customers.some((item) => item.id === current) ? current : "");
      if (!data.customers.length) setCustomerMode("NEW");
    } catch {
      if (!controller.signal.aborted) setOptionsError("Order options are unavailable. Retry to load the current branch and customer choices.");
    } finally {
      if (optionsController.current === controller) { optionsController.current = null; setLoadingOptions(false); }
    }
  }, [base]);

  useEffect(() => {
    contextVersion.current += 1;
    submitting.current = false;
    setBusy(false); setMessage(""); setSucceeded(false);
    setBranchId(""); setCustomerId(""); setCustomerMode("EXISTING");
    setCustomerName(""); setCustomerPhone(""); setCustomerAddress("");
    setOrderNo(""); setServiceType(""); setProblem("");
    void loadOptions();
    return () => { contextVersion.current += 1; optionsController.current?.abort(); };
  }, [loadOptions]);

  const phoneValid = !customerPhone.trim() || /^\+?[0-9][0-9 -]{6,20}$/.test(customerPhone.trim());
  const customerReady = customerMode === "EXISTING" ? Boolean(customerId) :
    Boolean(customerName.trim() && customerAddress.trim() && phoneValid);
  const ready = Boolean(options && branchId && customerReady && orderNo.trim() && serviceType.trim() && problem.trim());
  const fieldsDisabled = busy || loadingOptions;

  async function create() {
    if (!options || !ready || submitting.current) return;
    submitting.current = true;
    const version = contextVersion.current;
    setBusy(true); setMessage(""); setSucceeded(false);
    try {
      const common = { expectedGeneration: options.generation, branchId,
        orderNo: orderNo.trim(), serviceType: serviceType.trim(), problemDescription: problem.trim() };
      const newCustomer = customerMode === "NEW";
      const response = await fetch(newCustomer ? `${base}/order-intake/confirm` : `${base}/orders`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newCustomer ? { ...common, confirmed: true,
          customer: { mode: "NEW", name: customerName.trim(), phone: customerPhone.trim() || null, address: customerAddress.trim() } }
          : { ...common, customerId }),
      });
      if (version !== contextVersion.current) return;
      if (!response.ok) throw new Error(response.status === 409
        ? "The order or workspace data changed. Retry the options, review the details, and submit again."
        : "Order could not be created. Check the details and try again.");
      setOrderNo(""); setServiceType(""); setProblem("");
      setCustomerName(""); setCustomerPhone(""); setCustomerAddress("");
      setSucceeded(true); setMessage("Order created in this workspace.");
      onCreated();
      if (newCustomer) await loadOptions();
    } catch (error) {
      if (version === contextVersion.current) setMessage(error instanceof Error ? error.message : "Order could not be created.");
    } finally {
      if (version === contextVersion.current) { submitting.current = false; setBusy(false); }
    }
  }

  return <Card className="workspace-panel" title="Create an order manually">
    {isGuest && <p className="product-muted">Use fictional details in the shared Demo.</p>}
    <div className="workspace-fields">
      {loadingOptions && <Alert type="info" showIcon message="Loading branch and customer choices…" />}
      {optionsError && <Alert type="error" showIcon message={optionsError} />}
      {(optionsError || message && !succeeded) && <Button disabled={busy || loadingOptions} onClick={() => void loadOptions()}>Retry options</Button>}
      {options && !options.branches.length && <Alert type="warning" showIcon message="No active branch is available. Add an active workspace branch before creating an order." />}
      <label className="workspace-field" htmlFor={`${prefix}-branch`}>Branch
        <Select id={`${prefix}-branch`} aria-label="Branch" value={branchId || undefined} disabled={fieldsDisabled}
          onChange={setBranchId} options={options?.branches.map((item) => ({ value: item.id, label: `${item.code ?? ""} ${item.name}`.trim() })) ?? []} />
      </label>
      <label className="workspace-field" htmlFor={`${prefix}-mode`}>Customer
        <Select id={`${prefix}-mode`} aria-label="Customer mode" value={customerMode} disabled={fieldsDisabled} onChange={setCustomerMode}
          options={[{ value: "EXISTING", label: "Use an existing customer" }, { value: "NEW", label: "Create a new customer with the order" }]} />
      </label>
      {customerMode === "EXISTING" ? <label className="workspace-field" htmlFor={`${prefix}-customer`}>Existing customer
        <Select id={`${prefix}-customer`} aria-label="Existing customer" value={customerId || undefined} disabled={fieldsDisabled}
          onChange={setCustomerId} options={options?.customers.map((item) => ({ value: item.id, label: item.name })) ?? []} />
      </label> : <>
        <Alert type="info" showIcon message="Review the new customer details. The customer and order are created together when you submit." />
        <label className="workspace-field" htmlFor={`${prefix}-name`}>Customer name
          <Input id={`${prefix}-name`} maxLength={160} value={customerName} disabled={fieldsDisabled} onChange={(event) => setCustomerName(event.target.value)} />
        </label>
        <label className="workspace-field" htmlFor={`${prefix}-phone`}>Customer phone (optional)
          <Input id={`${prefix}-phone`} maxLength={22} value={customerPhone} disabled={fieldsDisabled} onChange={(event) => setCustomerPhone(event.target.value)} />
        </label>
        {!phoneValid && <Alert type="warning" showIcon message="Enter a phone number such as +60123456789, or leave it blank." />}
        <label className="workspace-field" htmlFor={`${prefix}-address`}>Customer address
          <Input.TextArea id={`${prefix}-address`} rows={2} maxLength={800} value={customerAddress} disabled={fieldsDisabled} onChange={(event) => setCustomerAddress(event.target.value)} />
        </label>
      </>}
      {options && !options.customers.length && <Alert type="info" showIcon message="No existing customers yet. Create a new customer with this order to continue." />}
      <label className="workspace-field" htmlFor={`${prefix}-order`}>Order number
        <Input id={`${prefix}-order`} maxLength={80} value={orderNo} disabled={fieldsDisabled} onChange={(event) => setOrderNo(event.target.value)} />
      </label>
      <label className="workspace-field" htmlFor={`${prefix}-service`}>Service type
        <Input id={`${prefix}-service`} maxLength={120} value={serviceType} disabled={fieldsDisabled} onChange={(event) => setServiceType(event.target.value)} />
      </label>
      <label className="workspace-field" htmlFor={`${prefix}-problem`}>Problem description
        <Input.TextArea id={`${prefix}-problem`} rows={3} maxLength={4000} value={problem} disabled={fieldsDisabled} onChange={(event) => setProblem(event.target.value)} />
      </label>
      <Button type="primary" disabled={!ready || busy || loadingOptions} loading={busy} onClick={() => void create()}>Create order</Button>
      {message && <Alert type={succeeded ? "success" : "error"} showIcon message={message} />}
    </div>
  </Card>;
}
