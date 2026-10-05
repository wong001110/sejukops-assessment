"use client";

import { AppstoreOutlined, BookOutlined, HomeOutlined, RobotOutlined, ScheduleOutlined } from "@ant-design/icons";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { MouseEvent } from "react";
import { parseOrderFocusId } from "./agent/order-focus";

export function WorkspaceNav({ base, canUseAi, canAssign, isGuest }: {
  base: string; canUseAi: boolean; canAssign: boolean; isGuest: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const agentMode = pathname === `${base}/agent`;
  function switchMode(event: MouseEvent<HTMLAnchorElement>, destination: string) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const orderId = parseOrderFocusId(new URLSearchParams(window.location.search).get("orderId") ?? undefined);
    if (orderId) { event.preventDefault(); router.push(`${destination}?orderId=${encodeURIComponent(orderId)}`); }
  }
  const links = [
    { href: `${base}/orders`, label: "Orders", icon: <AppstoreOutlined /> },
    ...(canAssign ? [{ href: `${base}/assignment`, label: "Assignment", icon: <ScheduleOutlined /> }] : []),
    { href: `${base}/knowledge`, label: "Knowledge", icon: <BookOutlined /> },
    { href: isGuest ? "/demo" : "/", label: isGuest ? "Demo" : "Home", icon: <HomeOutlined /> },
  ];
  return <div className="workspace-navigation-groups">
    {canUseAi && <nav aria-label="Interaction mode" className="workspace-modes">
      <Link href={`${base}/orders`} aria-current={!agentMode ? "page" : undefined} onClick={(event) => switchMode(event, `${base}/orders`)}><AppstoreOutlined /> Traditional + AI Assist</Link>
      <Link href={`${base}/agent`} aria-current={agentMode ? "page" : undefined} onClick={(event) => switchMode(event, `${base}/agent`)}><RobotOutlined /> Agent Workspace</Link>
    </nav>}
    <nav aria-label="Workspace" className="workspace-nav">
    {links.filter((link) => !agentMode || link.href === "/" || link.href === "/demo").map(({ href, label, icon }) => <Link key={href} href={href}
      aria-current={pathname === href ? "page" : undefined}>{icon} {label}</Link>)}
    </nav>
  </div>;
}
