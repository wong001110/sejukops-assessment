"use client";

import { HistoryOutlined, MenuOutlined, RobotOutlined, SettingOutlined } from "@ant-design/icons";
import { Alert, Button } from "antd";
import Link from "next/link";
import { useState } from "react";
import { AISettingsWorkspace } from "@/components/admin/ai-settings/ai-settings-workspace";
import { NativeAgentWorkspace } from "@/app/workspaces/[workspaceId]/native-agent-workspace";
import { OwnerSessions } from "./owner-sessions";
import styles from "./owner-console.module.css";

export type OwnerConsoleView = "workspace" | "sessions" | "settings";
type NativeWorkspaceEntry = { workspaceId: string; contextKey: string; canAssign: boolean; manualTask: "reschedule" | null };
const views = [
  { id: "workspace", label: "My Workspace", icon: <RobotOutlined />, description: "Work with your agent and review the task canvas." },
  { id: "sessions", label: "Sessions", icon: <HistoryOutlined />, description: "Browse saved conversations and their recorded results." },
  { id: "settings", label: "AI Settings", icon: <SettingOutlined />, description: "Manage the existing provider and routing settings." },
] as const;

export function OwnerConsole({ initialView = "workspace", nativeWorkspace, workspaceMessage }: {
  initialView?: OwnerConsoleView; nativeWorkspace: NativeWorkspaceEntry | null; workspaceMessage: string;
}) {
  const [view, setView] = useState<OwnerConsoleView>(initialView);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const selected = views.find((item) => item.id === view)!;
  function select(next: OwnerConsoleView) {
    setView(next); setNavigationOpen(false);
    const url = new URL(window.location.href);
    if (next === "workspace") url.searchParams.delete("view"); else url.searchParams.set("view", next);
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
  return <main className={`${styles.console} ${view === "workspace" ? styles.consoleWorkspace : ""}`}>
    <aside className={`${styles.sidebar} ${view === "workspace" ? styles.workspaceRail : ""} ${navigationOpen ? styles.navigationOpen : ""}`}>
      <Link href="/" className={styles.brand}>Sejuk<span>Ops</span></Link>
      <span className={styles.consoleLabel}>Owner Console</span>
      <nav aria-label="Owner Console navigation">{views.map((item) => <button key={item.id} type="button" title={item.label} aria-label={item.label}
        aria-current={view === item.id ? "page" : undefined} onClick={() => select(item.id)}><span aria-hidden="true">{item.icon}</span><span>{item.label}</span></button>)}</nav>
      <div className={styles.sidebarFooter}><span>Verified platform access</span><Link href="/owner">Account controls</Link>
        <Link href="/platform/staff">Staff accounts</Link><Link href="/platform/demo">Demo management</Link></div>
    </aside>
    <section className={styles.content}>
      <header className={`${styles.header} ${view === "workspace" ? styles.workspaceHeader : ""}`}>
        <Button className={styles.mobileMenu} icon={<MenuOutlined />} aria-label="Toggle console navigation"
          aria-expanded={navigationOpen} onClick={() => setNavigationOpen((open) => !open)} />
        <div><h1>{selected.label}</h1><p>{selected.description}</p></div>
        <Link className={styles.accountLink} href="/owner">Account</Link>
      </header>
      <div className={`${styles.view}${view === "workspace" ? ` ${styles.workspaceView}` : ""}`} key={view}>
        {view === "workspace" ? nativeWorkspace ? <NativeAgentWorkspace {...nativeWorkspace} isGuest={false} presentation="studio" />
          : <Alert showIcon type="warning" message="My Workspace is unavailable" description={workspaceMessage}
            action={<Button href="/owner/console">Retry</Button>} /> : null}
        {view === "sessions" ? <OwnerSessions /> : null}
        {view === "settings" ? <div className={styles.settings}><AISettingsWorkspace /></div> : null}
      </div>
    </section>
  </main>;
}
