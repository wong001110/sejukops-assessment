"use client";

import { Card, List, NoticeBar, Space, Tag } from "antd-mobile";

export function TechnicianProfile({ name, branch }: { name: string; branch: string }) {
  return <Space direction="vertical" block className="tech-stack">
    <header className="tech-page-heading"><p className="tech-kicker">Field operations</p><h1>Profile</h1><p>Your active assessment identity and work scope.</p></header>
    <Card className="tech-detail-hero"><p className="tech-muted">Signed in as</p><h2>{name}</h2><Tag color="primary" fill="outline">Technician</Tag></Card>
    <Card title="Assignment profile"><List><List.Item description="Primary branch">{branch}</List.Item><List.Item description="Workspace">Assigned jobs only</List.Item><List.Item description="Time zone">Asia/Kuala_Lumpur</List.Item></List></Card>
    <NoticeBar color="info" content="This repository uses a mock assessment identity switcher. Production authentication and account preferences are intentionally outside this assessment." wrap />
  </Space>;
}
