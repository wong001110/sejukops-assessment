"use client";

import { Alert, Card, Empty, Space, Typography } from "antd";
import { formatMalaysiaDateTime } from "@/lib/time/malaysia";
export default function AdminPage() { return <Space direction="vertical" size="large" className="page-stack"><div><Typography.Title level={2}>Operations overview</Typography.Title><Typography.Text type="secondary">Foundation workspace · {formatMalaysiaDateTime(new Date())}</Typography.Text></div><Alert type="info" showIcon message="Your order workspace is being prepared" description="Orders, scheduling and assignment arrive in the next delivery slice." /><Card><Empty description="No operational data connected yet" /></Card></Space>; }
