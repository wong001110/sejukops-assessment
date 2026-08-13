"use client";

import {
  CalendarOutlined,
  CheckCircleOutlined,
  CommentOutlined,
  EyeOutlined,
  FileTextOutlined,
  MessageOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  Input,
  List,
  Modal,
  Select,
  Skeleton,
  Space,
  Table,
  Tag,
  Timeline,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  ManagerBranch,
  ManagerPaginationMeta,
  ManagerReviewDetail,
  ManagerReviewListItem,
  ManagerRescheduleRequest,
  WhatsAppNotification,
} from "@/domain/manager-review/contracts";
import { formatMalaysiaDateTime, malaysiaDateTimeLocalToIso, toMalaysiaDateTimeLocal } from "@/lib/time/malaysia";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { managerReviewApi } from "./review-api";
import { managerReviewListApi, type ReviewListResponse } from "./review-list-api";
import { invalidateManagerDashboard } from "./dashboard-query";
import { WorkflowFlagList } from "./workflow-flags/flag-list";

const requestKey = () => crypto.randomUUID();
const money = (value: number) => `RM ${value.toFixed(2)}`;
const statusColor = { JOB_DONE: "gold", IN_PROGRESS: "processing", REVIEWED: "green", CLOSED: "success" } as const;
type Feedback = { type: "success" | "error" | "warning"; message: string };
type DecisionState = { review: ManagerReviewDetail; decision: "APPROVE" | "REQUEST_CLARIFICATION" };

function StatusTag({ status }: { status: ManagerReviewListItem["status"] }) {
  return <Tag color={statusColor[status as keyof typeof statusColor] ?? "default"}>{status.replaceAll("_", " ")}</Tag>;
}
function Schedule({ value }: { value: string | null }) {
  return value ? <span>{formatMalaysiaDateTime(value)}</span> : <Typography.Text type="secondary">Not scheduled</Typography.Text>;
}
function NotificationTag({ status }: { status: WhatsAppNotification["status"] | null }) {
  if (!status) return <Typography.Text type="secondary">Not prepared</Typography.Text>;
  return <Tag color={status === "OPENED" ? "blue" : "cyan"}>{status === "OPENED" ? "WhatsApp opened" : "WhatsApp ready"}</Tag>;
}
function WhatsAppOpenForm({ orderId, requestKey: stableRequestKey, label = "Open WhatsApp again", disabled = false }: { orderId: string; requestKey: string; label?: string; disabled?: boolean }) {
  return <form method="post" action={`/api/manager/reviews/${orderId}/whatsapp/open`} target="_blank" className="whatsapp-open-form"><input type="hidden" name="requestKey" value={stableRequestKey} /><Button htmlType="submit" icon={<MessageOutlined />} disabled={disabled}>{label}</Button></form>;
}

export function ReviewWorkspace() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const parsedPage = Number(searchParams.get("page") ?? "1");
  const parsedPageSize = Number(searchParams.get("pageSize") ?? "8");
  const listQuery = useMemo(() => ({
    branchId: searchParams.get("branchId") || undefined,
    search: searchParams.get("search") || undefined,
    page: Number.isInteger(parsedPage) && parsedPage >= 1 ? parsedPage : 1,
    pageSize: Number.isInteger(parsedPageSize) && parsedPageSize >= 5 && parsedPageSize <= 100 ? parsedPageSize : 8,
  }), [searchParams, parsedPage, parsedPageSize]);
  const [queue, setQueue] = useState<ReviewListResponse>();
  const [pagination, setPagination] = useState<ManagerPaginationMeta>({ page: 1, pageSize: 8, total: 0, totalPages: 1, hasMore: false });
  const [branches, setBranches] = useState<ManagerBranch[]>([]);
  const [branchSearch, setBranchSearch] = useState("");
  const debouncedBranchSearch = useDebouncedValue(branchSearch, 300);
  const [search, setSearch] = useState(listQuery.search ?? "");
  const [loading, setLoading] = useState(true);
  const [filterLoading, setFilterLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [feedback, setFeedback] = useState<Feedback>();
  const [detail, setDetail] = useState<ManagerReviewDetail>();
  const [detailLoading, setDetailLoading] = useState(false);
  const [decision, setDecision] = useState<DecisionState>();
  const [decisionNote, setDecisionNote] = useState("");
  const [decisionSaving, setDecisionSaving] = useState(false);
  const [reschedule, setReschedule] = useState<ManagerReviewDetail>();
  const [scheduleAt, setScheduleAt] = useState("");
  const [rescheduleReason, setRescheduleReason] = useState("");
  const [rescheduleSaving, setRescheduleSaving] = useState(false);
  const [request, setRequest] = useState<ManagerRescheduleRequest>();
  const [requestSchedule, setRequestSchedule] = useState("");
  const [resolutionNote, setResolutionNote] = useState("");
  const [requestSaving, setRequestSaving] = useState(false);
  const decisionKeys = useRef(new Map<string, string>());
  const rescheduleKeys = useRef(new Map<string, string>());
  const resolveKeys = useRef(new Map<string, string>());
  const whatsappKeys = useRef(new Map<string, string>());

  const updateUrl = useCallback((patch: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [name, value] of Object.entries(patch)) {
      if (value === undefined || value === "") next.delete(name); else next.set(name, String(value));
    }
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);
  useEffect(() => { setSearch(listQuery.search ?? ""); }, [listQuery.search]);

  const load = useCallback(async () => {
    setLoading(true); setError(undefined);
    try {
      const next = await managerReviewListApi.list(listQuery);
      setQueue(next); setPagination(next.pagination);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Completed jobs could not be loaded."); }
    finally { setLoading(false); }
  }, [listQuery]);
  useEffect(() => { void load(); }, [load]);

  const loadBranches = useCallback(async (q = "") => {
    setFilterLoading(true);
    try {
      const result = await managerReviewListApi.filters({ q: q || undefined, selectedId: listQuery.branchId });
      setBranches(result.options);
    } finally { setFilterLoading(false); }
  }, [listQuery.branchId]);
  useEffect(() => { void loadBranches(debouncedBranchSearch); }, [debouncedBranchSearch, loadBranches]);

  const openDetail = async (item: ManagerReviewListItem) => {
    setDetailLoading(true); setDetail(undefined);
    try { setDetail((await managerReviewApi.detail(item.id)).review); }
    catch (cause) { setFeedback({ type: "error", message: cause instanceof Error ? cause.message : "Review detail could not be loaded." }); }
    finally { setDetailLoading(false); }
  };
  const refreshDetail = async (orderId: string) => setDetail((await managerReviewApi.detail(orderId)).review);
  const closeDecision = () => { if (decision) decisionKeys.current.delete(decision.review.id); setDecision(undefined); setDecisionNote(""); };
  const submitDecision = async () => {
    if (!decision || (decision.decision === "REQUEST_CLARIFICATION" && !decisionNote.trim())) return;
    const id = decision.review.id; setDecisionSaving(true);
    try {
      const key = decisionKeys.current.get(id) ?? requestKey(); decisionKeys.current.set(id, key);
      const input = decision.decision === "REQUEST_CLARIFICATION" ? { decision: "REQUEST_CLARIFICATION" as const, note: decisionNote.trim(), requestKey: key } : { decision: "APPROVE" as const, note: decisionNote.trim() || undefined, requestKey: key };
      const result = await managerReviewApi.decide(id, input); decisionKeys.current.delete(id); closeDecision();
      setFeedback({ type: "success", message: result.order.status === "CLOSED" ? `${result.order.orderNo} was approved and closed.` : `${result.order.orderNo} was returned to the Technician with your clarification request.` });
      if (input.decision === "REQUEST_CLARIFICATION") await invalidateManagerDashboard(queryClient);
      setDetail(undefined); await load();
    } catch (cause) { setFeedback({ type: "error", message: cause instanceof Error ? cause.message : "The review decision could not be saved. Retry safely with the same request." }); }
    finally { setDecisionSaving(false); }
  };
  const closeReschedule = () => { if (reschedule) rescheduleKeys.current.delete(reschedule.id); setReschedule(undefined); setScheduleAt(""); setRescheduleReason(""); };
  const submitReschedule = async () => {
    if (!reschedule || !scheduleAt) return; setRescheduleSaving(true);
    try {
      const key = rescheduleKeys.current.get(reschedule.id) ?? requestKey(); rescheduleKeys.current.set(reschedule.id, key);
      await managerReviewApi.reschedule(reschedule.id, { scheduledAt: malaysiaDateTimeLocalToIso(scheduleAt), reason: rescheduleReason.trim() || undefined, requestKey: key });
      rescheduleKeys.current.delete(reschedule.id); const id = reschedule.id; closeReschedule();
      setFeedback({ type: "success", message: "Schedule updated. The job lifecycle status is unchanged." });
      await invalidateManagerDashboard(queryClient); await Promise.all([load(), refreshDetail(id)]);
    } catch (cause) { setFeedback({ type: "error", message: cause instanceof Error ? cause.message : "The schedule could not be updated. Retry safely with the same request." }); }
    finally { setRescheduleSaving(false); }
  };
  const closeRequest = () => { if (request) resolveKeys.current.delete(request.id); setRequest(undefined); setRequestSchedule(""); setResolutionNote(""); };
  const openRequest = (next: ManagerRescheduleRequest) => { resolveKeys.current.set(next.id, requestKey()); setRequest(next); setRequestSchedule(next.requestedSchedule ? toMalaysiaDateTimeLocal(next.requestedSchedule) : ""); setResolutionNote(""); };
  const whatsappRequestKey = (review: ManagerReviewDetail) => { const scope = review.notification?.id ?? review.id; const existing = whatsappKeys.current.get(scope); if (existing) return existing; const next = requestKey(); whatsappKeys.current.set(scope, next); return next; };
  const resolveRequest = async (decisionValue: "APPROVE" | "REJECT") => {
    if (!request || (decisionValue === "APPROVE" && !requestSchedule)) return; setRequestSaving(true);
    try {
      const key = resolveKeys.current.get(request.id) ?? requestKey(); resolveKeys.current.set(request.id, key);
      const result = await managerReviewApi.resolveRequest(request.id, { decision: decisionValue, resolutionNote: resolutionNote.trim() || undefined, newSchedule: decisionValue === "APPROVE" ? malaysiaDateTimeLocalToIso(requestSchedule) : undefined, requestKey: key });
      resolveKeys.current.delete(request.id); const orderId = request.orderId; closeRequest();
      setFeedback({ type: "success", message: result.request.status === "APPROVED" ? "Technician request approved and the new schedule was recorded." : "Technician request rejected; no schedule change was made." });
      if (result.request.status === "APPROVED") await invalidateManagerDashboard(queryClient);
      await Promise.all([load(), detail?.id === orderId ? refreshDetail(orderId) : Promise.resolve()]);
    } catch (cause) { setFeedback({ type: "error", message: cause instanceof Error ? cause.message : "The technician request could not be resolved. Retry safely with the same request." }); }
    finally { setRequestSaving(false); }
  };

  const columns = useMemo<ColumnsType<ManagerReviewListItem>>(() => [
    { title: "Order", dataIndex: "orderNo", width: 150, render: (value, item) => <Button type="link" className="order-number" onClick={() => void openDetail(item)}>{value}</Button> },
    { title: "Customer", key: "customer", render: (_, item) => <div className="table-primary"><strong>{item.customerName}</strong><span>{item.customerPhone}</span></div> },
    { title: "Service", dataIndex: "serviceType", width: 132 }, { title: "Branch", key: "branch", width: 145, render: (_, item) => `${item.branch.code} · ${item.branch.name}` },
    { title: "Completed", dataIndex: "completedAt", width: 178, render: (value) => formatMalaysiaDateTime(value) }, { title: "Final amount", dataIndex: "finalAmount", width: 125, align: "right", render: (value) => <strong>{money(value)}</strong> },
    { title: "Flags", dataIndex: "openFlagCount", width: 82, align: "center", render: (count) => count ? <Tag color="orange">{count}</Tag> : <Typography.Text type="secondary">—</Typography.Text> }, { title: "WhatsApp", dataIndex: "notificationStatus", width: 142, render: (value) => <NotificationTag status={value} /> },
    { title: "", key: "open", width: 80, fixed: "right", render: (_, item) => <Tooltip title="Open review"><Button aria-label={`Open review ${item.orderNo}`} icon={<EyeOutlined />} onClick={() => void openDetail(item)} /></Tooltip> },
  ], []);
  const visibleRequests = queue?.pendingRescheduleRequests ?? [];
  const clearFilters = () => { setSearch(""); setBranchSearch(""); updateUrl({ search: undefined, branchId: undefined, page: 1 }); };

  return <Space direction="vertical" size="large" className="page-stack manager-workspace">
    <section className="page-heading"><div><Typography.Title level={2}>Completion review</Typography.Title><Typography.Paragraph type="secondary">Review completed work, resolve operational requests, and close jobs with a complete MYT audit trail.</Typography.Paragraph></div><Space wrap><Button icon={<CalendarOutlined />} onClick={() => visibleRequests[0] && openRequest(visibleRequests[0])} disabled={!visibleRequests.length}>Technician requests {visibleRequests.length ? `(${visibleRequests.length})` : ""}</Button><Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>Refresh</Button></Space></section>
    {feedback ? <Alert closable showIcon type={feedback.type} message={feedback.message} onClose={() => setFeedback(undefined)} /> : null}
    <Card className="review-toolbar" size="small"><Input.Search aria-label="Search review queue" allowClear placeholder="Search order, customer, phone or service" value={search} onChange={(event) => { const value = event.target.value; setSearch(value); if (!value && listQuery.search) updateUrl({ search: undefined, page: 1 }); }} onSearch={(value) => updateUrl({ search: value.trim() || undefined, page: 1 })} /><Select aria-label="Filter review queue by branch" showSearch filterOption={false} allowClear placeholder="All branches" value={listQuery.branchId} loading={filterLoading} onSearch={setBranchSearch} onDropdownVisibleChange={(open) => { if (open) void loadBranches(branchSearch); }} onChange={(branchId) => updateUrl({ branchId, page: 1 })} options={branches.map((branch) => ({ value: branch.id, label: `${branch.code} · ${branch.name}` }))} /><Button onClick={clearFilters}>Clear filters</Button></Card>
    {error ? <Alert type="error" showIcon message="Review queue is unavailable" description={error} action={<Button size="small" onClick={() => void load()}>Retry</Button>} /> : null}
    <Card className="review-table-card" styles={{ body: { padding: 0 } }}>{loading ? <div className="table-skeleton"><Skeleton active paragraph={{ rows: 7 }} /></div> : queue?.reviews.length ? <Table rowKey="id" dataSource={queue.reviews} columns={columns} pagination={{ current: pagination.page, pageSize: pagination.pageSize, total: pagination.total, showSizeChanger: true, pageSizeOptions: [8, 16, 32, 64], showTotal: (total, range) => `${range[0]}–${range[1]} of ${total}`, onChange: (page, pageSize) => updateUrl({ page: pageSize === pagination.pageSize ? page : 1, pageSize }) }} scroll={{ x: 1190 }} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No completed jobs need review"><Typography.Text type="secondary">Completed work will appear here after a Technician submits it.</Typography.Text></Empty>}</Card>
    <Drawer title={detail?.orderNo ?? "Completion review"} width={760} open={Boolean(detail) || detailLoading} onClose={() => { if (detail) whatsappKeys.current.delete(detail.notification?.id ?? detail.id); setDetail(undefined); setDetailLoading(false); }} destroyOnHidden extra={detail ? <Space wrap><WhatsAppOpenForm orderId={detail.id} requestKey={whatsappRequestKey(detail)} label={detail.notification ? "Open WhatsApp again" : "Prepare & open WhatsApp"} /><Button icon={<CalendarOutlined />} onClick={() => { rescheduleKeys.current.set(detail.id, requestKey()); setReschedule(detail); setScheduleAt(detail.scheduledAt ? toMalaysiaDateTimeLocal(detail.scheduledAt) : ""); }}>Reschedule</Button></Space> : null}>{detailLoading ? <Skeleton active paragraph={{ rows: 16 }} /> : detail ? <ReviewDetail review={detail} onRequest={openRequest} onDecision={(next) => { decisionKeys.current.set(detail.id, requestKey()); setDecision({ review: detail, decision: next }); setDecisionNote(""); }} /> : null}</Drawer>
    <Modal title={decision?.decision === "APPROVE" ? "Approve and close job" : "Request clarification / rework"} open={Boolean(decision)} onCancel={closeDecision} footer={<Space><Button onClick={closeDecision}>Cancel</Button><Button type={decision?.decision === "APPROVE" ? "primary" : "default"} danger={decision?.decision === "REQUEST_CLARIFICATION"} loading={decisionSaving} disabled={decision?.decision === "REQUEST_CLARIFICATION" && !decisionNote.trim()} onClick={() => void submitDecision()}>{decision?.decision === "APPROVE" ? "Approve & close" : "Send clarification request"}</Button></Space>}>{decision ? <Space direction="vertical" className="full-width"><Alert showIcon type={decision.decision === "APPROVE" ? "success" : "warning"} message={decision.decision === "APPROVE" ? "This will approve the service report and close the job." : "This returns the job to In progress for the assigned Technician."} /><label className="field-label" htmlFor="review-note">{decision.decision === "REQUEST_CLARIFICATION" ? "Required clarification / rework note" : "Review note (optional)"}</label><Input.TextArea id="review-note" value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} autoSize={{ minRows: 3, maxRows: 6 }} maxLength={4000} showCount placeholder={decision.decision === "REQUEST_CLARIFICATION" ? "Explain what the Technician needs to clarify or rework" : "Optional approval note"} /></Space> : null}</Modal>
    <Modal title={`Reschedule ${reschedule?.orderNo ?? "job"}`} open={Boolean(reschedule)} onCancel={closeReschedule} onOk={() => void submitReschedule()} okText="Update schedule" okButtonProps={{ loading: rescheduleSaving, disabled: !scheduleAt }}><Alert type="warning" showIcon message="This records a schedule event. It does not change the job lifecycle state." /><label className="field-label" htmlFor="manager-schedule">New Malaysia schedule</label><Input id="manager-schedule" type="datetime-local" value={scheduleAt} onChange={(event) => setScheduleAt(event.target.value)} /><label className="field-label" htmlFor="manager-schedule-reason">Reason (optional)</label><Input.TextArea id="manager-schedule-reason" value={rescheduleReason} onChange={(event) => setRescheduleReason(event.target.value)} autoSize={{ minRows: 2, maxRows: 4 }} /></Modal>
    <Modal title="Resolve technician reschedule request" open={Boolean(request)} onCancel={closeRequest} footer={<Space><Button onClick={closeRequest}>Cancel</Button><Button danger loading={requestSaving} onClick={() => void resolveRequest("REJECT")}>Reject</Button><Button type="primary" loading={requestSaving} disabled={!requestSchedule} onClick={() => void resolveRequest("APPROVE")}>Approve & reschedule</Button></Space>}>{request ? <><Descriptions column={1} size="small" items={[{ key: "order", label: "Order", children: request.orderNo }, { key: "from", label: "Requested by", children: request.requestedByName }, { key: "reason", label: "Reason", children: request.reason }]} /><label className="field-label" htmlFor="manager-request-schedule">Schedule to approve</label><Input id="manager-request-schedule" type="datetime-local" value={requestSchedule} onChange={(event) => setRequestSchedule(event.target.value)} /><label className="field-label" htmlFor="manager-request-note">Decision note (optional)</label><Input.TextArea id="manager-request-note" value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} autoSize={{ minRows: 2, maxRows: 4 }} /></> : null}</Modal>
  </Space>;
}

function ReviewDetail({ review, onRequest, onDecision }: { review: ManagerReviewDetail; onRequest: (request: ManagerRescheduleRequest) => void; onDecision: (decision: "APPROVE" | "REQUEST_CLARIFICATION") => void }) {
  const detailItems = [
    { key: "customer", label: "Customer", children: <span>{review.customerName}<br /><Typography.Text type="secondary">{review.customerPhone}</Typography.Text></span> }, { key: "address", label: "Service address", children: review.customerAddress }, { key: "service", label: "Service", children: review.serviceType }, { key: "technician", label: "Technician", children: review.technician?.name ?? "Not assigned" }, { key: "schedule", label: "Scheduled", children: <Schedule value={review.scheduledAt} /> }, { key: "completed", label: "Completed", children: formatMalaysiaDateTime(review.completedAt) }, { key: "quoted", label: "Quoted price", children: money(review.quotedPrice) }, { key: "extra", label: "Extra charges", children: money(review.extraCharges) }, { key: "final", label: "Final amount", children: <strong>{money(review.finalAmount)}</strong> }, { key: "problem", label: "Problem", children: review.problemDescription }, { key: "notes", label: "Admin notes", children: review.adminNotes || "—" },
  ];
  const timelineItems = [
    ...review.reviews.map((item) => ({ createdAt: item.createdAt, color: item.decision === "APPROVED" ? "green" : "orange", children: <div key={item.id}><strong>{item.decision.replaceAll("_", " ")}</strong><div>{item.reviewerName} · {formatMalaysiaDateTime(item.createdAt)}</div>{item.note ? <Typography.Text type="secondary">{item.note}</Typography.Text> : null}</div> })),
    ...review.auditEvents.map((event) => ({ createdAt: event.createdAt, color: undefined, children: <div key={event.id}><strong>{event.eventType.replaceAll("_", " ")}</strong><div>{event.actorName ?? "System"} · {formatMalaysiaDateTime(event.createdAt)}</div></div> })),
  ].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)).map((item) => ({ color: item.color, children: item.children }));
  return <Space direction="vertical" size="large" className="full-width review-detail">
    <Card size="small" className="detail-hero"><Space align="center" wrap><StatusTag status={review.status} /><NotificationTag status={review.notificationStatus} /></Space><Typography.Title level={4}>{review.orderNo} · {review.customerName}</Typography.Title><Typography.Paragraph type="secondary">Completed work is ready for an accountable Manager decision.</Typography.Paragraph></Card>
    <Card title="Order & amount"><Descriptions bordered size="small" column={1} items={detailItems} /></Card>
    <Card title="Service report"><Typography.Paragraph className="review-copy">{review.workDone}</Typography.Paragraph>{review.remarks ? <Alert type="info" showIcon message="Technician remarks" description={review.remarks} /> : <Typography.Text type="secondary">No Technician remarks were recorded.</Typography.Text>}</Card>
    <Card title={`Evidence (${review.evidence.length})`}><List locale={{ emptyText: "No evidence files were attached" }} dataSource={review.evidence} renderItem={(item) => <List.Item actions={item.viewUrl ? [<a key="view" href={item.viewUrl} target="_blank" rel="noreferrer">View signed file</a>] : [<Typography.Text key="unavailable" type="secondary">View unavailable</Typography.Text>]}><List.Item.Meta avatar={<FileTextOutlined />} title={item.filename} description={`${item.mimeType} · ${(item.sizeBytes / 1024 / 1024).toFixed(2)} MB`} /></List.Item>} /></Card>
    <Card title="Payment"><Descriptions size="small" column={1} items={review.payment ? [{ key: "amount", label: "Recorded amount", children: money(review.payment.amount) }, { key: "method", label: "Method", children: review.payment.method }, { key: "time", label: "Recorded", children: formatMalaysiaDateTime(review.payment.recordedAt) }] : [{ key: "none", label: "Payment", children: "No payment was recorded" }]} /></Card>
    <Card title="Receipt / supporting document">{review.supportingDocument ? <List dataSource={[review.supportingDocument]} renderItem={(item) => <List.Item actions={item.viewUrl ? [<a key="view" href={item.viewUrl} target="_blank" rel="noreferrer">View signed document</a>] : [<Typography.Text key="unavailable" type="secondary">View unavailable</Typography.Text>]}><List.Item.Meta avatar={<FileTextOutlined />} title={item.filename} description={`${item.mimeType} · ${(item.sizeBytes / 1024 / 1024).toFixed(2)} MB`} /></List.Item>} /> : <Typography.Text type="secondary">No supporting document was attached.</Typography.Text>}<Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>This document is reviewed by a human. Its contents are not OCR-verified and it does not by itself mean payment was received.</Typography.Paragraph></Card>
    <Card title={`Workflow flags (${review.flags.filter((flag) => flag.status === "OPEN").length} open)`}><WorkflowFlagList flags={review.flags} /></Card>
    <Card title="Technician reschedule requests">{review.rescheduleRequests.length ? <List size="small" dataSource={review.rescheduleRequests} renderItem={(item) => <List.Item actions={item.status === "PENDING" ? [<Button key="resolve" type="link" onClick={() => onRequest(item)}>Resolve</Button>] : undefined}><List.Item.Meta title={<Space>{item.requestedByName}<Tag color={item.status === "PENDING" ? "orange" : item.status === "APPROVED" ? "green" : "default"}>{item.status}</Tag></Space>} description={<><Schedule value={item.requestedSchedule} /> · {item.reason}{item.resolutionNote ? ` · ${item.resolutionNote}` : ""}</>} /></List.Item>} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No reschedule requests" />}</Card>
    <Card title="Review & audit trail">{timelineItems.length ? <Timeline items={timelineItems} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Audit events will appear here" />}</Card>
    {review.status === "JOB_DONE" ? <div className="review-action-bar"><Button danger icon={<CommentOutlined />} onClick={() => onDecision("REQUEST_CLARIFICATION")}>Request clarification</Button><Button type="primary" icon={<CheckCircleOutlined />} onClick={() => onDecision("APPROVE")}>Approve & close job</Button></div> : <Alert type="info" showIcon message={review.status === "IN_PROGRESS" ? "This job is back with the Technician." : "This review is already finalised."} />}
  </Space>;
}
