"use client";

import { Alert, Button, Card, Flex, InputNumber, Skeleton, Space, Statistic, Typography } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";

type Budget = Readonly<{ used: number; limit: number; remaining: number; resetAt: string }>;

function resetLabel(instant: string): string {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) return "next Malaysia midnight";
  return new Intl.DateTimeFormat("en-MY", {
    timeZone: "Asia/Kuala_Lumpur", dateStyle: "medium", timeStyle: "short",
  }).format(date) + " (Malaysia time)";
}

export function GuestAiBudgetCard() {
  const [budget, setBudget] = useState<Budget | null>(null);
  const [limit, setLimit] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const savePending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/platform/guest-ai-budget", { cache: "no-store" });
      if (!response.ok) throw new Error("Guest AI allowance could not be loaded.");
      const next = await response.json() as Budget;
      setBudget(next);
      setLimit(next.limit);
      setError(null);
      return true;
    } catch {
      setError("Guest AI allowance could not be loaded. Please retry.");
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (savePending.current) return;
    if (limit === null || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
      setError("Enter a whole number from 1 to 1000.");
      return;
    }
    savePending.current = true;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/platform/guest-ai-budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit }),
      });
      if (!response.ok) throw new Error("Guest AI allowance could not be saved.");
      if (await load()) setNotice("Guest AI daily allowance saved.");
    } catch {
      setError("Guest AI allowance could not be saved. Please retry.");
    } finally {
      savePending.current = false;
      setSaving(false);
    }
  };

  return <Card title="Shared Guest AI allowance" extra={<Typography.Text type="secondary">All Guest visits share one daily limit</Typography.Text>}>
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Typography.Paragraph type="secondary" style={{ margin: 0 }}>Only paid AI calls use this allowance. Browsing and normal Demo changes remain available when it is exhausted.</Typography.Paragraph>
      {error ? <Alert type="error" showIcon message={error} action={<Button size="small" onClick={() => void load()}>Retry</Button>} /> : null}
      {notice ? <Alert type="success" showIcon closable onClose={() => setNotice(null)} message={notice} /> : null}
      {loading && !budget ? <Skeleton active paragraph={{ rows: 2 }} /> : budget ? <>
        <Flex gap={32} wrap>
          <Statistic title="Used today" value={budget.used} />
          <Statistic title="Daily limit" value={budget.limit} />
          <Statistic title="Remaining" value={budget.remaining} />
        </Flex>
        <Typography.Text type="secondary">Resets {resetLabel(budget.resetAt)}</Typography.Text>
      </> : null}
      <Flex gap={12} align="center" wrap>
        <label htmlFor="guest-ai-daily-limit">Daily paid AI call limit</label>
        <InputNumber id="guest-ai-daily-limit" min={1} max={1000} precision={0} value={limit} onChange={setLimit} disabled={loading || saving || !budget} />
        <Button type="primary" onClick={() => void save()} loading={saving} disabled={loading || saving || !budget || limit === budget.limit || limit === null}>Save limit</Button>
      </Flex>
    </Space>
  </Card>;
}
