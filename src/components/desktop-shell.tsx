"use client";

import { DashboardOutlined, FileTextOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { Layout, Menu, Typography } from "antd";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { RoleSwitcher } from "./role-switcher";

const labels = { ADMIN: "Admin Operations", MANAGER: "Manager Operations" } as const;

export function DesktopShell({ role, identityId, children }: { role: "ADMIN" | "MANAGER"; identityId: string; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const items = role === "ADMIN"
    ? [{ key: "/admin", icon: <FileTextOutlined />, label: "Orders & scheduling" }, { key: "settings", icon: <SafetyCertificateOutlined />, label: "AI settings (coming soon)", disabled: true }]
    : [{ key: "/manager", icon: <FileTextOutlined />, label: "Completion review" }, { key: "/manager/dashboard", icon: <DashboardOutlined />, label: "Dashboard" }];
  const selectedKey = role === "MANAGER" && pathname.startsWith("/manager/dashboard") ? "/manager/dashboard" : role === "MANAGER" ? "/manager" : "/admin";

  return <Layout className="desktop-shell"><Layout.Sider breakpoint="lg" collapsedWidth="0" width={244} theme="dark"><div className="brand">Sejuk<span>Ops</span></div><Menu theme="dark" mode="inline" selectedKeys={[selectedKey]} items={items} onClick={({ key }) => key.startsWith("/") && router.push(key)} /></Layout.Sider><Layout><Layout.Header className="desktop-header"><div><Typography.Text strong>{labels[role]}</Typography.Text><Typography.Text type="secondary" className="timezone-label">Malaysia time · MYT</Typography.Text></div><RoleSwitcher currentIdentityId={identityId} /></Layout.Header><Layout.Content className="desktop-content">{children}</Layout.Content></Layout></Layout>;
}
