"use client";

import { Card, Empty, NoticeBar, Space, Tag } from "antd-mobile";
import { formatMalaysiaDateTime } from "@/lib/time/malaysia";
export default function TechnicianPage() { return <Space direction="vertical" block style={{ "--gap": "16px" }}><div><h1 className="mobile-title">My jobs</h1><p className="mobile-subtitle">Your assigned field work, in Malaysia time.</p></div><NoticeBar content="Demo workspace — assignments will appear once service data is connected." color="alert" /><Card title="Today"><Tag color="primary">Ready when assigned</Tag><p className="mobile-subtitle">Checked {formatMalaysiaDateTime(new Date())}</p><Empty description="No assigned jobs yet" /></Card></Space>; }
