"use client";

import { Alert, Card, Empty, Space, Typography } from "antd";
export default function ManagerPage() { return <Space direction="vertical" size="large" className="page-stack"><div><Typography.Title level={2}>Review workspace</Typography.Title><Typography.Text type="secondary">A stable foundation for reviews and dashboard insights.</Typography.Text></div><Alert type="info" showIcon message="Manager data will appear here" description="The review queue and KPI dashboard are intentionally delivered in their workflow phases." /><Card><Empty description="No reviews require attention yet" /></Card></Space>; }
