"use client";

import { CalendarOutline, EnvironmentOutline, PhoneFill, RightOutline } from "antd-mobile-icons";
import { Button, Card, DotLoading, Empty, ErrorBlock, List, NoticeBar, Popup, Space, Tag, TextArea } from "antd-mobile";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatMalaysiaDateTime, malaysiaDateTimeLocalToIso, toMalaysiaDateTimeLocal } from "@/lib/time/malaysia";
import { type TechnicianJob, type TechnicianJobDetailResponse, technicianJobApi } from "./job-api";
import { CompletionForm, type CompletionValues } from "./completion-form";
import { technicianCompletionApi, type CompletionResult } from "./job-api";
import type { TechnicianEvidenceItem, TechnicianPaymentReceipt } from "@/domain/technician-completion/contracts";
import { invalidateManagerDashboard } from "@/components/manager/dashboard-query";

const statusTone = { ASSIGNED: "primary", IN_PROGRESS: "warning" } as const;
const requestKey = () => crypto.randomUUID();

function JobStatus({ status }: { status: TechnicianJob["status"] }) {
  return <Tag color={statusTone[status]} fill="outline">{status === "IN_PROGRESS" ? "In progress" : "Assigned"}</Tag>;
}
function Schedule({ value }: { value: string | null }) {
  return value ? <span>{formatMalaysiaDateTime(value)}</span> : <span className="tech-muted">Schedule to be confirmed</span>;
}

export function JobWorkspace() {
  const queryClient = useQueryClient();
  const [jobs, setJobs] = useState<TechnicianJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [selected, setSelected] = useState<TechnicianJobDetailResponse>();
  const [detailLoading, setDetailLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string }>();
  const [starting, setStarting] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [requestedSchedule, setRequestedSchedule] = useState("");
  const [reason, setReason] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState<string>();
  const [completionMode, setCompletionMode] = useState(false);
  const [completionResult, setCompletionResult] = useState<CompletionResult>();
  const [completionEvidence, setCompletionEvidence] = useState<TechnicianEvidenceItem[]>([]);
  const [completionReceipt, setCompletionReceipt] = useState<TechnicianPaymentReceipt | null>(null);
  const [completionLoading, setCompletionLoading] = useState(false);
  const startKeys = useRef(new Map<string, string>());
  const rescheduleKeys = useRef(new Map<string, string>());
  const completionKeys = useRef(new Map<string, string>());
  const whatsappOpenKeys = useRef(new Map<string, string>());

  const loadJobs = useCallback(async () => {
    setLoading(true); setError(undefined);
    try { setJobs((await technicianJobApi.list()).jobs); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Jobs could not be loaded."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void loadJobs(); }, [loadJobs]);

  const openJob = async (job: TechnicianJob) => {
    setDetailLoading(true);
    try { setSelected(await technicianJobApi.detail(job.id)); }
    catch (cause) { setFeedback({ kind: "error", message: cause instanceof Error ? cause.message : "Job detail could not be loaded." }); }
    finally { setDetailLoading(false); }
  };
  const startJob = async () => {
    if (!selected || selected.job.status !== "ASSIGNED") return;
    setStarting(true);
    try {
      const key = startKeys.current.get(selected.job.id) ?? requestKey();
      startKeys.current.set(selected.job.id, key);
      const result = await technicianJobApi.start(selected.job.id, { requestKey: key });
      startKeys.current.delete(selected.job.id);
      setSelected((current) => current ? { ...current, job: result.job } : current);
      setJobs((current) => current.map((job) => job.id === result.job.id ? { ...job, ...result.job } : job));
      setFeedback({ kind: "success", message: "Job started. Your work is now in progress." });
    } catch (cause) { setFeedback({ kind: "error", message: cause instanceof Error ? cause.message : "Job could not be started. Try again." }); }
    finally { setStarting(false); }
  };
  const closeReschedule = () => { setRescheduleOpen(false); setReason(""); setRequestedSchedule(""); setRequestError(undefined); };
  const submitReschedule = async () => {
    if (!selected || !reason.trim()) return;
    setRequesting(true);
    try {
      const key = rescheduleKeys.current.get(selected.job.id) ?? requestKey();
      rescheduleKeys.current.set(selected.job.id, key);
      const result = await technicianJobApi.requestReschedule(selected.job.id, { reason: reason.trim(), requestedSchedule: requestedSchedule ? malaysiaDateTimeLocalToIso(requestedSchedule) : undefined, requestKey: key });
      rescheduleKeys.current.delete(selected.job.id);
      setSelected((current) => current ? { ...current, rescheduleRequests: [result.request, ...current.rescheduleRequests] } : current);
      closeReschedule();
      setFeedback({ kind: "success", message: "Reschedule request sent for review." });
    } catch (cause) { setRequestError(cause instanceof Error ? cause.message : "Request could not be sent. Try again."); }
    finally { setRequesting(false); }
  };
  const completeJob = async (values: CompletionValues) => {
    if (!selected) return;
    const key = completionKeys.current.get(selected.job.id) ?? requestKey();
    completionKeys.current.set(selected.job.id, key);
    const payment = values.paymentAmount !== undefined && values.paymentMethod ? { amount: values.paymentAmount, method: values.paymentMethod } : undefined;
    const result = await technicianCompletionApi.complete(selected.job.id, { workDone: values.workDone, extraCharges: values.extraCharges, remarks: values.remarks, payment, receiptUploadId: values.receiptUploadId, requestKey: key });
    await invalidateManagerDashboard(queryClient);
    completionKeys.current.delete(selected.job.id); setCompletionResult(result); setCompletionMode(false);
    setJobs((items) => items.filter((item) => item.id !== selected.job.id));
  };
  const openCompletion = async () => { if (!selected || completionLoading) return; setCompletionLoading(true); try { const [evidence, receipt] = await Promise.all([technicianCompletionApi.listEvidence(selected.job.id), technicianCompletionApi.listReceipt(selected.job.id)]); setCompletionEvidence(evidence.evidence); setCompletionReceipt(receipt.receipt); setCompletionMode(true); } catch (cause) { setFeedback({ kind: "error", message: cause instanceof Error ? cause.message : "Completion uploads could not be loaded. Try again." }); } finally { setCompletionLoading(false); } };
  if (completionResult) {
    const whatsappRequestKey = whatsappOpenKeys.current.get(completionResult.job.id) ?? requestKey();
    whatsappOpenKeys.current.set(completionResult.job.id, whatsappRequestKey);
    const prepared = Boolean(completionResult.notification);
    const completionSummary = `${completionResult.attachments.length ? `${completionResult.attachments.length} evidence file(s) recorded.` : "No evidence files were added."}${completionResult.receipt ? " Supporting document attached for human review." : " No supporting document was added."}${completionResult.payment ? " Payment recorded." : " No payment was recorded."}`;
    return <Space direction="vertical" block className="tech-stack tech-completion-success"><header className="tech-page-heading"><p className="tech-kicker">Service completed</p><h1>Job completed</h1><p>{completionResult.job.orderNo} is ready for Manager review.</p></header><Card className="tech-detail-hero"><p className="tech-muted">Authoritative final amount</p><h2>RM {completionResult.report.finalAmount.toFixed(2)}</h2><p>Service report saved at {formatMalaysiaDateTime(completionResult.report.completedAt)}.</p></Card><NoticeBar color="info" content={completionSummary} wrap /><Card title="Customer WhatsApp"><p className="tech-muted">{prepared ? "A customer message is prepared. Opening WhatsApp does not send it; you choose whether to send it in WhatsApp." : "Customer message preparation did not finish, but your completed job is safely in the Manager review queue. You can retry preparation by opening WhatsApp."}</p>{completionResult.notificationWarning ? <NoticeBar color="alert" content={completionResult.notificationWarning.message} wrap /> : null}<form method="post" action={`/api/technician/jobs/${completionResult.job.id}/whatsapp/open`} target="_blank" className="tech-whatsapp-form"><input type="hidden" name="requestKey" value={whatsappRequestKey} /><Button block color="primary" type="submit">{prepared ? "Open Customer WhatsApp" : "Prepare & open WhatsApp"}</Button></form></Card><Button block fill="outline" onClick={() => { whatsappOpenKeys.current.delete(completionResult.job.id); setCompletionResult(undefined); setSelected(undefined); }}>Back to my jobs</Button></Space>;
  }
  if (completionMode && selected) return <CompletionForm quotedPrice={selected.job.quotedPrice} initialEvidence={completionEvidence} initialReceipt={completionReceipt} locked={false} onUpload={(file, key) => technicianCompletionApi.uploadEvidence(selected.job.id, file, key)} onRemove={async (evidenceId) => { await technicianCompletionApi.removeEvidence(selected.job.id, evidenceId); setCompletionEvidence((items) => items.filter((item) => item.id !== evidenceId)); }} onReceiptUpload={async (file, key) => { const receipt = await technicianCompletionApi.uploadReceipt(selected.job.id, file, key); setCompletionReceipt(receipt); return receipt; }} onReceiptRemove={async (receiptId) => { await technicianCompletionApi.removeReceipt(selected.job.id, receiptId); setCompletionReceipt(null); }} onComplete={(values) => completeJob(values)} onCancel={() => setCompletionMode(false)} />;

  if (selected || detailLoading) return <><JobDetail data={selected} loading={detailLoading} starting={starting} completionLoading={completionLoading} feedback={feedback} onBack={() => setSelected(undefined)} onStart={() => void startJob()} onComplete={() => void openCompletion()} onRequest={() => { if (selected?.job.scheduledAt) setRequestedSchedule(toMalaysiaDateTimeLocal(selected.job.scheduledAt)); setRequestError(undefined); setRescheduleOpen(true); }} /><ReschedulePopup open={rescheduleOpen} requestedSchedule={requestedSchedule} reason={reason} error={requestError} submitting={requesting} onClose={closeReschedule} onSchedule={setRequestedSchedule} onReason={setReason} onSubmit={() => void submitReschedule()} /></>;

  return <Space direction="vertical" block className="tech-stack">
    <header className="tech-page-heading"><p className="tech-kicker">Field operations</p><h1>My jobs</h1><p>Prioritised work assigned to you, in Malaysia time.</p></header>
    {feedback ? <NoticeBar color={feedback.kind === "error" ? "alert" : "info"} content={feedback.message} wrap /> : null}
    {error ? <ErrorBlock status="default" title="We could not load your jobs" description={error} fullPage={false}><Button color="primary" size="small" onClick={() => void loadJobs()}>Try again</Button></ErrorBlock> : null}
    {loading ? <LoadingJobs /> : !error && (jobs.length ? <section className="tech-job-list" aria-label="Assigned jobs">{jobs.map((job) => <JobCard key={job.id} job={job} onOpen={() => void openJob(job)} />)}</section> : <Card className="tech-empty-card"><Empty description="No assigned jobs right now" /><p className="tech-muted tech-center">New assigned work will appear here automatically when you refresh.</p><Button fill="none" size="small" onClick={() => void loadJobs()}>Refresh jobs</Button></Card>)}
  </Space>;
}

function LoadingJobs() { return <div className="tech-loading" aria-label="Loading jobs"><DotLoading color="primary" /><span>Loading your assigned work…</span></div>; }
function JobCard({ job, onOpen }: { job: TechnicianJob; onOpen: () => void }) {
  return <button type="button" className="tech-job-button" onClick={onOpen}><Card className={`tech-job-card tech-job-${job.status.toLowerCase()}`}>
    <div className="tech-job-topline"><JobStatus status={job.status} /><span className="tech-order-number">{job.orderNo}</span></div>
    <h2>{job.customerName}</h2><p className="tech-service-type">{job.serviceType}</p>
    <div className="tech-job-meta"><span><EnvironmentOutline /> {job.addressSummary}</span><span><CalendarOutline /> <Schedule value={job.scheduledAt} /></span></div>
    <div className="tech-card-action">View job <RightOutline fontSize={14} /></div>
  </Card></button>;
}

function JobDetail({ data, loading, starting, completionLoading, feedback, onBack, onStart, onComplete, onRequest }: { data?: TechnicianJobDetailResponse; loading: boolean; starting: boolean; completionLoading: boolean; feedback?: { kind: "success" | "error"; message: string }; onBack: () => void; onStart: () => void; onComplete: () => void; onRequest: () => void }) {
  if (loading || !data) return <Space direction="vertical" block className="tech-stack"><Button fill="none" onClick={onBack}>‹ Back to jobs</Button><LoadingJobs /></Space>;
  const { job } = data;
  const pendingRequest = data.rescheduleRequests.find((item) => item.status === "PENDING");
  return <Space direction="vertical" block className="tech-stack tech-job-detail"><Button fill="none" className="tech-back" onClick={onBack}>‹ Back to jobs</Button>{feedback ? <NoticeBar color={feedback.kind === "error" ? "alert" : "info"} content={feedback.message} wrap /> : null}<Card className="tech-detail-hero"><div className="tech-job-topline"><JobStatus status={job.status} /><span className="tech-order-number">{job.orderNo}</span></div><h1>{job.customerName}</h1><p>{job.serviceType} · RM {job.quotedPrice.toFixed(2)}</p></Card><Card title="Visit details"><List><List.Item prefix={<CalendarOutline />} description="Scheduled"><Schedule value={job.scheduledAt} /></List.Item><List.Item prefix={<EnvironmentOutline />} description="Service address">{job.customerAddress}</List.Item><List.Item prefix={<PhoneFill />} description="Customer phone"><a href={`tel:${job.customerPhone}`}>{job.customerPhone}</a></List.Item></List></Card><Card title="Service request"><p className="tech-detail-copy">{job.problemDescription}</p>{job.adminNotes ? <NoticeBar color="info" content={`Admin note: ${job.adminNotes}`} wrap /> : null}</Card><Card title="Updates from operations">{data.notifications.length ? <List>{data.notifications.map((notification) => <List.Item key={notification.id} description={formatMalaysiaDateTime(notification.createdAt)}><strong>{notification.title}</strong><p className="tech-notification-copy">{notification.message}</p></List.Item>)}</List> : <p className="tech-muted">No new updates from Admin or Manager.</p>}</Card><Card title="Schedule"><p className="tech-muted">The scheduled time is controlled by Admin or Manager. You can request a change with a reason.</p>{pendingRequest ? <NoticeBar color="alert" content="Your reschedule request is awaiting review." wrap /> : <Button block fill="outline" onClick={onRequest}>Request a reschedule</Button>}</Card>{job.status === "ASSIGNED" ? <div className="tech-sticky-action"><Button block color="primary" size="large" loading={starting} onClick={onStart}>Start job</Button><span>Starting changes this job to In progress.</span></div> : <div className="tech-sticky-action"><Button block color="primary" size="large" loading={completionLoading} onClick={onComplete}>Complete service</Button><span>Add work details, charges, optional payment, supporting document, and evidence.</span></div>}</Space>;
}

function ReschedulePopup({ open, requestedSchedule, reason, error, submitting, onClose, onSchedule, onReason, onSubmit }: { open: boolean; requestedSchedule: string; reason: string; error?: string; submitting: boolean; onClose: () => void; onSchedule: (value: string) => void; onReason: (value: string) => void; onSubmit: () => void }) {
  return <Popup visible={open} position="bottom" onMaskClick={onClose} bodyStyle={{ borderTopLeftRadius: 20, borderTopRightRadius: 20 }}><div className="tech-reschedule-popup"><h2>Request a reschedule</h2><p className="tech-muted">Your Admin or Manager will review this request. You cannot directly change the job schedule.</p>{error ? <NoticeBar color="alert" content={error} wrap /> : null}<label htmlFor="requested-schedule">Preferred time <span className="tech-muted">(optional)</span></label><input id="requested-schedule" className="tech-native-input" type="datetime-local" value={requestedSchedule} onChange={(event) => onSchedule(event.target.value)} /><label htmlFor="reschedule-reason">Why do you need a change?</label><TextArea id="reschedule-reason" value={reason} onChange={onReason} placeholder="Explain the reason for your request" maxLength={1000} showCount autoSize={{ minRows: 3, maxRows: 5 }} /><Button block color="primary" size="large" loading={submitting} disabled={!reason.trim()} onClick={onSubmit}>Send for review</Button><Button block fill="none" onClick={onClose}>Cancel</Button></div></Popup>;
}
