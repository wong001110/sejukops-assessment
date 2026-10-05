import { Component, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { ConfigProvider } from "antd";
import { OrdersWorkspace, AgentWorkspace } from "../../src/app/workspaces/[workspaceId]/workspace-client";
import { KnowledgeWorkspace } from "../../src/app/workspaces/[workspaceId]/knowledge/workspace";
import AssignmentProposalPage from "../../src/app/workspaces/[workspaceId]/assignment/workspace";
import { AISettingsWorkspace } from "../../src/components/admin/ai-settings/ai-settings-workspace";
import { DemoResetCard } from "../../src/components/admin/demo-reset/demo-reset-card";
import { GuestAiBudgetCard } from "../../src/components/admin/guest-ai-budget/guest-ai-budget-card";
import { StaffAccountsWorkspace } from "../../src/components/admin/staff-accounts/staff-accounts-workspace";
import { OwnerPreviewPanel } from "../../src/components/admin/owner-preview/owner-preview-panel";
import { WorkspaceNav } from "../../src/app/workspaces/[workspaceId]/workspace-nav";
import { OperationsOverview } from "../../src/app/workspaces/[workspaceId]/operations-overview";
import { getMockOwnerPreview } from "./owner-preview-handlers";
import { ids } from "../fixtures/ui/workspace";
import { navigatePreview } from "./next-navigation";
import { getScenario, resetMock, scenarios, worker, type Scenario } from "./handlers";
import "antd/dist/reset.css";
import "../../src/styles/globals.css";
import "../../src/styles/ui-polish.css";
import "../../src/styles/ui-refinements.css";
import "../../src/styles/ui-semantic-status.css";
import "../../src/styles/ui-modern-refresh.css";
import "../../src/styles/ui-modern-refresh-tuning.css";
import "../../src/styles/ui-diagnostics.css";
import "../../src/styles/ui-diagnostics-runtime.css";
import "../../src/styles/ui-status-tag.css";
import "../../src/styles/ui-form-sizing.css";
import "../../src/styles/ui-product.css";
import "../../src/styles/ui-agent-workspace.css";
import "../../src/styles/ui-operations-portal.css";
import "./preview.css";

const tabs = ["overview", "orders", "schedule", "agent", "knowledge", "assignment", "ai-settings", "platform", "staff", "owner"] as const;
type Tab = (typeof tabs)[number];
const labels: Record<Tab, string> = { overview: "Overview", orders: "Orders", schedule: "Schedule", agent: "AI Workspace", knowledge: "Knowledge", assignment: "Assignment", "ai-settings": "AI Settings", platform: "Platform", staff: "Staff", owner: "Owner" };
type Persona = "owner-admin" | "guest-admin" | "guest-manager" | "guest-technician" | "staff-admin" | "staff-manager" | "staff-technician";
function tabFromLocation(): Tab {
  return tabs.find((tab) => window.location.pathname.endsWith(`/${tab}`)) ?? "orders";
}
function Preview() {
  const [tab, setTab] = useState(tabFromLocation);
  const [locationKey, setLocationKey] = useState(window.location.pathname + window.location.search);
  const [scenario, setScenario] = useState(getScenario);
  const [persona, setPersona] = useState<Persona>("owner-admin");
  const [epoch, setEpoch] = useState(0);
  const [notices, setNotices] = useState<string[]>([]);
  const [unexpectedRequest, setUnexpectedRequest] = useState("");
  const [refreshes, setRefreshes] = useState(0);
  const [ownerPreview, setOwnerPreview] = useState(getMockOwnerPreview);
  const [previewMode, setPreviewMode] = useState(() => window.location.pathname.endsWith("/owner"));
  useEffect(() => {
    const navigation = () => { setTab(tabFromLocation()); setLocationKey(window.location.pathname + window.location.search); };
    const apiNotice = (event: Event) => {
      const message = String((event as CustomEvent).detail);
      setNotices((previous) => [message, ...previous].slice(0, 8));
      if (message.startsWith("Missing MOCK") || message.startsWith("MOCK blocked")) setUnexpectedRequest(message);
    };
    const refresh = () => setRefreshes((value) => value + 1);
    const perspective = () => { const next = getMockOwnerPreview(); setOwnerPreview(next); if (next) setPreviewMode(true); };
    window.addEventListener("popstate", navigation);
    window.addEventListener("mock-api-notice", apiNotice);
    window.addEventListener("mock-router-refresh", refresh);
    window.addEventListener("mock-owner-preview", perspective);
    return () => { window.removeEventListener("popstate", navigation); window.removeEventListener("mock-api-notice", apiNotice); window.removeEventListener("mock-router-refresh", refresh); window.removeEventListener("mock-owner-preview", perspective); };
  }, []);
  const isGuest = persona.startsWith("guest-");
  const role = persona.endsWith("technician") ? "TECHNICIAN" : persona.endsWith("manager") ? "MANAGER" : "ADMIN";
  const canCreate = role === "ADMIN";
  const canUseAi = role !== "TECHNICIAN" && !ownerPreview;
  const focusOrderId = new URLSearchParams(window.location.search).get("orderId") ?? undefined;
  function switchScenario(next: Scenario) {
    resetMock(next); setScenario(next); setEpoch((value) => value + 1); setNotices([]); setUnexpectedRequest("");
    window.history.replaceState(null, "", window.location.pathname);
    setLocationKey(window.location.pathname);
  }
  return <ConfigProvider><div className="mock-shell">
    <header className="mock-controls">
      <strong>MOCK DATA — not connected to Supabase or paid AI</strong>
      {unexpectedRequest && <p role="alert">{unexpectedRequest}</p>}
      <p>Actual application components · fictional in-memory API responses · browser UI evidence only</p>
      <div className="mock-control-row">
        <label>Mock scenario <select aria-label="Mock scenario" value={scenario} onChange={(event) => switchScenario(event.target.value as Scenario)}>
          {scenarios.map((value) => <option key={value} value={value}>{value}</option>)}
        </select></label>
        <label>Mock persona <select aria-label="Mock persona" value={persona} onChange={(event) => { setPersona(event.target.value as Persona); setEpoch((value) => value + 1); }}>
          <option value="owner-admin">Owner Admin (UI only)</option><option value="guest-admin">Guest Admin (UI only)</option>
          <option value="guest-manager">Guest Manager (UI only)</option><option value="guest-technician">Guest Technician (UI only)</option>
          <option value="staff-admin">Admin (UI only)</option><option value="staff-manager">Manager (UI only)</option><option value="staff-technician">Technician (UI only)</option>
        </select></label>
        <button onClick={() => switchScenario(scenario)}>Reset mock records</button>
      </div>
      <nav aria-label="Mock preview pages">{tabs.map((value) => <button key={value} aria-current={value === tab ? "page" : undefined}
        onClick={() => navigatePreview(value === "ai-settings" ? "/admin/ai-settings" : value === "platform" ? "/platform" : `/workspaces/${ids.workspace}/${value}`)}>{labels[value]}</button>)}</nav>
      <details><summary>Mock request activity ({notices.length}) · router refresh signals: {refreshes}</summary>
        <ul>{notices.map((notice, index) => <li key={index}>{notice}</li>)}</ul>
      </details>
    </header>
    <WorkspaceNav base={`/workspaces/${ids.workspace}`} canUseAi={Boolean(canUseAi)} canAssign={!isGuest && role === "ADMIN" && !ownerPreview} isGuest={isGuest} role={role} readOnly={Boolean(ownerPreview)} placement="modes" />
    <div className="workspace-body"><WorkspaceNav base={`/workspaces/${ids.workspace}`} canUseAi={Boolean(canUseAi)} canAssign={!isGuest && role === "ADMIN" && !ownerPreview} isGuest={isGuest} role={role} readOnly={Boolean(ownerPreview)} placement="sidebar" />
    <div key={`${epoch}:${persona}:${tab}:${locationKey}`} className="mock-component workspace-content" data-mock-scenario={scenario}>
      {tab === "overview" && <OperationsOverview workspaceId={ids.workspace} role={role} isGuest={isGuest} readOnly={Boolean(ownerPreview)} canAssign={!isGuest && role === "ADMIN" && !ownerPreview} />}
      {tab === "owner" && <main className="workspace-main"><h1>Owner account — MOCK</h1><OwnerPreviewPanel workspaceId={ids.workspace} initialPreview={ownerPreview} /></main>}
      {tab === "orders" && previewMode && <OwnerPreviewPanel workspaceId={ids.workspace} initialPreview={ownerPreview} />}
      {(tab === "orders" || tab === "schedule") && <OrdersWorkspace key={`${persona}:${ownerPreview?.previewId ?? "normal"}`} role={role} workspaceId={ids.workspace} presentation={tab === "schedule" ? "schedule" : "orders"} canAssign={!isGuest && role === "ADMIN" && !ownerPreview} canImport={canCreate && !ownerPreview && tab !== "schedule"} canCreate={canCreate && !ownerPreview && tab !== "schedule"} canUseAi={Boolean(canUseAi)} technicianLabel={ownerPreview?.role === "TECHNICIAN" ? ownerPreview.effectiveEmployeeName ?? undefined : undefined}
        isGuest={isGuest} canGuestAssign={persona === "guest-admin"} canManagerReschedule={role === "MANAGER" && !ownerPreview} canAdvanceJob={role === "TECHNICIAN" && !ownerPreview} />}
      {tab === "agent" && <AgentWorkspace workspaceId={ids.workspace} contextKey={persona} focusOrderId={focusOrderId} canAssign={!isGuest && role === "ADMIN" && !ownerPreview}
        manualTask={!ownerPreview && role === "ADMIN" && isGuest ? "assign" : !ownerPreview && role === "MANAGER" ? "reschedule" : null} isGuest={isGuest} />}
      {tab === "knowledge" && <KnowledgeWorkspace workspaceId={ids.workspace} canEdit={!isGuest && role !== "TECHNICIAN" && !ownerPreview} isDemo={isGuest} />}
      {tab === "assignment" && <AssignmentProposalPage />}
      {tab === "ai-settings" && <AISettingsWorkspace />}
      {tab === "staff" && <StaffAccountsWorkspace workspaceId={ids.workspace} />}
      {tab === "platform" && <main className="workspace-main" style={{ maxWidth: 1000 }}>
        <h1>Platform controls — MOCK only</h1>
        <p>These actual controls operate on fictional browser memory. Mock personas do not establish platform authorization.</p>
        <div className="workspace-fields"><DemoResetCard /><GuestAiBudgetCard /></div>
      </main>}
    </div></div>
    <footer className="mock-footer">Mock personas configure presentation only. This preview cannot verify real authentication, permissions, isolation, model quality, database transactions, PDF parsing, or embeddings.</footer>
  </div></ConfigProvider>;
}

class PreviewBoundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: "" };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() { return this.state.error ? <div role="alert" className="mock-fatal"><h1>MOCK component rendering failed</h1><p>{this.state.error}</p><p>Reload after correcting the component error.</p></div> : this.props.children; }
}
async function start() {
  const element = document.getElementById("root")!;
  try {
    if (window.location.hostname !== "localhost" || window.location.port !== "3200") throw new Error("This preview is restricted to localhost:3200.");
    await worker.start({ quiet: true, serviceWorker: { url: "/mockServiceWorker.js" }, onUnhandledRequest(request, print) {
      const url = new URL(request.url);
      if (url.origin !== window.location.origin || url.pathname.startsWith("/api/")) print.error();
    } });
    createRoot(element).render(<PreviewBoundary><Preview /></PreviewBoundary>);
  } catch (error) {
    // Do not render request-making components if interception fails.
    element.replaceChildren();
    const alert = document.createElement("div"); alert.setAttribute("role", "alert"); alert.className = "mock-fatal";
    alert.textContent = `MOCK preview startup failed: ${error instanceof Error ? error.message : String(error)}. Application components were not rendered.`;
    element.append(alert);
  }
}
void start();
