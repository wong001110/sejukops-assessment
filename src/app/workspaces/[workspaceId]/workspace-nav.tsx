"use client";

import { AppstoreOutlined, BookOutlined, HomeOutlined, RobotOutlined, ScheduleOutlined, UnorderedListOutlined } from "@ant-design/icons";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { MouseEvent } from "react";
import type { AppRole } from "@/lib/auth/types";
import { operationsModeHref, operationsNavItems } from "./operations-nav-policy";

const icons = { overview: <AppstoreOutlined aria-hidden />, orders: <UnorderedListOutlined aria-hidden />, assignment: <ScheduleOutlined aria-hidden />, schedule: <ScheduleOutlined aria-hidden />, knowledge: <BookOutlined aria-hidden /> };

export function WorkspaceNav({ base, role, canUseAi, canAssign, isGuest, readOnly = false, placement = "all" }: {
  base: string; role: AppRole; canUseAi: boolean; canAssign: boolean; isGuest: boolean; readOnly?: boolean; placement?: "all" | "modes" | "sidebar";
}) {
  const pathname = usePathname();
  const router = useRouter();
  const agentMode = pathname === `${base}/agent`;
  function switchMode(event: MouseEvent<HTMLAnchorElement>, mode: "operations" | "agent") {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const destination = operationsModeHref(base, mode, new URLSearchParams(window.location.search).get("orderId"));
    if (destination !== event.currentTarget.getAttribute("href")) { event.preventDefault(); router.push(destination); }
  }
  const links = operationsNavItems({ base, role, canAssign, isGuest, readOnly });
  return <>
    {placement !== "sidebar" && <div className="workspace-navigation-groups">
      <nav aria-label="Interaction mode" className="workspace-modes">
        <Link href={`${base}/overview`} aria-current={!agentMode ? "page" : undefined} onClick={(event) => switchMode(event, "operations")}><AppstoreOutlined aria-hidden /> Operations</Link>
        {canUseAi && <Link href={`${base}/agent`} aria-current={agentMode ? "page" : undefined} onClick={(event) => switchMode(event, "agent")}><RobotOutlined aria-hidden /> AI Workspace</Link>}
      </nav>
      {agentMode && <Link className="workspace-home-link" href={isGuest ? "/demo" : "/"}><HomeOutlined aria-hidden /> {isGuest ? "Demo" : "Home"}</Link>}
    </div>}
    {placement !== "modes" && !agentMode && <aside className="operations-sidebar" aria-label="Operations portal">
      <div className="operations-sidebar-heading"><span>OPERATIONS</span><strong>{role === "ADMIN" ? "Admin portal" : role === "MANAGER" ? "Manager portal" : "Technician portal"}</strong></div>
      <nav aria-label="Workspace" className="workspace-nav">
        {links.map(({ href, label, section }) => <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined}>{icons[section]} {label}</Link>)}
      </nav>
      <Link className="workspace-home-link operations-sidebar-home" href={isGuest ? "/demo" : "/"}><HomeOutlined aria-hidden /> {isGuest ? "Demo" : "Home"}</Link>
    </aside>}
  </>;
}
