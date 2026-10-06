"use client";
import { BulbOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Modal, Tag } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DashboardPeriod } from "@/domain/operations-dashboard/contracts";
import type { DashboardHighlight } from "@/domain/operations-dashboard/insight";
import { useLatestRequest } from "@/lib/ui/use-latest-request";
import { formatMalaysiaDateTime } from "@/lib/time/malaysia";

export function DashboardInsight({ workspaceId, period, isGuest, canUseAi }: { workspaceId: string; period: DashboardPeriod; isGuest: boolean; canUseAi: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ highlights: DashboardHighlight[]; asOf: string }>();
  const requests = useLatestRequest();
  const router = useRouter();
  async function generate() {
    if (requests.pending()) return;
    const current = requests.begin();
    setBusy(true); setError(""); setResult(undefined);
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/dashboard/insight`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ period }), signal: current.signal });
      const body = await response.json();
      if (!current.isCurrent()) return;
      if (!response.ok) throw new Error([409, 429].includes(response.status) ? body.error : "AI Insight is unavailable. Dashboard statistics remain available.");
      if (!Array.isArray(body.highlights) || body.period !== period) throw new Error("AI Insight could not be verified.");
      setResult(body);
    } catch (cause) { if (current.isCurrent()) setError(cause instanceof Error ? cause.message : "AI Insight unavailable."); }
    finally { if (current.isCurrent()) { setBusy(false); if (isGuest) router.refresh(); } current.finish(); }
  }
  function cancel() { requests.cancel(); setBusy(false); if (isGuest) router.refresh(); }
  if (!canUseAi) return null;
  return <>
    <Card className="dashboard-panel" title={<><BulbOutlined aria-hidden /> AI Insight</>} extra={<Button type="primary" onClick={() => setOpen(true)}>View AI Insight</Button>}>
      <p className="product-muted">Prioritize source-backed operational highlights for the selected period. Runs only when requested; no records are changed.</p>
    </Card>
    <Modal open={open} title="Dashboard AI Insight" footer={null} onCancel={() => { cancel(); setOpen(false); }}>
      <p>AI selects up to three highlights from verified dashboard statistics. Facts and next steps use fixed source-backed text.</p>
      <Button type="primary" loading={busy} disabled={busy} onClick={() => void generate()}>{result || error ? "Refresh AI Insight" : "Generate AI Insight"}</Button>
      {busy && <Button onClick={cancel}>Cancel</Button>}
      {error && <Alert className="product-note" type="warning" showIcon message={error} />}
      {result && <section aria-label="Dashboard AI highlights" className="product-note"><Tag>Read-only · {period.replaceAll("_", " ")}</Tag><p className="product-muted">Source snapshot: {formatMalaysiaDateTime(result.asOf)} MYT</p>
        {result.highlights.map(item => <Card size="small" key={item.id} title={item.title} className="product-note"><p>{item.observation}</p><p className="product-muted">{item.nextStep}</p></Card>)}
      </section>}
    </Modal>
  </>;
}
