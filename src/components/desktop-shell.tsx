"use client";

import {
  DashboardOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import { Layout, Menu, Typography } from "antd";
import type { MenuProps } from "antd";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { RoleSwitcher } from "./role-switcher";

const labels = {
  ADMIN: "Admin Operations",
  MANAGER: "Manager Operations",
} as const;

export function DesktopShell({
  role,
  identityId,
  children,
}: {
  role: "ADMIN" | "MANAGER";
  identityId: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const items: MenuProps["items"] =
    role === "ADMIN"
      ? [
          {
            type: "group",
            label: "Operations",
            children: [
              {
                key: "/admin",
                icon: <FileTextOutlined />,
                label: "Orders & scheduling",
              },
            ],
          },
          {
            type: "group",
            label: "Intelligence",
            children: [
              {
                key: "/admin/document-import",
                icon: <FileSearchOutlined />,
                label: "Document import",
              },
            ],
          },
          {
            type: "group",
            label: "Configuration",
            children: [
              {
                key: "/admin/ai-settings",
                icon: <SafetyCertificateOutlined />,
                label: "AI configuration",
              },
            ],
          },
        ]
      : [
          {
            type: "group",
            label: "Operations",
            children: [
              {
                key: "/manager/dashboard",
                icon: <DashboardOutlined />,
                label: "Dashboard",
              },
              {
                key: "/manager",
                icon: <FileTextOutlined />,
                label: "Completion review",
              },
            ],
          },
          {
            type: "group",
            label: "Intelligence",
            children: [
              {
                key: "/manager/ai-operations",
                icon: <RobotOutlined />,
                label: "AI Operations",
              },
            ],
          },
        ];

  const selectedKey =
    role === "MANAGER" && pathname.startsWith("/manager/ai-operations")
      ? "/manager/ai-operations"
      : role === "MANAGER" && pathname.startsWith("/manager/dashboard")
        ? "/manager/dashboard"
        : role === "MANAGER"
          ? "/manager"
          : pathname.startsWith("/admin/document-import")
            ? "/admin/document-import"
            : pathname.startsWith("/admin/ai-settings")
              ? "/admin/ai-settings"
              : "/admin";

  return (
    <Layout className="desktop-shell modern-desktop-shell">
      <Layout.Sider breakpoint="lg" collapsedWidth="0" width={228} theme="dark">
        <div className="brand">
          <span className="brand-mark" aria-hidden>S</span>
          <span className="brand-copy">
            <strong>SejukOps</strong>
            <small>Field Service OS</small>
          </span>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={items}
          onClick={({ key }) => key.startsWith("/") && router.push(key)}
        />
        <div className="sidebar-context">
          <strong>Assessment workspace</strong>
          <span>Operational workflows · Malaysia time</span>
          <button
            type="button"
            className="technical-review-link"
            onClick={() => router.push("/diagnostics/ai-observability")}
          >
            Technical review · AI observability →
          </button>
        </div>
      </Layout.Sider>
      <Layout>
        <Layout.Header className="desktop-header">
          <div className="workspace-context">
            <span className="workspace-context-copy">
              <Typography.Text className="workspace-eyebrow">Workspace</Typography.Text>
              <strong>{labels[role]}</strong>
            </span>
            <Typography.Text type="secondary" className="timezone-label">
              MYT · UTC+8
            </Typography.Text>
          </div>
          <RoleSwitcher currentIdentityId={identityId} />
        </Layout.Header>
        <Layout.Content className="desktop-content">{children}</Layout.Content>
      </Layout>
    </Layout>
  );
}
