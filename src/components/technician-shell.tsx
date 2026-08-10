"use client";

import { AppOutline, ClockCircleOutline, UserOutline } from "antd-mobile-icons";
import { NavBar, TabBar } from "antd-mobile";
import type { ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RoleSwitcher } from "./role-switcher";

export function TechnicianShell({ identityId, children }: { identityId: string; children: ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab");
  const activeKey = tab === "history" || tab === "profile" ? tab : "jobs";
  const navigate = (key: string) => router.push(key === "jobs" ? "/technician" : `/technician?tab=${key}`);
  return <main className="technician-shell"><NavBar back={null}>SejukOps Field</NavBar><div className="technician-role-bar"><RoleSwitcher currentIdentityId={identityId} /></div><section className="technician-content">{children}</section><TabBar className="technician-tabs" activeKey={activeKey} onChange={navigate}><TabBar.Item key="jobs" icon={<AppOutline />} title="My jobs" /><TabBar.Item key="history" icon={<ClockCircleOutline />} title="History" /><TabBar.Item key="profile" icon={<UserOutline />} title="Profile" /></TabBar></main>;
}
