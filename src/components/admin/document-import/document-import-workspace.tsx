"use client";

import {
  CheckCircleOutlined,
  CloudUploadOutlined,
  FileSearchOutlined,
  InboxOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Divider,
  Form,
  Input,
  Modal,
  Result,
  Select,
  Skeleton,
  Space,
  Steps,
  Tag,
  Typography,
  Upload,
} from "antd";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PriceInput } from "@/components/shared/price-input";
import type {
  ConfirmDocumentImportInput,
  DocumentImportDetailResponse,
  DocumentImportRecord,
  DocumentImportReservationResponse,
  ExtractionConfidence,
  ValidatedExtractionField,
} from "@/domain/document-understanding/contracts";
import {
  DOCUMENT_IMPORT_POLICY,
  reserveDocumentImportSchema,
} from "@/domain/document-understanding/contracts";
import {
  documentImportApi,
  DocumentImportApiError,
} from "./api";

type ReviewValues = ConfirmDocumentImportInput["reviewed"];
type ConfirmedOutcome = NonNullable<DocumentImportRecord["confirmation"]>;
type DocumentImportResumeState = Readonly<{
  id: string;
  sourceRequestKey?: string;
  extractRequestKey?: string;
  originalFilename?: string;
  mimeType?: string;
  sizeBytes?: number;
}>;

const DOCUMENT_IMPORT_RESUME_KEY = "sejukops.document-import.active";

function readResumeState(): DocumentImportResumeState | undefined {
  try {
    const raw = sessionStorage.getItem(DOCUMENT_IMPORT_RESUME_KEY);
    if (!raw) return undefined;
    const value = JSON.parse(raw) as Partial<DocumentImportResumeState>;
    return typeof value.id === "string" ? value as DocumentImportResumeState : undefined;
  } catch {
    return undefined;
  }
}

const confidenceMeta: Readonly<Record<ExtractionConfidence, {
  color: string;
  label: string;
  help: string;
}>> = {
  high: { color: "green", label: "High", help: "Clear extracted value that passed validation." },
  medium: { color: "gold", label: "Medium", help: "Plausible value; verify it against the source." },
  low: { color: "volcano", label: "Low", help: "Uncertain value; explicit review is required." },
  missing: { color: "red", label: "Missing", help: "No safe value was found. Enter it before continuing." },
};

function bytes(value: number): string {
  return value < 1024 * 1024
    ? `${(value / 1024).toFixed(1)} KB`
    : `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function ConfidenceLabel({
  label,
  field,
}: {
  label: string;
  field: ValidatedExtractionField<unknown>;
}) {
  const meta = confidenceMeta[field.confidence];
  return <span className="document-field-label"><span>{label}</span><Tag color={meta.color}>{meta.label}</Tag></span>;
}

function ConfidenceHelp({ field }: { field: ValidatedExtractionField<unknown> }) {
  const meta = confidenceMeta[field.confidence];
  return <div className={`document-confidence-help confidence-${field.confidence}`}><span>{meta.help}</span>{field.issues.map((issue) => <span key={issue}>{issue}</span>)}</div>;
}

function failureGuidance(record: DocumentImportRecord) {
  const failure = record.failure;
  if (!failure) return undefined;
  if (failure.code === "AI_CAPABILITY_MISMATCH") {
    return "This source needs a compatible document model. Image scans require vision; PDFs must contain readable embedded text in the current implementation.";
  }
  if (failure.code === "AI_NOT_CONFIGURED") {
    return "Document Understanding has no compatible configured route yet.";
  }
  if (failure.code === "AI_AUTH_FAILED") {
    return "The configured provider rejected its credential. Verify it with Test Connection in AI Settings.";
  }
  return failure.message;
}

export function DocumentImportWorkspace() {
  const [form] = Form.useForm<ReviewValues>();
  const [file, setFile] = useState<File>();
  const [reservation, setReservation] = useState<DocumentImportReservationResponse>();
  const [record, setRecord] = useState<DocumentImportRecord>();
  const [options, setOptions] = useState<DocumentImportDetailResponse["options"]>();
  const [uploading, setUploading] = useState(false);
  const [storageUploaded, setStorageUploaded] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const [errorScope, setErrorScope] = useState<"UPLOAD" | "EXTRACT">();
  const [preview, setPreview] = useState<ReviewValues>();
  const [confirmError, setConfirmError] = useState<string>();
  const [result, setResult] = useState<ConfirmedOutcome>();
  const [resumeState, setResumeState] = useState<DocumentImportResumeState>();
  const [resuming, setResuming] = useState(true);
  const [pollingExtraction, setPollingExtraction] = useState(false);
  const [pollingStopped, setPollingStopped] = useState(false);
  const uploadKey = useRef<string>();
  const extractKey = useRef<string>();
  const confirmKey = useRef<string>();
  const selectedBranchId = Form.useWatch("branchId", form);

  const remember = useCallback((next: Partial<DocumentImportResumeState> & { id: string }) => {
    const merged: Record<string, unknown> = { ...(readResumeState() ?? {}), ...next };
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined) delete merged[key];
    }
    const saved = merged as DocumentImportResumeState;
    sessionStorage.setItem(DOCUMENT_IMPORT_RESUME_KEY, JSON.stringify(saved));
    setResumeState(saved);
  }, []);

  useEffect(() => {
    const saved = readResumeState();
    setResumeState(saved);
    if (!saved) {
      setResuming(false);
      return;
    }
    uploadKey.current = saved.sourceRequestKey;
    extractKey.current = saved.extractRequestKey;
    void documentImportApi.detail(saved.id).then((detail) => {
      setRecord(detail.documentImport);
      setOptions(detail.options);
      setStorageUploaded(detail.documentImport.sourceStatus === "UPLOADED");
      if (detail.documentImport.confirmation) {
        setResult(detail.documentImport.confirmation);
        sessionStorage.removeItem(DOCUMENT_IMPORT_RESUME_KEY);
        setResumeState(undefined);
      }
    }).catch((cause) => {
      setError(cause instanceof Error ? cause.message : "The saved document import could not be resumed.");
      setErrorScope("UPLOAD");
    }).finally(() => setResuming(false));
  }, []);

  useEffect(() => {
    const draft = record?.draft;
    if (!draft) return;
    form.setFieldsValue({
      customerName: draft.customerName.value ?? undefined,
      serviceType: draft.serviceType.value ?? undefined,
      serviceDetails: draft.serviceDetails.value ?? undefined,
      amount: draft.amount.value ?? undefined,
      date: draft.date.value ?? undefined,
    });
  }, [form, record?.draft]);

  const extractingRecordId = record?.extractionStatus === "EXTRACTING"
    ? record.id
    : undefined;

  useEffect(() => {
    if (!extractingRecordId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    setPollingExtraction(true);
    setPollingStopped(false);

    const poll = async () => {
      try {
        const detail = await documentImportApi.detail(extractingRecordId);
        if (cancelled) return;
        setRecord(detail.documentImport);
        setOptions(detail.options);
        if (detail.documentImport.extractionStatus !== "EXTRACTING") {
          extractKey.current = undefined;
          remember({ id: extractingRecordId, extractRequestKey: undefined });
          setPollingExtraction(false);
          return;
        }
      } catch {
        // Bounded polling tolerates transient reads; explicit Refresh remains available.
      }
      attempts += 1;
      if (attempts >= 6) {
        setPollingExtraction(false);
        setPollingStopped(true);
        return;
      }
      timer = setTimeout(() => void poll(), 2_000);
    };

    timer = setTimeout(() => void poll(), 1_000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [extractingRecordId, remember]);

  const filteredTechnicians = useMemo(
    () => options?.technicians.filter((technician) => technician.branchId === selectedBranchId) ?? [],
    [options?.technicians, selectedBranchId],
  );

  const reset = () => {
    setFile(undefined);
    setReservation(undefined);
    setRecord(undefined);
    setOptions(undefined);
    setStorageUploaded(false);
    setError(undefined);
    setErrorScope(undefined);
    setPreview(undefined);
    setConfirmError(undefined);
    setResult(undefined);
    setResumeState(undefined);
    setResuming(false);
    setPollingExtraction(false);
    setPollingStopped(false);
    sessionStorage.removeItem(DOCUMENT_IMPORT_RESUME_KEY);
    uploadKey.current = undefined;
    extractKey.current = undefined;
    confirmKey.current = undefined;
    form.resetFields();
  };

  const selectFile = (next: File) => {
    const input = {
      originalFilename: next.name,
      mimeType: next.type,
      sizeBytes: next.size,
      requestKey: crypto.randomUUID(),
    };
    const validation = reserveDocumentImportSchema.safeParse(input);
    if (!validation.success) {
      setFile(undefined);
      setError(validation.error.issues[0]?.message ?? "Choose a supported source document.");
      setErrorScope("UPLOAD");
      return Upload.LIST_IGNORE;
    }
    if (record?.sourceStatus === "RESERVED" && resumeState?.sourceRequestKey) {
      const matchesReservation = next.name === resumeState.originalFilename &&
        next.type === resumeState.mimeType &&
        next.size === resumeState.sizeBytes;
      if (!matchesReservation) {
        setError("Choose the same source file to resume this reserved upload, or start another import.");
        setErrorScope("UPLOAD");
        return Upload.LIST_IGNORE;
      }
      uploadKey.current = resumeState.sourceRequestKey;
      setFile(next);
      setError(undefined);
      setErrorScope(undefined);
      return Upload.LIST_IGNORE;
    }
    reset();
    uploadKey.current = input.requestKey;
    setFile(next);
    return Upload.LIST_IGNORE;
  };

  const loadDetail = async (id: string) => {
    const detail = await documentImportApi.detail(id);
    setRecord(detail.documentImport);
    setOptions(detail.options);
    remember({ id });
    return detail;
  };

  const upload = async () => {
    if (!file) return;
    setUploading(true);
    setError(undefined);
    setErrorScope(undefined);
    try {
      const stableUploadKey = uploadKey.current ??= crypto.randomUUID();
      const active = reservation ?? await documentImportApi.reserve({
        originalFilename: file.name,
        mimeType: file.type as typeof DOCUMENT_IMPORT_POLICY.allowedMimeTypes[number],
        sizeBytes: file.size,
        requestKey: stableUploadKey,
      });
      setReservation(active);
      setRecord(active.documentImport);
      remember({
        id: active.documentImport.id,
        sourceRequestKey: stableUploadKey,
        originalFilename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      });
      if (!storageUploaded && active.documentImport.sourceStatus !== "UPLOADED") {
        await documentImportApi.uploadSource(active, file);
        setStorageUploaded(true);
      }
      if (active.documentImport.sourceStatus !== "UPLOADED") {
        const confirmed = await documentImportApi.confirmSource(active.documentImport.id, {
          requestKey: stableUploadKey,
        });
        setRecord(confirmed.documentImport);
      }
      await loadDetail(active.documentImport.id);
      uploadKey.current = undefined;
      remember({ id: active.documentImport.id, sourceRequestKey: undefined });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The source could not be uploaded. Retry safely; no order was created.");
      setErrorScope("UPLOAD");
    } finally {
      setUploading(false);
    }
  };

  const extract = async () => {
    if (!record || record.sourceStatus !== "UPLOADED") return;
    setExtracting(true);
    setError(undefined);
    setErrorScope(undefined);
    try {
      const stableExtractKey = extractKey.current ??= crypto.randomUUID();
      remember({ id: record.id, extractRequestKey: stableExtractKey });
      const response = await documentImportApi.extract(record.id, {
        requestKey: stableExtractKey,
      });
      setRecord(response.documentImport);
      if (["EXTRACTED", "FAILED"].includes(response.documentImport.extractionStatus)) {
        extractKey.current = undefined;
        remember({ id: record.id, extractRequestKey: undefined });
      }
      await loadDetail(record.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Extraction could not start. The uploaded source remains available.");
      setErrorScope("EXTRACT");
    } finally {
      setExtracting(false);
    }
  };

  const refreshExtraction = async () => {
    if (!record) return;
    setError(undefined);
    setErrorScope(undefined);
    try {
      await loadDetail(record.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The extraction state could not be refreshed.");
      setErrorScope("EXTRACT");
    }
  };

  const openPreview = (values: ReviewValues) => {
    setConfirmError(undefined);
    setPreview(values);
  };

  const confirm = async () => {
    if (!record || !preview) return;
    setConfirming(true);
    setConfirmError(undefined);
    try {
      const response = await documentImportApi.confirm(record.id, {
        action: "CREATE",
        requestKey: confirmKey.current ??= crypto.randomUUID(),
        reviewed: preview,
      });
      confirmKey.current = undefined;
      setResult(response.documentImport.confirmation ?? {
        orderId: response.order.id,
        orderNo: response.order.orderNo,
        status: response.order.status,
        customerReused: response.customerReused,
      });
      setRecord(response.documentImport);
      setPreview(undefined);
      sessionStorage.removeItem(DOCUMENT_IMPORT_RESUME_KEY);
      setResumeState(undefined);
    } catch (cause) {
      try {
        const latest = await documentImportApi.detail(record.id);
        if (latest.documentImport.confirmation) {
          confirmKey.current = undefined;
          setRecord(latest.documentImport);
          setOptions(latest.options);
          setResult(latest.documentImport.confirmation);
          setPreview(undefined);
          sessionStorage.removeItem(DOCUMENT_IMPORT_RESUME_KEY);
          setResumeState(undefined);
          return;
        }
      } catch {
        // Preserve the original confirmation key after an ambiguous response.
      }
      if (cause instanceof DocumentImportApiError && cause.fieldErrors) {
        form.setFields(Object.entries(cause.fieldErrors).flatMap(([name, errors]) => errors?.length ? [{ name: name.replace(/^reviewed\./, "") as keyof ReviewValues, errors: [...errors] }] : []));
      }
      setConfirmError(cause instanceof Error ? cause.message : "The reviewed draft could not be confirmed. No order was created.");
    } finally {
      setConfirming(false);
    }
  };

  if (resuming) {
    return <Card className="document-success-card"><Skeleton active paragraph={{ rows: 6 }} /></Card>;
  }

  if (result) {
    return <Card className="document-success-card"><Result status="success" icon={<CheckCircleOutlined />} title="Reviewed document created an order" subTitle={`${result.orderNo} is ${result.status.replaceAll("_", " ")}.${result.customerReused ? " The matching customer was reused." : " A new customer record was created."}`} extra={[<Link key="order" href="/admin"><Button type="primary">Open orders</Button></Link>, <Button key="again" onClick={reset}>Import another document</Button>]} /></Card>;
  }

  const step = record?.extractionStatus === "CONFIRMED" ? 3 : record?.extractionStatus === "EXTRACTED" ? 2 : record?.sourceStatus === "UPLOADED" ? 1 : 0;
  const draft = record?.draft;
  return <Space direction="vertical" size="large" className="page-stack admin-workspace document-import-workspace">
    <section className="page-heading"><div><Typography.Title level={2}>Document import</Typography.Title><Typography.Paragraph type="secondary">Extract a reviewable order draft from a text document, PDF, or image. Nothing is written to operations until an Admin reviews every required field and confirms the preview.</Typography.Paragraph></div>{record ? <Button onClick={reset}>Start another import</Button> : null}</section>
    <Alert type="info" showIcon icon={<SafetyCertificateOutlined />} message="Human confirmation is required" description="AI extraction creates an editable draft only. Missing or uncertain values stay visible, and provider failure never creates an order." />
    <Card><Steps responsive current={step} items={[{ title: "Upload source" }, { title: "Extract draft" }, { title: "Review & preview" }, { title: "Order created" }]} /></Card>

    {!record || record.sourceStatus === "RESERVED" ? <Card title={record ? "Resume reserved source upload" : "1. Upload source document"} className="document-upload-card"><Upload.Dragger accept={DOCUMENT_IMPORT_POLICY.allowedMimeTypes.join(",")} multiple={false} maxCount={1} showUploadList={false} beforeUpload={selectFile}><p className="ant-upload-drag-icon"><InboxOutlined /></p><p className="ant-upload-text">{record ? "Select the same source file to continue" : "Choose or drop one service document"}</p><p className="ant-upload-hint">TXT up to 2 MB · PDF up to 15 MB / 20 pages · JPG, PNG or WebP up to 12 MB</p></Upload.Dragger>{file ? <div className="document-selected-file"><div><Typography.Text strong>{file.name}</Typography.Text><div><Typography.Text type="secondary">{file.type} · {bytes(file.size)}</Typography.Text></div></div><Button type="primary" icon={<CloudUploadOutlined />} loading={uploading} onClick={() => void upload()}>Upload securely</Button></div> : null}{error && errorScope === "UPLOAD" ? <Alert className="document-inline-alert" type="error" showIcon message="Source upload paused" description={error} action={file ? <Button size="small" icon={<ReloadOutlined />} loading={uploading} onClick={() => void upload()}>Retry</Button> : undefined} /> : null}</Card> : null}

    {record?.sourceStatus === "UPLOADED" ? <Card title="Source document" extra={record.sourceUrl ? <a href={record.sourceUrl} target="_blank" rel="noreferrer">View signed source</a> : null}><Descriptions size="small" column={{ xs: 1, sm: 2 }} items={[{ key: "name", label: "Filename", children: record.originalFilename }, { key: "type", label: "Type", children: record.mimeType }, { key: "size", label: "Size", children: bytes(record.sizeBytes) }, { key: "state", label: "Source state", children: <Tag color="green">{record.sourceStatus}</Tag> }]} />{error ? <Alert className="document-inline-alert" type="error" showIcon message="Document workflow paused" description={error} action={<Button size="small" icon={<ReloadOutlined />} loading={extracting} onClick={() => void refreshExtraction()}>Refresh state</Button>} /> : null}</Card> : null}

    {record?.sourceStatus === "UPLOADED" && !draft ? <Card title="2. Extract a structured draft" className="document-extract-card">{extracting || record.extractionStatus === "EXTRACTING" ? <Space direction="vertical" size="middle" className="full-width"><Skeleton active paragraph={{ rows: 4 }} /><Alert type="info" showIcon message="Extraction is in progress" description={pollingExtraction ? "Checking the durable extraction state for a validated result…" : "Automatic status checks paused. Refresh the state, or recover the same request after a stale lease."} action={<Space wrap><Button size="small" icon={<ReloadOutlined />} onClick={() => void refreshExtraction()}>Refresh status</Button>{pollingStopped ? <Button size="small" loading={extracting} onClick={() => void extract()}>Recover extraction</Button> : null}</Space>} /></Space> : record.extractionStatus === "FAILED" && record.failure ? <Space direction="vertical" size="middle" className="full-width"><Alert type="warning" showIcon message="Extraction did not create an order" description={failureGuidance(record)} /><Space wrap><Tag>{record.failure.code}</Tag><Typography.Text type="secondary">The source remains securely stored. Attempt {record.extractionAttemptCount}.</Typography.Text></Space><Space wrap>{record.failure.recoveryAction === "CONFIGURE_PROVIDER" ? <Link href="/admin/ai-settings"><Button type="primary">Open AI settings</Button></Link> : null}{record.failure.recoveryAction === "UPLOAD_READABLE_SOURCE" || record.failure.recoveryAction === "REUPLOAD_SOURCE" ? <Button onClick={reset}>Choose another source</Button> : null}{record.failure.retryable || record.failure.recoveryAction === "RETRY_EXTRACTION" ? <Button icon={<ReloadOutlined />} loading={extracting} onClick={() => void extract()}>Retry extraction</Button> : null}</Space></Space> : <div className="document-extract-callout"><FileSearchOutlined /><div><Typography.Title level={4}>Ready to extract</Typography.Title><Typography.Paragraph type="secondary">Text documents and PDFs require readable embedded text. Image scans require a vision-capable route; export scanned PDFs without readable text as JPG, PNG, or WebP first.</Typography.Paragraph></div><Button type="primary" size="large" icon={<FileSearchOutlined />} loading={extracting} onClick={() => void extract()}>Extract draft</Button></div>}</Card> : null}

    {draft && !options ? <Card title="Loading review options"><Skeleton active paragraph={{ rows: 5 }} /></Card> : null}

    {draft && options ? <Card title="3. Review every field" extra={<Tag color="blue">Editable AI draft</Tag>}><Alert className="form-note" type="warning" showIcon message="Confidence is guidance, not confirmation" description="Verify the source, correct ambiguous values, and supply the customer/contact/assignment fields required for a real order." /><Form form={form} layout="vertical" requiredMark="optional" onFinish={openPreview}><div className="form-grid two-up"><Form.Item label={<ConfidenceLabel label="Customer name" field={draft.customerName} />} name="customerName" extra={<ConfidenceHelp field={draft.customerName} />} rules={[{ required: true, message: "Enter the customer name." }]}><Input autoComplete="name" /></Form.Item><Form.Item label="Customer phone" name="customerPhone" extra="Required operational field · not extracted" rules={[{ required: true, message: "Enter the customer phone." }, { pattern: /^\+?[0-9][0-9 -]{6,20}$/, message: "Enter a valid customer phone number." }]}><Input autoComplete="tel" /></Form.Item></div><Form.Item label="Customer address" name="customerAddress" extra="Required operational field · not extracted" rules={[{ required: true, message: "Enter the service address." }]}><Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} /></Form.Item><div className="form-grid two-up"><Form.Item label={<ConfidenceLabel label="Service type" field={draft.serviceType} />} name="serviceType" extra={<ConfidenceHelp field={draft.serviceType} />} rules={[{ required: true, message: "Enter the service type." }]}><Input /></Form.Item><Form.Item label={<ConfidenceLabel label="Quoted amount (RM)" field={draft.amount} />} name="amount" extra={<ConfidenceHelp field={draft.amount} />} rules={[{ required: true, message: "Enter the quoted amount." }]}><PriceInput /></Form.Item></div><Form.Item label={<ConfidenceLabel label="Service details" field={draft.serviceDetails} />} name="serviceDetails" extra={<ConfidenceHelp field={draft.serviceDetails} />} rules={[{ required: true, message: "Enter the service details." }]}><Input.TextArea autoSize={{ minRows: 4, maxRows: 8 }} /></Form.Item><div className="form-grid three-up"><Form.Item label={<ConfidenceLabel label="Service date" field={draft.date} />} name="date" extra={<ConfidenceHelp field={draft.date} />} rules={[{ required: true, message: "Enter the service date." }]}><Input type="date" /></Form.Item><Form.Item label="Branch" name="branchId" rules={[{ required: true, message: "Select a branch." }]}><Select placeholder="Select branch" options={options.branches.map((branch) => ({ value: branch.id, label: `${branch.code} · ${branch.name}` }))} onChange={(branchId) => { const technicianId = form.getFieldValue("technicianId"); const technician = options.technicians.find((item) => item.id === technicianId); if (technician && technician.branchId !== branchId) form.setFieldValue("technicianId", undefined); }} /></Form.Item><Form.Item label="Assigned technician" name="technicianId"><Select allowClear disabled={!selectedBranchId} placeholder={selectedBranchId ? "Assign now or leave NEW" : "Select branch first"} options={filteredTechnicians.map((technician) => ({ value: technician.id, label: technician.name }))} /></Form.Item></div><Form.Item label="Internal notes" name="adminNotes"><Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} maxLength={4000} showCount /></Form.Item><Divider /><div className="document-review-actions"><Typography.Text type="secondary">Next, preview the exact reviewed values. Previewing does not write an order.</Typography.Text><Button type="primary" size="large" htmlType="submit">Preview reviewed order</Button></div></Form></Card> : null}

    <Modal title="Confirm reviewed order" open={Boolean(preview)} onCancel={() => { if (!confirming) setPreview(undefined); }} width={720} closable={!confirming} maskClosable={!confirming} footer={<Space><Button disabled={confirming} onClick={() => setPreview(undefined)}>Back to edit</Button><Button type="primary" loading={confirming} onClick={() => void confirm()}>Confirm & create order</Button></Space>}>{preview ? <Space direction="vertical" size="middle" className="full-width"><Alert type="info" showIcon message="This is the only step that writes operational data" description="Confirm only after comparing these values with the uploaded source." />{confirmError ? <Alert type="error" showIcon message="Order was not created" description={confirmError} /> : null}<Descriptions bordered size="small" column={1} items={[{ key: "customer", label: "Customer", children: `${preview.customerName} · ${preview.customerPhone}` }, { key: "address", label: "Address", children: preview.customerAddress }, { key: "service", label: "Service", children: preview.serviceType }, { key: "details", label: "Service details", children: preview.serviceDetails }, { key: "amount", label: "Quoted amount", children: `RM ${preview.amount.toFixed(2)}` }, { key: "date", label: "Service date", children: preview.date }, { key: "branch", label: "Branch", children: options?.branches.find((branch) => branch.id === preview.branchId)?.name ?? preview.branchId }, { key: "technician", label: "Technician", children: options?.technicians.find((technician) => technician.id === preview.technicianId)?.name ?? "Unassigned" }, { key: "notes", label: "Internal notes", children: preview.adminNotes || "—" }]} /></Space> : null}</Modal>
  </Space>;
}
