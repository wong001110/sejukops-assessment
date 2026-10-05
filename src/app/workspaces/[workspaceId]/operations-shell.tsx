"use client";

import { BookOutlined, DashboardOutlined, FileTextOutlined, ScheduleOutlined } from "@ant-design/icons";
import { AppOutline } from "antd-mobile-icons";
import { NavBar } from "antd-mobile";
import { Layout, Menu, Typography } from "antd";
import type { MenuProps } from "antd";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import type { AppRole } from "@/lib/auth/types";
import { WorkspaceNav } from "./workspace-nav";
import { OperationsAssistant } from "./operations-assistant";

export function OperationsShell({ base, role, canUseAi, canAssign, isGuest, readOnly, contextKey, header, children }: {
  base: string; role: AppRole; canUseAi: boolean; canAssign: boolean; isGuest: boolean; readOnly: boolean; contextKey?: string; header: ReactNode; children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const navigation = { base, role, canUseAi, canAssign, isGuest, readOnly };
  const assistant = <OperationsAssistant key={`${base}:${role}:${readOnly}:${isGuest}:${canUseAi}:${contextKey ?? "session"}:${pathname}`}
    workspaceId={base.split("/").at(-1)!} role={role} canUseAi={canUseAi} readOnly={readOnly} isGuest={isGuest}
    />;

  // Preserve the current native workspace chrome and its full-width canvas.
  if (pathname === `${base}/agent`) return <div className="workspace-shell ai-workspace-shell">
    <header className="workspace-header"><div className="workspace-header-inner">{header}<WorkspaceNav {...navigation} placement="modes" /></div></header>
    <div className="workspace-body"><WorkspaceNav {...navigation} placement="sidebar" /><div className="workspace-content">{children}</div></div>
  </div>;

  if (role === "TECHNICIAN") {
    const items = [
      { key: "dashboard", href: `${base}/overview`, label: "Dashboard", icon: <DashboardOutlined aria-hidden /> },
      { key: "jobs", href: `${base}/orders`, label: "My jobs", icon: <AppOutline aria-hidden /> },
      { key: "knowledge", href: `${base}/knowledge`, label: "Knowledge", icon: <BookOutlined aria-hidden /> },
    ];
    return <div className="technician-shell operations-tech-shell">
      <NavBar back={null}><span className="technician-mobile-brand"><span className="technician-brand-mark" aria-hidden>S</span><span className="technician-mobile-brand-copy"><strong>SejukOps Field</strong><span>Technician workspace</span></span></span></NavBar>
      <div className="technician-role-bar operations-role-controls">{header}<WorkspaceNav {...navigation} placement="modes" /></div>
      <section className="technician-content">{children}</section>
      <nav className="technician-tabs" aria-label="Technician navigation">{items.map((item) => <Link key={item.key} href={item.href} className={`technician-tab-link${pathname === item.href ? " technician-tab-link-active" : ""}`} aria-current={pathname === item.href ? "page" : undefined}>{item.icon}<span>{item.label}</span></Link>)}</nav>
      {assistant}
    </div>;
  }

  const items: MenuProps["items"] = role === "ADMIN" ? [
    { type: "group", label: "Operations", children: [
      { key: `${base}/overview`, icon: <DashboardOutlined aria-hidden />, label: "Dashboard" },
      { key: `${base}/orders`, icon: <FileTextOutlined aria-hidden />, label: "Orders & scheduling" },
      ...(canAssign && !isGuest && !readOnly ? [{ key: `${base}/assignment`, icon: <ScheduleOutlined aria-hidden />, label: "Assignment" }] : []),
    ] },
    { type: "group", label: "Intelligence", children: [
      { key: `${base}/knowledge`, icon: <BookOutlined aria-hidden />, label: "Knowledge" },
    ] },
  ] : [
    { type: "group", label: "Operations", children: [
      { key: `${base}/overview`, icon: <DashboardOutlined aria-hidden />, label: "Dashboard" },
      { key: `${base}/orders`, icon: <FileTextOutlined aria-hidden />, label: "Orders" },
      ...(!readOnly ? [{ key: `${base}/schedule`, icon: <ScheduleOutlined aria-hidden />, label: "Schedule" }] : []),
    ] },
    { type: "group", label: "Intelligence", children: [
      { key: `${base}/knowledge`, icon: <BookOutlined aria-hidden />, label: "Knowledge" },
    ] },
  ];
  const selectedKey = pathname === `${base}/knowledge` ? `${base}/knowledge`
    : pathname === `${base}/assignment` ? `${base}/assignment`
      : pathname === `${base}/schedule` ? `${base}/schedule`
        : pathname === `${base}/overview` ? `${base}/overview` : `${base}/orders`;
  return <Layout className="desktop-shell modern-desktop-shell operations-legacy-shell">
    <Layout.Sider breakpoint="lg" collapsedWidth="0" width={228} theme="dark">
      <div className="brand"><span className="brand-mark" aria-hidden>S</span><span className="brand-copy"><strong>SejukOps</strong><small>Field Service OS</small></span></div>
      <Menu theme="dark" mode="inline" selectedKeys={[selectedKey]} items={items} onClick={({ key }) => {
        if (key.startsWith(`${base}/`)) router.push(key);
      }} />
      <div className="sidebar-context"><strong>{isGuest ? "Demo workspace" : "Operations workspace"}</strong><span>Operational workflows · Malaysia time</span><Link className="operations-home-link" href={isGuest ? "/demo" : "/"}>{isGuest ? "Demo" : "Home"} →</Link></div>
    </Layout.Sider>
    <Layout>
      <Layout.Header className="desktop-header">
        <div className="workspace-context"><span className="workspace-context-copy"><Typography.Text className="workspace-eyebrow">Workspace</Typography.Text><strong>{role === "ADMIN" ? "Admin Operations" : "Manager Operations"}</strong></span><Typography.Text type="secondary" className="timezone-label">MYT · UTC+8</Typography.Text></div>
        <WorkspaceNav {...navigation} placement="modes" />
      </Layout.Header>
      <div className="operations-role-controls">{header}</div>
      <Layout.Content className="desktop-content">{children}</Layout.Content>
    </Layout>
    {assistant}
  </Layout>;
}
