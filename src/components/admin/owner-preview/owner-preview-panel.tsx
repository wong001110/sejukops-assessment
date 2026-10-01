"use client";
import { Alert, Button, Card, Flex, Select, Space, Typography } from "antd";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { OwnerPreviewDisplay, OwnerPreviewOptions, OwnerPreviewStatus } from "@/domain/staff/owner-preview-contracts";
import type { StaffRole } from "@/domain/staff/contracts";
import { useLatestRequest } from "@/lib/ui/use-latest-request";
import { ownerPreviewApi } from "./owner-preview-api";

export function OwnerPreviewPanel({ workspaceId, initialPreview = null }: { workspaceId: string; initialPreview?: OwnerPreviewDisplay | null }) {
  return <PreviewPanel key={workspaceId} workspaceId={workspaceId} initialPreview={initialPreview} />;
}
function PreviewPanel({ workspaceId, initialPreview }: { workspaceId: string; initialPreview: OwnerPreviewDisplay | null }) {
  const router = useRouter();
  const [preview, setPreview] = useState<OwnerPreviewDisplay | null>(initialPreview);
  const [options, setOptions] = useState<OwnerPreviewOptions>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [role, setRole] = useState<StaffRole>(initialPreview?.role ?? "ADMIN");
  const [employee, setEmployee] = useState<string | null>(initialPreview?.effectiveEmployeeProfileId ?? null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  const loads = useLatestRequest();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const adopt = useCallback((next: OwnerPreviewStatus | null) => { setPreview(next); setRole(next?.role ?? "ADMIN"); setEmployee(next?.effectiveEmployeeProfileId ?? null); }, []);
  const load = useCallback(async () => {
    const request = loads.begin(); setLoading(true); setError(undefined);
    try { const next = await ownerPreviewApi.get(workspaceId, request.signal); if (request.isCurrent()) { setOptions(next); adopt(next.preview); } }
    catch (cause) { if (request.isCurrent()) { setOptions(undefined); setError(cause instanceof Error ? cause.message : "Preview is unavailable. Return to Owner and try again."); } }
    finally { if (request.isCurrent()) { setLoading(false); request.finish(); } }
  }, [loads, workspaceId, adopt]);
  useEffect(() => { void load(); }, [load]);
  const start = async () => {
    if (pending.current || !options || (role === "TECHNICIAN" && !employee)) return;
    pending.current = true; setBusy(true); setError(undefined); loads.cancel(); setLoading(false);
    try {
      const next = await ownerPreviewApi.set({ workspaceId, role, employeeProfileId: role === "TECHNICIAN" ? employee : null });
      if (!mounted.current) return;
      adopt(next.preview); router.replace(`/workspaces/${workspaceId}/orders`); router.refresh();
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : "Preview could not be opened. Refresh and retry."); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  const exit = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(undefined); loads.cancel(); setLoading(false);
    try { await ownerPreviewApi.exit(); if (!mounted.current) return; adopt(null); router.replace("/owner"); router.refresh(); }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : "Preview could not be cleared. Retry Return to Owner."); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  return <Card size="small" title="Owner perspective preview" style={{ width: "100%", maxWidth: 1000 }}>
    {preview ? <Alert type="warning" showIcon message={`Read-only ${preview.role === "TECHNICIAN" ? "Technician" : preview.role === "MANAGER" ? "Manager" : "Admin"} preview${preview.effectiveEmployeeName ? ` · ${preview.effectiveEmployeeName}` : ""}`} description="You remain signed in as Owner. Business writes and AI actions are unavailable in this preview." /> : <Typography.Paragraph>Inspect a business perspective without changing employee data. Technician preview uses an actual employee’s assigned work.</Typography.Paragraph>}
    {error ? <Alert style={{ marginTop: 12 }} type="error" message={error} action={<Button disabled={busy} onClick={() => void load()}>Retry preview options</Button>} /> : null}
    {loading ? <Typography.Paragraph role="status">Loading preview options…</Typography.Paragraph> : null}
    <Flex gap={12} align="end" wrap style={{ marginTop: 12 }}>
      <div style={{ minWidth: 180 }}><label htmlFor="owner-preview-role">Business perspective</label><Select id="owner-preview-role" aria-label="Business perspective" style={{ width: "100%" }} value={role} disabled={busy || loading || !options} onChange={(next) => { setRole(next); setEmployee(null); }} options={[{ value: "ADMIN", label: "Admin" }, { value: "MANAGER", label: "Manager" }, { value: "TECHNICIAN", label: "Technician" }]} /></div>
      {role === "TECHNICIAN" ? <div style={{ flex: "1 1 250px", minWidth: 0 }}><label htmlFor="owner-preview-employee">Technician employee</label><Select id="owner-preview-employee" aria-label="Technician employee" style={{ width: "100%" }} value={employee} placeholder="Choose an active employee" disabled={busy || loading || !options} onChange={setEmployee} options={options?.technicians.map((item) => ({ value: item.profileId, label: `${item.name} (${item.branchCode})` }))} />{options && !options.technicians.length ? <Typography.Text type="secondary">No active Technicians are available.</Typography.Text> : null}</div> : null}
      <Space wrap><Button type="primary" aria-label="Open read-only preview" aria-busy={busy} loading={busy} disabled={busy || loading || !options || (role === "TECHNICIAN" && !employee)} onClick={() => void start()}>Open read-only preview</Button><Button aria-label="Return to Owner" aria-busy={busy} disabled={busy} onClick={() => void exit()}>Return to Owner</Button></Space>
    </Flex>
  </Card>;
}
