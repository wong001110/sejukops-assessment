"use client";

import { CalendarOutlined, CheckCircleOutlined, ClockCircleOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Descriptions, Drawer, Empty, Form, Input, List, Modal, Result, Select, Skeleton, Space, Table, Tag, Timeline, Tooltip, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatMalaysiaDateTime, malaysiaDateTimeLocalToIso, toMalaysiaDateTimeLocal } from "@/lib/time/malaysia";
import type { OrderStatus } from "@/domain/operations";
import { type AdminOrder, type CreateOrderInput, type OrderDetail, type RescheduleRequest, orderApi } from "./order-api";
import { orderListApi } from "./order-list-api";
import type { AdminBranchOption, AdminOrderDetail, AdminOrderStatusSummary, AdminTechnicianOption, OrderSubmissionSummary, PaginationMeta } from "@/domain/admin-orders/contracts";
import { invalidateManagerDashboard } from "@/components/manager/dashboard-query";
import { PriceInput } from "@/components/shared/price-input";
import { useDebouncedValue } from "@/lib/use-debounced-value";

const statusColor: Record<OrderStatus, string> = { NEW: "default", ASSIGNED: "blue", IN_PROGRESS: "processing", JOB_DONE: "gold", REVIEWED: "green", CLOSED: "success" };
const statuses: OrderStatus[] = ["NEW", "ASSIGNED", "IN_PROGRESS", "JOB_DONE", "REVIEWED", "CLOSED"];
const statusLabels: Record<OrderStatus, string> = { NEW: "New", ASSIGNED: "Assigned", IN_PROGRESS: "In Progress", JOB_DONE: "Job Done", REVIEWED: "Reviewed", CLOSED: "Closed" };
const emptySummary: AdminOrderStatusSummary = { total: 0, counts: { NEW: 0, ASSIGNED: 0, IN_PROGRESS: 0, JOB_DONE: 0, REVIEWED: 0, CLOSED: 0 } };
const serviceTypes = ["Cleaning", "Repair", "Installation", "Maintenance", "Inspection"];
const key = () => crypto.randomUUID();
function Schedule({ value }: { value?: string | null }) { return value ? <span>{formatMalaysiaDateTime(value)}</span> : <Typography.Text type="secondary">Not scheduled</Typography.Text>; }
function Status({ value }: { value: OrderStatus }) { return <Tag color={statusColor[value]}>{statusLabels[value]}</Tag>; }
function AdminWhatsAppOpenForm({ orderId, requestKey }: { orderId: string; requestKey: string }) { return <form method="post" action={`/api/admin/orders/${orderId}/whatsapp/open`} target="_blank" className="whatsapp-open-form"><input type="hidden" name="requestKey" value={requestKey} /><Button htmlType="submit">Open customer WhatsApp</Button></form>; }

type FormValues = { customerName: string; phone: string; address: string; branchId: string; technicianId?: string; scheduledAt?: string; problemDescription: string; serviceType: string; quotedPrice: number; adminNotes?: string };

export function OrderWorkspace() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [form] = Form.useForm<FormValues>();
  const statusParam = searchParams.get("status");
  const selectedStatus = statuses.includes(statusParam as OrderStatus) ? statusParam as OrderStatus : undefined;
  const parsedPage = Number(searchParams.get("page") ?? "1");
  const parsedPageSize = Number(searchParams.get("pageSize") ?? "8");
  const listQuery = useMemo(() => ({
    search: searchParams.get("search") || undefined,
    status: selectedStatus,
    branchId: searchParams.get("branchId") || undefined,
    technicianId: searchParams.get("technicianId") || undefined,
    page: Number.isInteger(parsedPage) && parsedPage >= 1 ? parsedPage : 1,
    pageSize: Number.isInteger(parsedPageSize) && parsedPageSize >= 5 && parsedPageSize <= 100 ? parsedPageSize : 8,
  }), [searchParams, selectedStatus, parsedPage, parsedPageSize]);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta>({ page: 1, pageSize: 8, total: 0, totalPages: 1, hasMore: false });
  const [branches, setBranches] = useState<AdminBranchOption[]>([]);
  const [technicians, setTechnicians] = useState<AdminTechnicianOption[]>([]);
  const [createTechnicians, setCreateTechnicians] = useState<AdminTechnicianOption[]>([]);
  const [statusSummary, setStatusSummary] = useState<AdminOrderStatusSummary>(emptySummary);
  const [searchText, setSearchText] = useState(listQuery.search ?? "");
  const [branchSearch, setBranchSearch] = useState("");
  const [technicianSearch, setTechnicianSearch] = useState("");
  const debouncedBranchSearch = useDebouncedValue(branchSearch, 300);
  const debouncedTechnicianSearch = useDebouncedValue(technicianSearch, 300);
  const [filterLoading, setFilterLoading] = useState(false);
  const [loading, setLoading] = useState(true); const [error, setError] = useState<string>();
  const [detail, setDetail] = useState<OrderDetail>(); const [detailLoading, setDetailLoading] = useState(false); const [createOpen, setCreateOpen] = useState(false); const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<{ order: AdminOrderDetail; customerReused: boolean; summary: OrderSubmissionSummary }>(); const [reschedule, setReschedule] = useState<AdminOrder>(); const [scheduleAt, setScheduleAt] = useState(""); const [scheduleReason, setScheduleReason] = useState(""); const [rescheduling, setRescheduling] = useState(false);
  const [request, setRequest] = useState<RescheduleRequest>(); const [requestSchedule, setRequestSchedule] = useState(""); const [note, setNote] = useState(""); const [resolving, setResolving] = useState(false);
  const createRequestKey = useRef<string>(); const rescheduleRequestKey = useRef<string>(); const resolveRequestKey = useRef<string>(); const whatsappOpenKeys = useRef(new Map<string, string>());
  const selectedBranchId = Form.useWatch("branchId", form);

  const updateUrl = useCallback((patch: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [name, value] of Object.entries(patch)) {
      if (value === undefined || value === "") next.delete(name); else next.set(name, String(value));
    }
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  useEffect(() => { setSearchText(listQuery.search ?? ""); }, [listQuery.search]);

  const load = useCallback(async () => {
    setLoading(true); setError(undefined);
    try {
      const data = await orderListApi.list(listQuery);
      setOrders(data.orders);
      setPagination(data.pagination);
    } catch (e) { setError(e instanceof Error ? e.message : "Orders could not be loaded."); }
    finally { setLoading(false); }
  }, [listQuery]);
  useEffect(() => { void load(); }, [load]);

  const loadBranches = useCallback(async (q = "") => {
    setFilterLoading(true);
    try {
      const data = await orderListApi.filters({ kind: "branches", q: q || undefined, selectedId: listQuery.branchId });
      if (data.kind === "branches") setBranches(data.options);
    } finally { setFilterLoading(false); }
  }, [listQuery.branchId]);
  useEffect(() => { void loadBranches(debouncedBranchSearch); }, [debouncedBranchSearch, loadBranches]);

  const loadTechnicians = useCallback(async (q = "") => {
    setFilterLoading(true);
    try {
      const data = await orderListApi.filters({ kind: "technicians", q: q || undefined, branchId: listQuery.branchId, selectedId: listQuery.technicianId });
      if (data.kind === "technicians") setTechnicians(data.options);
    } finally { setFilterLoading(false); }
  }, [listQuery.branchId, listQuery.technicianId]);
  useEffect(() => { void loadTechnicians(debouncedTechnicianSearch); }, [debouncedTechnicianSearch, loadTechnicians]);

  const loadStatusSummary = useCallback(async () => {
    const data = await orderListApi.filters({ kind: "statusSummary", search: listQuery.search, branchId: listQuery.branchId, technicianId: listQuery.technicianId });
    if (data.kind === "statusSummary") setStatusSummary(data.summary);
  }, [listQuery.search, listQuery.branchId, listQuery.technicianId]);
  useEffect(() => { void loadStatusSummary(); }, [loadStatusSummary]);

  useEffect(() => {
    if (!selectedBranchId) { setCreateTechnicians([]); return; }
    void orderListApi.filters({ kind: "technicians", branchId: selectedBranchId }).then((data) => {
      if (data.kind === "technicians") setCreateTechnicians(data.options);
    });
  }, [selectedBranchId]);

  const changeStatus = (status?: OrderStatus) => updateUrl({ status, page: 1 });
  const openDetail = async (order: AdminOrder) => { setDetail({ order: order as AdminOrderDetail, auditEvents: [], reschedules: [], rescheduleRequests: [] }); setDetailLoading(true); try { setDetail(await orderApi.detail(order.id)); } catch (e) { message.error(e instanceof Error ? e.message : "Order detail could not be loaded."); } finally { setDetailLoading(false); } };
  const openCreate = () => { createRequestKey.current = key(); setBranchSearch(""); void loadBranches(""); setCreateOpen(true); };
  const closeCreate = () => { createRequestKey.current = undefined; setCreateOpen(false); };
  const openReschedule = (order: AdminOrder) => { rescheduleRequestKey.current = key(); setReschedule(order); setScheduleAt(order.scheduledAt ? toMalaysiaDateTimeLocal(order.scheduledAt) : ""); setScheduleReason(""); };
  const create = async (values: FormValues) => { setSaving(true); try { const input: CreateOrderInput = { customer: { name: values.customerName, phone: values.phone, address: values.address }, branchId: values.branchId, technicianId: values.technicianId, scheduledAt: values.scheduledAt ? malaysiaDateTimeLocalToIso(values.scheduledAt) : undefined, problemDescription: values.problemDescription, serviceType: values.serviceType, quotedPrice: values.quotedPrice, adminNotes: values.adminNotes, requestKey: createRequestKey.current ??= key() }; const result = await orderApi.create(input); createRequestKey.current = undefined; form.resetFields(); setCreateOpen(false); setCreated(result); await Promise.all([load(), loadStatusSummary()]); } catch (e) { message.error(e instanceof Error ? e.message : "Order could not be created."); } finally { setSaving(false); } };
  const closeReschedule = () => { rescheduleRequestKey.current = undefined; setReschedule(undefined); };
  const directReschedule = async () => { if (!reschedule || !scheduleAt) return; setRescheduling(true); try { await orderApi.reschedule(reschedule.id, { scheduledAt: malaysiaDateTimeLocalToIso(scheduleAt), reason: scheduleReason || undefined, requestKey: rescheduleRequestKey.current ??= key() }); await invalidateManagerDashboard(queryClient); rescheduleRequestKey.current = undefined; setReschedule(undefined); message.success("Schedule updated; lifecycle status is unchanged."); await load(); if (detail?.order.id === reschedule.id) await openDetail(reschedule); } catch (e) { message.error(e instanceof Error ? e.message : "Schedule could not be updated."); } finally { setRescheduling(false); } };
  const openRequest = (next: RescheduleRequest) => { resolveRequestKey.current = key(); setRequest(next); setRequestSchedule(next.requestedSchedule ? toMalaysiaDateTimeLocal(next.requestedSchedule) : ""); setNote(""); };
  const closeRequest = () => { resolveRequestKey.current = undefined; setRequest(undefined); };
  const resolve = async (decision: "APPROVE" | "REJECT") => { if (!request || (decision === "APPROVE" && !requestSchedule)) return; setResolving(true); try { await orderApi.resolveRequest(request.id, { decision, resolutionNote: note || undefined, newSchedule: decision === "APPROVE" ? malaysiaDateTimeLocalToIso(requestSchedule) : undefined, requestKey: resolveRequestKey.current ??= key() }); if (decision === "APPROVE") await invalidateManagerDashboard(queryClient); const selected = detail?.order; resolveRequestKey.current = undefined; setRequest(undefined); setNote(""); message.success(decision === "APPROVE" ? "Request approved and schedule recorded." : "Request rejected; no schedule change was made."); await Promise.all([load(), loadStatusSummary()]); if (selected) await openDetail(selected); } catch (e) { message.error(e instanceof Error ? e.message : "Request could not be resolved."); } finally { setResolving(false); } };
  const columns = useMemo<ColumnsType<AdminOrder>>(() => [
    { title: "Order", dataIndex: "orderNo", width: 150, render: (value, order) => <Button type="link" className="order-number" onClick={() => void openDetail(order)}>{value}</Button> },
    { title: "Customer", key: "customer", render: (_, order) => <div className="table-primary"><strong>{order.customerName}</strong><span>{order.customerPhone}</span></div> },
    { title: "Service", dataIndex: "serviceType", width: 130 }, { title: "Branch", key: "branch", width: 155, render: (_, order) => `${order.branch.code} · ${order.branch.name}` },
    { title: "Technician", key: "technician", width: 130, render: (_, order) => order.technician?.name ?? <Typography.Text type="secondary">Unassigned</Typography.Text> }, { title: "Schedule", key: "schedule", width: 178, render: (_, order) => <Schedule value={order.scheduledAt} /> }, { title: "Status", dataIndex: "status", width: 125, render: (value: OrderStatus) => <Status value={value} /> },
    { title: "", key: "action", width: 70, fixed: "right", render: (_, order) => <Tooltip title="Direct reschedule"><Button aria-label={`Reschedule ${order.orderNo}`} icon={<CalendarOutlined />} onClick={() => openReschedule(order)} /></Tooltip> },
  ], []);

  const clearFilters = () => { setSearchText(""); setBranchSearch(""); setTechnicianSearch(""); updateUrl({ search: undefined, status: undefined, branchId: undefined, technicianId: undefined, page: 1 }); };
  return <Space direction="vertical" size="large" className="page-stack admin-workspace">
    <section className="page-heading"><div><Typography.Title level={2}>Orders & scheduling</Typography.Title><Typography.Paragraph type="secondary">Create, assign and coordinate field work. Every executed schedule change remains traceable without becoming a lifecycle status.</Typography.Paragraph></div><Button type="primary" size="large" icon={<PlusOutlined />} onClick={openCreate}>New order</Button></section>
    <Card className="order-status-summary" size="small"><div className="status-summary-buttons"><Button type={!selectedStatus ? "primary" : "default"} onClick={() => changeStatus(undefined)}><span>All</span><strong>{statusSummary.total}</strong></Button>{statuses.map((status) => <Button key={status} type={selectedStatus === status ? "primary" : "default"} onClick={() => changeStatus(status)}><span>{statusLabels[status]}</span><strong>{statusSummary.counts[status]}</strong></Button>)}</div></Card>
    <Card className="order-toolbar order-toolbar-with-summary" size="small"><Input.Search allowClear placeholder="Search order, customer, phone or service" className="order-search" value={searchText} onChange={(event) => { const value = event.target.value; setSearchText(value); if (!value && listQuery.search) updateUrl({ search: undefined, page: 1 }); }} onSearch={(value) => updateUrl({ search: value.trim() || undefined, page: 1 })} /><Select aria-label="Filter orders by branch" showSearch filterOption={false} allowClear placeholder="All branches" value={listQuery.branchId} loading={filterLoading} onSearch={setBranchSearch} onDropdownVisibleChange={(open) => { if (open) void loadBranches(branchSearch); }} options={branches.map((branch) => ({ value: branch.id, label: `${branch.code} · ${branch.name}` }))} onChange={(branchId) => { setTechnicianSearch(""); updateUrl({ branchId, technicianId: undefined, page: 1 }); }} /><Select aria-label="Filter orders by technician" showSearch filterOption={false} allowClear placeholder="All technicians" value={listQuery.technicianId} loading={filterLoading} onSearch={setTechnicianSearch} onDropdownVisibleChange={(open) => { if (open) void loadTechnicians(technicianSearch); }} options={technicians.map((tech) => ({ value: tech.id, label: `${tech.name} · ${tech.branchCode}` }))} onChange={(technicianId) => updateUrl({ technicianId, page: 1 })} /><Button onClick={clearFilters}>Clear filters</Button><Button icon={<ReloadOutlined />} onClick={() => void Promise.all([load(), loadStatusSummary()])} loading={loading}>Refresh</Button></Card>
    {error ? <Alert type="error" showIcon message="Orders are unavailable" description={error} action={<Button size="small" onClick={() => void load()}>Retry</Button>} /> : null}
    <Card className="order-table-card" styles={{ body: { padding: 0 } }}>{loading ? <div className="table-skeleton"><Skeleton active paragraph={{ rows: 7 }} /></div> : orders.length ? <Table rowKey="id" dataSource={orders} columns={columns} pagination={{ current: pagination.page, pageSize: pagination.pageSize, total: pagination.total, showSizeChanger: true, pageSizeOptions: [8, 16, 32, 64], showTotal: (total, range) => `${range[0]}–${range[1]} of ${total}`, onChange: (page, pageSize) => updateUrl({ page: pageSize === pagination.pageSize ? page : 1, pageSize }) }} scroll={{ x: 1040 }} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No orders match these filters"><Button onClick={clearFilters}>Clear filters</Button></Empty>}</Card>
    <Drawer title={detail?.order.orderNo ?? "Order detail"} width={720} open={Boolean(detail)} onClose={() => { if (detail) whatsappOpenKeys.current.delete(detail.order.id); setDetail(undefined); }} destroyOnHidden extra={detail ? <Space wrap>{["JOB_DONE", "REVIEWED", "CLOSED"].includes(detail.order.status) ? <AdminWhatsAppOpenForm key="whatsapp" orderId={detail.order.id} requestKey={whatsappOpenKeys.current.get(detail.order.id) ?? (whatsappOpenKeys.current.set(detail.order.id, key()), whatsappOpenKeys.current.get(detail.order.id)!)} /> : null}<Button icon={<CalendarOutlined />} onClick={() => openReschedule(detail.order)}>Reschedule</Button></Space> : null}>{detailLoading ? <Skeleton active paragraph={{ rows: 12 }} /> : detail ? <Detail data={detail} onReview={openRequest} /> : null}</Drawer>
    <Drawer className="create-order-drawer" title="Create service order" width={760} open={createOpen} onClose={closeCreate} destroyOnHidden footer={<Space><Button onClick={closeCreate}>Cancel</Button><Button type="primary" htmlType="submit" form="create-order-form" loading={saving}>Create order</Button></Space>}><Form id="create-order-form" form={form} layout="vertical" requiredMark="optional" initialValues={{ serviceType: "Cleaning" }} onFinish={(values) => void create(values)}><Alert className="form-note" type="info" showIcon message="The server reserves the human-readable order number when you submit." /><div className="form-grid two-up"><Form.Item label="Customer name" name="customerName" rules={[{ required: true, message: "Enter the customer name." }]}><Input autoComplete="name" /></Form.Item><Form.Item label="Phone" name="phone" rules={[{ required: true, message: "Enter a phone number." }, { pattern: /^\+?[0-9][0-9 -]{6,20}$/, message: "Use a valid phone number." }]}><Input autoComplete="tel" /></Form.Item></div><Form.Item label="Service address" name="address" rules={[{ required: true, message: "Enter the service address." }]}><Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} /></Form.Item><div className="form-grid three-up"><Form.Item label="Branch" name="branchId" rules={[{ required: true, message: "Select a branch." }]}><Select showSearch filterOption={false} placeholder="Select branch" options={branches.map((branch) => ({ value: branch.id, label: `${branch.code} · ${branch.name}` }))} onSearch={(value) => void loadBranches(value)} onChange={(branchId) => { form.setFieldValue("technicianId", undefined); const technicianId = form.getFieldValue("technicianId"); const technician = createTechnicians.find((candidate) => candidate.id === technicianId); if (technician && technician.branchId !== branchId) form.setFieldValue("technicianId", undefined); }} /></Form.Item><Form.Item label="Assigned technician" name="technicianId"><Select showSearch filterOption={false} allowClear disabled={!selectedBranchId} placeholder={selectedBranchId ? "Assign now or leave NEW" : "Select a branch first"} options={createTechnicians.map((tech) => ({ value: tech.id, label: tech.name }))} onSearch={(value) => { if (!selectedBranchId) return; void orderListApi.filters({ kind: "technicians", q: value || undefined, branchId: selectedBranchId }).then((data) => { if (data.kind === "technicians") setCreateTechnicians(data.options); }); }} /></Form.Item><Form.Item label="Scheduled time" name="scheduledAt"><Input type="datetime-local" /></Form.Item></div><div className="form-grid two-up"><Form.Item label="Service type" name="serviceType" rules={[{ required: true, message: "Select a service type." }]}><Select options={serviceTypes.map((value) => ({ value }))} /></Form.Item><Form.Item label="Quoted price (RM)" name="quotedPrice" rules={[{ required: true, message: "Enter the quoted price." }]}><PriceInput /></Form.Item></div><Form.Item label="Problem description" name="problemDescription" rules={[{ required: true, message: "Describe the service issue." }]}><Input.TextArea autoSize={{ minRows: 3, maxRows: 6 }} /></Form.Item><Form.Item label="Internal notes" name="adminNotes"><Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} /></Form.Item></Form></Drawer>
    <Modal title={`Reschedule ${reschedule?.orderNo ?? "order"}`} open={Boolean(reschedule)} onCancel={closeReschedule} onOk={() => void directReschedule()} okText="Update schedule" okButtonProps={{ loading: rescheduling, disabled: !scheduleAt }}><Alert type="warning" showIcon message="This records a reschedule event. The lifecycle status will remain unchanged." /><label className="field-label" htmlFor="new-schedule">New Malaysia schedule</label><Input id="new-schedule" type="datetime-local" value={scheduleAt} onChange={(event) => setScheduleAt(event.target.value)} /><label className="field-label" htmlFor="schedule-reason">Reason (optional)</label><Input.TextArea id="schedule-reason" value={scheduleReason} onChange={(event) => setScheduleReason(event.target.value)} autoSize={{ minRows: 2, maxRows: 4 }} /></Modal>
    <Modal title="Review technician request" open={Boolean(request)} onCancel={closeRequest} footer={<Space><Button onClick={closeRequest}>Cancel</Button><Button danger loading={resolving} onClick={() => void resolve("REJECT")}>Reject</Button><Button type="primary" loading={resolving} disabled={!requestSchedule} onClick={() => void resolve("APPROVE")}>Approve & reschedule</Button></Space>}>{request ? <><Descriptions column={1} size="small" items={[{ key: "from", label: "Requested by", children: request.requestedByName }, { key: "why", label: "Reason", children: request.reason }]} /><label className="field-label" htmlFor="requested-schedule">Schedule to approve</label><Input id="requested-schedule" type="datetime-local" value={requestSchedule} onChange={(event) => setRequestSchedule(event.target.value)} /><label className="field-label" htmlFor="decision-note">Decision note (optional)</label><Input.TextArea id="decision-note" value={note} onChange={(event) => setNote(event.target.value)} autoSize={{ minRows: 2, maxRows: 4 }} /></> : null}</Modal>
    <Modal open={Boolean(created)} footer={null} closable={false}>{created ? <Result status="success" icon={<CheckCircleOutlined />} title="Order is ready for operations" subTitle={`${created.summary.orderNo} is ${created.summary.status.replaceAll("_", " ")} for ${created.summary.customerName} at ${created.summary.branchName}.${created.customerReused ? " The matching customer was reused." : " A customer record was created."}`} extra={[<Button key="view" type="primary" onClick={() => { void openDetail(created.order); setCreated(undefined); }}>View order</Button>, <Button key="done" onClick={() => setCreated(undefined)}>Back to orders</Button>]} /> : null}</Modal>
  </Space>;
}

function Detail({ data, onReview }: { data: OrderDetail; onReview: (request: RescheduleRequest) => void }) {
  const { order } = data;
  return <Space direction="vertical" size="large" className="full-width order-detail"><Card size="small" className="detail-hero"><Status value={order.status} /><Typography.Title level={4}>{order.customerName}</Typography.Title><Typography.Paragraph type="secondary">{order.customerAddress}</Typography.Paragraph></Card><Descriptions bordered size="small" column={1} items={[{ key: "phone", label: "Phone", children: order.customerPhone }, { key: "branch", label: "Branch", children: `${order.branch.code} · ${order.branch.name}` }, { key: "tech", label: "Technician", children: order.technician?.name ?? "Unassigned" }, { key: "time", label: "Schedule", children: <Schedule value={order.scheduledAt} /> }, { key: "quote", label: "Quoted price", children: `RM ${order.quotedPrice.toFixed(2)}` }, { key: "problem", label: "Problem", children: order.problemDescription }, { key: "notes", label: "Admin notes", children: order.adminNotes || "—" }]} />
  <section><Typography.Title level={5}><ClockCircleOutlined /> Schedule history</Typography.Title>{data.reschedules.length ? <Timeline items={data.reschedules.map((event) => ({ color: event.sameDay ? "orange" : "blue", children: <div><strong>{event.source.replaceAll("_", " ")}</strong><div><Schedule value={event.previousSchedule} /> → <Schedule value={event.newSchedule} /></div><Typography.Text type="secondary">{event.sameDay ? "Same-day time change · counted as a reschedule" : "Schedule date changed"}{event.reason ? ` · ${event.reason}` : ""}</Typography.Text></div> }))} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No executed schedule changes" />}</section>
  <section><Typography.Title level={5}>Reschedule requests</Typography.Title>{data.rescheduleRequests.length ? <List size="small" bordered dataSource={data.rescheduleRequests} renderItem={(item) => <List.Item actions={item.status === "PENDING" ? [<Button key="review" type="link" onClick={() => onReview(item)}>Review</Button>] : undefined}><List.Item.Meta title={<Space>{item.requestedByName}<Tag color={item.status === "PENDING" ? "orange" : item.status === "APPROVED" ? "green" : "red"}>{item.status}</Tag></Space>} description={<><Schedule value={item.requestedSchedule} /> · {item.reason}{item.resolutionNote ? ` · ${item.resolutionNote}` : ""}</>} /></List.Item>} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No reschedule requests" />}</section>
  <section><Typography.Title level={5}>Audit trail</Typography.Title>{data.auditEvents.length ? <Timeline items={data.auditEvents.map((event) => ({ children: <div><strong>{event.eventType.replaceAll("_", " ")}</strong><div>{event.actorName ?? "System"} · {formatMalaysiaDateTime(event.createdAt)}</div></div> }))} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Audit events will appear here" />}</section></Space>;
}
