"use client";

import { Card, Empty, NoticeBar, Space } from "antd-mobile";

export function TechnicianPlaceholder({ title, description }: { title: string; description: string }) {
  return <Space direction="vertical" block className="tech-stack"><header className="tech-page-heading"><p className="tech-kicker">Field operations</p><h1>{title}</h1><p>{description}</p></header><NoticeBar color="info" content="This section is ready for the next Technician workflow delivery." wrap /><Card className="tech-empty-card"><Empty description="Nothing to show yet" /></Card></Space>;
}
