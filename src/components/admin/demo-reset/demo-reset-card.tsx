"use client";

import { Alert, Button, Card, Flex, Input, Popconfirm, Skeleton, Space, Statistic, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";

type Status = Readonly<{ generation: number; orderCount: number }>;

export function DemoResetCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/platform/demo/reset", { cache: "no-store" });
      if (!response.ok) throw new Error("Unavailable");
      const next = await response.json() as Status;
      if (!Number.isSafeInteger(next.generation) || next.generation < 1
          || !Number.isSafeInteger(next.orderCount) || next.orderCount < 0) throw new Error("Invalid status");
      setStatus(next);
      setError(null);
      return next;
    } catch {
      setStatus(null);
      setError("Demo status could not be loaded. Please retry.");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const reset = async () => {
    if (!status || confirmation !== "RESET DEMO" || resetting) return;
    setResetting(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/platform/demo/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: confirmation, expectedGeneration: status.generation }),
      });
      if (!response.ok) throw new Error("Reset failed");
      setConfirmation("");
      if (await load()) {
        setNotice("Demo reset complete. Open a new Guest visit to view the starter orders.");
      } else {
        setNotice("Demo reset completed, but its current status could not be loaded. Retry the status check.");
      }
    } catch {
      setConfirmation("");
      const current = await load();
      if (current && current.generation !== status.generation) {
        setNotice("Demo generation changed. Check the current orders before another reset.");
      } else {
        setError("Could not confirm whether the reset completed. Check the current generation and order count before retrying.");
      }
    } finally {
      setResetting(false);
    }
  };

  return <Card title="Reset shared Demo data">
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
        This removes shared Demo orders and returns the fictional starter dataset. It does not reset Owner data or the Guest AI daily allowance. Existing Guest visits become invalid.
      </Typography.Paragraph>
      {error && <Alert type="error" showIcon message={error} action={<Button size="small" onClick={() => void load()}>Retry</Button>} />}
      {notice && <Alert type="success" showIcon closable onClose={() => setNotice(null)} message={notice} />}
      {loading && !status ? <Skeleton active paragraph={{ rows: 1 }} /> : status && <Flex gap={32} wrap>
        <Statistic title="Current generation" value={status.generation} />
        <Statistic title="Demo orders" value={status.orderCount} />
      </Flex>}
      <Flex gap={12} align="end" wrap>
        <label htmlFor="demo-reset-confirmation">Type RESET DEMO to confirm<br />
          <Input id="demo-reset-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)}
            placeholder="RESET DEMO" autoComplete="off" disabled={loading || resetting || !status} />
        </label>
        <Popconfirm title="Reset shared Demo now?" description="Current Demo orders and visits will be replaced."
          okText="Reset Demo" okButtonProps={{ danger: true, loading: resetting }} onConfirm={() => void reset()}
          disabled={loading || resetting || !status || confirmation !== "RESET DEMO"}>
          <Button danger loading={resetting} disabled={loading || !status || confirmation !== "RESET DEMO"}>Reset Demo</Button>
        </Popconfirm>
      </Flex>
    </Space>
  </Card>;
}
