"use client";

import { DashboardOutlined, FileTextOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { Layout, Menu, Typography } from "antd";
import type { ReactNode } from "react";
import { RoleSwitcher } from "./role-switcher";

const labels = { ADMIN: "Admin Operations", MANAGER: "Manager Review" } as const;
export function DesktopShell({ role, identityId, children }: { role: "ADMIN" | "MANAGER"; identityId: string; children: ReactNode }) {
  const items = role === "ADMIN"
    ? [{ key: "orders", icon: <FileTextOutlined />, label: "Orders & scheduling" }, { key: "settings", icon: <SafetyCertificateOutlined />, label: "AI settings (coming soon)" }]
    : [{ key: "dashboard", icon: <DashboardOutlined />, label: "Dashboard (coming soon)" }, { key: "reviews", icon: <FileTextOutlined />, label: "Review queue (coming soon)" }];
  return <Layout className="desktop-shell"><Layout.Sider breakpoint="lg" collapsedWidth="0" width={244} theme="dark"><div className="brand">Sejuk<span>Ops</span></div><Menu theme="dark" mode="inline" selectedKeys={[items[0].key]} items={items} /></Layout.Sider><Layout><Layout.Header className="desktop-header"><div><Typography.Text strong>{labels[role]}</Typography.Text><Typography.Text type="secondary" className="timezone-label">Malaysia time · MYT</Typography.Text></div><RoleSwitcher currentIdentityId={identityId} /></Layout.Header><Layout.Content className="desktop-content">{children}</Layout.Content></Layout></Layout>;
}
