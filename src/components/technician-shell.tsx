"use client";

import { AppOutline, ClockCircleOutline, UserOutline } from "antd-mobile-icons";
import { NavBar } from "antd-mobile";
import Link from "next/link";
import type { ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { RoleSwitcher } from "./role-switcher";

export function TechnicianShell({ identityId, children }: { identityId: string; children: ReactNode }) {
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab");
  const activeKey = tab === "history" || tab === "profile" ? tab : "jobs";
  const items = [
    { key: "jobs", href: "/technician", label: "My jobs", icon: <AppOutline aria-hidden /> },
    { key: "history", href: "/technician?tab=history", label: "History", icon: <ClockCircleOutline aria-hidden /> },
    { key: "profile", href: "/technician?tab=profile", label: "Profile", icon: <UserOutline aria-hidden /> },
  ] as const;
  return <main className="technician-shell"><NavBar back={null}>SejukOps Field</NavBar><div className="technician-role-bar"><RoleSwitcher currentIdentityId={identityId} /></div><section className="technician-content">{children}</section><nav className="technician-tabs" aria-label="Technician navigation">{items.map((item) => <Link key={item.key} href={item.href} className={`technician-tab-link${activeKey === item.key ? " technician-tab-link-active" : ""}`} aria-current={activeKey === item.key ? "page" : undefined}>{item.icon}<span>{item.label}</span></Link>)}</nav></main>;
}
