"use client";

import { AppOutline, ClockCircleOutline, UserOutline } from "antd-mobile-icons";
import { NavBar, TabBar } from "antd-mobile";
import type { ReactNode } from "react";
import { RoleSwitcher } from "./role-switcher";

export function TechnicianShell({ identityId, name, children }: { identityId: string; name: string; children: ReactNode }) {
  return <main className="technician-shell"><NavBar back={null}>SejukOps Field</NavBar><div className="technician-role-bar"><RoleSwitcher currentIdentityId={identityId} /></div><section className="technician-content">{children}</section><TabBar className="technician-tabs" activeKey="jobs"><TabBar.Item key="jobs" icon={<AppOutline />} title="My jobs" /><TabBar.Item key="history" icon={<ClockCircleOutline />} title="History" /><TabBar.Item key="profile" icon={<UserOutline />} title={name} /></TabBar></main>;
}
