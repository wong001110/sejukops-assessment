"use client";

import { AddOutline, CloseCircleOutline, FileOutline, PictureOutline, RedoOutline } from "antd-mobile-icons";
import { Button, Card, NoticeBar, Selector, Space, TextArea } from "antd-mobile";
import { useMemo, useRef, useState } from "react";
import { SERVICE_EVIDENCE_POLICY } from "@/domain/operations";
import type { TechnicianEvidenceItem } from "@/domain/technician-completion/contracts";
import { evidenceIdAfterUploadFailure } from "./job-api";

export type EvidenceStatus = "queued" | "uploading" | "success" | "error";
export type EvidenceItem = { localId: string; requestKey: string; file: File; status: EvidenceStatus; error?: string; remoteId?: string };
export type CompletionValues = { workDone: string; remarks?: string; extraCharges: number; paymentAmount?: number; paymentMethod?: "CASH" | "CARD" | "BANK_TRANSFER" | "EWALLET" | "OTHER" };

const paymentOptions = [["CASH", "Cash"], ["CARD", "Card"], ["BANK_TRANSFER", "Bank transfer"], ["EWALLET", "E-wallet"], ["OTHER", "Other"]] as const;
const activeServerStatuses = new Set<TechnicianEvidenceItem["status"]>(["RESERVED", "UPLOADED", "ATTACHED", "DELETING"]);
const moneyMaximum = 9_999_999_999.99;
const bytes = (value: number) => `${(value / (1024 * 1024)).toFixed(value >= 1024 * 1024 ? 1 : 0)} MB`;

function fileFailure(file: File, acceptedCount: number, acceptedBytes: number): string | undefined {
  const maximum = SERVICE_EVIDENCE_POLICY.mimeMaximumBytes[file.type as keyof typeof SERVICE_EVIDENCE_POLICY.mimeMaximumBytes];
  if (!maximum) return "This file type is not supported. Use a photo, MP4/video, or PDF.";
  if (acceptedCount >= SERVICE_EVIDENCE_POLICY.maximumFileCount) return "A service report can include at most 6 evidence files.";
  if (file.size > maximum) return `${file.name} is larger than the ${bytes(maximum)} limit for this file type.`;
  if (acceptedBytes + file.size > SERVICE_EVIDENCE_POLICY.maximumTotalBytes) return "These files exceed the 120 MB combined evidence limit.";
  return undefined;
}

function moneyFailure(value: number | null, label: string): string | undefined {
  if (value === null || !Number.isFinite(value)) return `${label} must be a valid amount.`;
  if (value < 0) return `${label} cannot be negative.`;
  if (value > moneyMaximum) return `${label} cannot exceed RM ${moneyMaximum.toFixed(2)}.`;
  if (Math.abs(value * 100 - Math.round(value * 100)) >= 1e-8) return `${label} can have no more than two decimal places.`;
  return undefined;
}

export function CompletionForm({ quotedPrice, initialEvidence, onUpload, onRemove, onComplete, onCancel, locked }: { quotedPrice: number; initialEvidence: TechnicianEvidenceItem[]; onUpload: (file: File, requestKey: string) => Promise<{ id: string }>; onRemove: (remoteId: string) => Promise<void>; onComplete: (values: CompletionValues, attachments: EvidenceItem[]) => Promise<void>; onCancel: () => void; locked: boolean }) {
  const [workDone, setWorkDone] = useState("");
  const [remarks, setRemarks] = useState("");
  const [extraCharges, setExtraCharges] = useState<number | null>(0);
  const [paymentAmount, setPaymentAmount] = useState<number | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<CompletionValues["paymentMethod"]>();
  const [files, setFiles] = useState<EvidenceItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [removingServer, setRemovingServer] = useState<Record<string, boolean>>({});
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const input = useRef<HTMLInputElement>(null);
  const validFiles = useMemo(() => files.filter((item) => item.status !== "error"), [files]);
  const serverEvidence = initialEvidence.filter((item) => item.status !== "DELETED");
  const activeServerEvidence = serverEvidence.filter((item) => activeServerStatuses.has(item.status));
  const evidenceCount = activeServerEvidence.length + validFiles.length;
  const finalEstimate = quotedPrice + (extraCharges ?? 0);

  const patchFile = (localId: string, patch: Partial<EvidenceItem>) => setFiles((items) => items.map((item) => item.localId === localId ? { ...item, ...patch } : item));
  const upload = async (item: EvidenceItem) => {
    patchFile(item.localId, { status: "uploading", error: undefined });
    try {
      const result = await onUpload(item.file, item.requestKey);
      patchFile(item.localId, { status: "success", remoteId: result.id });
    } catch (cause) {
      patchFile(item.localId, { status: "error", remoteId: evidenceIdAfterUploadFailure(cause, item.remoteId), error: cause instanceof Error ? cause.message : "Upload failed. Retry this file." });
    }
  };
  const addFiles = (selected: FileList | null) => {
    if (!selected) return;
    let acceptedCount = evidenceCount;
    let acceptedBytes = activeServerEvidence.reduce((sum, item) => sum + item.sizeBytes, 0) + validFiles.reduce((sum, item) => sum + item.file.size, 0);
    const next = Array.from(selected).map((file) => {
      const failure = fileFailure(file, acceptedCount, acceptedBytes);
      const item: EvidenceItem = { localId: crypto.randomUUID(), requestKey: crypto.randomUUID(), file, status: failure ? "error" : "queued", error: failure };
      if (!failure) { acceptedCount += 1; acceptedBytes += file.size; }
      return item;
    });
    setFiles((items) => [...items, ...next]);
    next.filter((item) => item.status === "queued").forEach((item) => void upload(item));
  };
  const remove = async (item: EvidenceItem) => {
    try {
      if (item.remoteId) await onRemove(item.remoteId);
      setFiles((items) => items.filter((candidate) => candidate.localId !== item.localId));
    } catch (cause) {
      patchFile(item.localId, { status: "error", error: cause instanceof Error ? cause.message : "Could not remove this evidence file." });
    }
  };
  const removeServerEvidence = async (item: TechnicianEvidenceItem) => {
    setRemovingServer((items) => ({ ...items, [item.id]: true }));
    setServerErrors((items) => { const next = { ...items }; delete next[item.id]; return next; });
    try {
      await onRemove(item.id);
    } catch (cause) {
      setServerErrors((items) => ({ ...items, [item.id]: cause instanceof Error ? cause.message : "Could not remove this evidence file. Try again." }));
    } finally {
      setRemovingServer((items) => ({ ...items, [item.id]: false }));
    }
  };
  const submit = async () => {
    if (!workDone.trim()) { setError("Describe the work completed before submitting."); return; }
    const extraChargesError = moneyFailure(extraCharges, "Extra charges");
    if (extraChargesError) { setError(extraChargesError); return; }
    if (quotedPrice + (extraCharges ?? 0) > moneyMaximum) { setError(`Final amount cannot exceed RM ${moneyMaximum.toFixed(2)}.`); return; }
    const paymentError = paymentAmount === null ? undefined : moneyFailure(paymentAmount, "Payment amount");
    if (paymentError) { setError(paymentError); return; }
    if (serverEvidence.some((item) => item.status === "RESERVED" || item.status === "DELETING")) { setError("Wait for the evidence cleanup to finish, or remove the interrupted upload before completing the job."); return; }
    if (files.some((item) => item.status === "uploading" || item.status === "queued")) { setError("Wait for evidence uploads to finish before completing the job."); return; }
    if (files.some((item) => item.status === "error")) { setError("Retry or remove failed evidence before completing the job."); return; }
    if ((paymentAmount !== null) !== Boolean(paymentMethod)) { setError("Enter both payment amount and payment method, or leave both empty."); return; }
    setSubmitting(true); setError(undefined);
    try {
      await onComplete({ workDone: workDone.trim(), remarks: remarks.trim() || undefined, extraCharges: extraCharges ?? 0, paymentAmount: paymentAmount ?? undefined, paymentMethod }, files);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Completion could not be submitted. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return <Space direction="vertical" block className="tech-stack tech-completion-form">
    <Button fill="none" className="tech-back" onClick={onCancel}>‹ Back to job</Button>
    <Card title="Complete service">
      <p className="tech-muted">Record the work first, then add evidence and review the estimate.</p>
      {error ? <NoticeBar color="alert" content={error} wrap /> : null}
      <label htmlFor="work-done">Work done</label>
      <TextArea id="work-done" value={workDone} onChange={setWorkDone} placeholder="Describe the work you completed" maxLength={4000} showCount autoSize={{ minRows: 4, maxRows: 7 }} disabled={locked || submitting} />
      <label htmlFor="remarks">Remarks <span className="tech-muted">(optional)</span></label>
      <TextArea id="remarks" value={remarks} onChange={setRemarks} placeholder="Anything the office should know" maxLength={4000} showCount autoSize={{ minRows: 2, maxRows: 5 }} disabled={locked || submitting} />
    </Card>
    <Card title="Charges & payment">
      <label htmlFor="extra-charges">Extra charges (RM)</label>
      <input id="extra-charges" className="tech-native-input" type="number" min="0" step="0.01" value={extraCharges ?? ""} onChange={(event) => setExtraCharges(event.target.value === "" ? null : Number(event.target.value))} disabled={locked || submitting} />
      <div className="tech-amount-estimate"><span>Quoted price</span><strong>RM {quotedPrice.toFixed(2)}</strong><span>+ Extra charges</span><strong>RM {(extraCharges ?? 0).toFixed(2)}</strong><div><span>Final amount estimate</span><strong>RM {finalEstimate.toFixed(2)}</strong></div><small>The server calculates the authoritative final amount.</small></div>
      <label htmlFor="payment-amount">Payment amount <span className="tech-muted">(optional)</span></label>
      <input id="payment-amount" className="tech-native-input" type="number" min="0" step="0.01" value={paymentAmount ?? ""} onChange={(event) => setPaymentAmount(event.target.value === "" ? null : Number(event.target.value))} disabled={locked || submitting} />
      <label>Payment method <span className="tech-muted">(optional)</span></label>
      <Selector aria-label="Payment method" options={paymentOptions.map(([value, label]) => ({ label, value }))} value={paymentMethod ? [paymentMethod] : []} onChange={(items) => setPaymentMethod(items[0] as CompletionValues["paymentMethod"])} disabled={locked || submitting} />
    </Card>
    <Card title={`Service evidence (${evidenceCount}/6)`}>
      <p className="tech-muted">Photos, video, or PDF. Each file is validated before upload; the total limit is 120 MB.</p>
      <input ref={input} className="tech-file-input" type="file" accept={Object.keys(SERVICE_EVIDENCE_POLICY.mimeMaximumBytes).join(",")} multiple onChange={(event) => { addFiles(event.target.files); event.currentTarget.value = ""; }} disabled={locked || submitting || evidenceCount >= 6} />
      <Button block fill="outline" disabled={locked || submitting || evidenceCount >= 6} onClick={() => input.current?.click()}><AddOutline /> Add evidence</Button>
      <div className="tech-evidence-list" aria-live="polite" aria-label="Evidence upload status">
        {serverEvidence.map((item) => <ServerEvidenceRow key={item.id} item={item} error={serverErrors[item.id]} removing={Boolean(removingServer[item.id])} disabled={locked || submitting} onRemove={() => void removeServerEvidence(item)} />)}
        {files.map((item) => <EvidenceRow key={item.localId} item={item} onRetry={() => void upload(item)} onRemove={() => void remove(item)} disabled={locked || submitting} />)}
      </div>
    </Card>
    <div className="tech-sticky-action"><Button block color="primary" size="large" loading={submitting} disabled={locked || submitting || !workDone.trim()} onClick={() => void submit()}>Complete job</Button><span>{locked ? "Completion has already been accepted." : "Your completion is submitted once, with a retry-safe request."}</span></div>
  </Space>;
}

function ServerEvidenceRow({ item, error, removing, disabled, onRemove }: { item: TechnicianEvidenceItem; error?: string; removing: boolean; disabled: boolean; onRemove: () => void }) {
  const success = item.status === "UPLOADED" || item.status === "ATTACHED";
  const interrupted = item.status === "RESERVED";
  const deleting = item.status === "DELETING";
  const removable = item.status !== "ATTACHED";
  const message = success ? (item.status === "ATTACHED" ? "Attached" : "Uploaded") : deleting ? "Removal in progress" : interrupted ? "Upload interrupted — remove and add again" : item.failureCode ?? "Upload failed — remove and add again";
  return <div className={`tech-evidence-row ${success ? "is-success" : interrupted || deleting ? "is-queued" : "is-error"}`}>
    <span className="tech-evidence-icon"><FileOutline /></span>
    <div><strong>{item.originalFilename}</strong><small>{bytes(item.sizeBytes)} · {message}</small>{error ? <small className="tech-evidence-error" role="alert">{error}</small> : null}</div>
    {success && item.viewUrl ? <a href={item.viewUrl} target="_blank" rel="noreferrer">View</a> : null}
    <Button size="mini" fill="none" loading={removing} onClick={onRemove} disabled={disabled || removing || !removable} aria-label={deleting ? `Retry removal for ${item.originalFilename}` : `Remove ${item.originalFilename}`}>{deleting ? <><RedoOutline /> Retry removal</> : <CloseCircleOutline />}</Button>
  </div>;
}

function EvidenceRow({ item, onRetry, onRemove, disabled }: { item: EvidenceItem; onRetry: () => void; onRemove: () => void; disabled: boolean }) {
  const icon = item.file.type.startsWith("image/") ? <PictureOutline /> : <FileOutline />;
  const message = item.status === "success" ? "Uploaded" : item.status === "uploading" ? "Uploading…" : item.status === "queued" ? "Queued" : item.error ?? "Upload failed";
  return <div className={`tech-evidence-row is-${item.status}`}><span className="tech-evidence-icon">{icon}</span><div><strong>{item.file.name}</strong><small>{bytes(item.file.size)} · {message}</small></div>{item.status === "error" ? <Button size="mini" fill="none" onClick={onRetry} disabled={disabled}><RedoOutline /> Retry</Button> : null}<Button size="mini" fill="none" onClick={onRemove} disabled={disabled || item.status === "uploading"} aria-label={`Remove ${item.file.name}`}><CloseCircleOutline /></Button></div>;
}
