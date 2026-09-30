"use client";

import { AppstoreOutlined, BookOutlined, HomeOutlined, RobotOutlined, ScheduleOutlined } from "@ant-design/icons";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function WorkspaceNav({ base, canUseAi, canAssign, isGuest }: {
  base: string; canUseAi: boolean; canAssign: boolean; isGuest: boolean;
}) {
  const pathname = usePathname();
  const links = [
    { href: `${base}/orders`, label: "Orders", icon: <AppstoreOutlined /> },
    ...(canUseAi ? [{ href: `${base}/agent`, label: "Agent", icon: <RobotOutlined /> }] : []),
    ...(canAssign ? [{ href: `${base}/assignment`, label: "Assignment", icon: <ScheduleOutlined /> }] : []),
    { href: `${base}/knowledge`, label: "Knowledge", icon: <BookOutlined /> },
    { href: isGuest ? "/demo" : "/", label: isGuest ? "Demo" : "Home", icon: <HomeOutlined /> },
  ];
  return <nav aria-label="Workspace" className="workspace-nav">
    {links.map(({ href, label, icon }) => <Link key={href} href={href}
      aria-current={pathname === href ? "page" : undefined}>{icon} {label}</Link>)}
  </nav>;
}
