"use client";

import { RobotOutlined } from "@ant-design/icons";
import { Button, Drawer, FloatButton, Segmented } from "antd";
import dynamic from "next/dynamic";
import { useState } from "react";
import type { AppRole } from "@/lib/auth/types";
import { KnowledgeAssistPanel } from "./knowledge-assist-panel";
import "./operations-assistant.css";

const OrderAssistPanel = dynamic(() => import("./workspace-client").then((module) => module.OrderAssistPanel), {
  loading: () => <p role="status">Loading order assistant…</p>,
});

export function OperationsAssistant({ workspaceId, role, canUseAi, isGuest, readOnly, initialTask = "orders" }: {
  workspaceId: string; role: AppRole; canUseAi: boolean; isGuest: boolean; readOnly: boolean;
  initialTask?: "orders" | "knowledge";
}) {
  const [open, setOpen] = useState(false);
  const [task, setTask] = useState<"orders" | "knowledge">(role === "TECHNICIAN" ? "knowledge" : initialTask);
  const [revision, setRevision] = useState(0);

  if ((!canUseAi && role !== "TECHNICIAN") || readOnly) return null;

  return <>
    <FloatButton type="primary" shape="square" icon={<RobotOutlined aria-hidden />}
      description="Ask AI" aria-label="Open Operations Ask AI" aria-expanded={open}
      className={`operations-assistant-button${role === "TECHNICIAN" ? " operations-assistant-button-tech" : ""}`}
      onClick={() => setOpen((current) => !current)} />
    <Drawer open={open} placement="right" width={460} mask={false}
      title="Operations · Ask AI" rootClassName={`operations-assistant-drawer${role === "TECHNICIAN" ? " operations-assistant-drawer-tech" : ""}`}
      onClose={() => setOpen(false)} extra={<Button onClick={() => setRevision((current) => current + 1)}>Start over</Button>}>
      {open && <div key={`${workspaceId}:${role}:${isGuest}:${revision}`}>
        <p className="product-muted">{role === "TECHNICIAN" ? "Find cited guidance from published workspace knowledge." : "Ask about orders visible to your role or find cited knowledge."} This assistant reads evidence; continue operational changes in the relevant page.</p>
        {role !== "TECHNICIAN" && <Segmented aria-label="Ask AI topic" block value={task}
          options={[{ label: "Orders", value: "orders" }, { label: "Knowledge", value: "knowledge" }]}
          onChange={(value) => setTask(value as "orders" | "knowledge")} />}
        <div className="operations-assistant-content">
          {task === "knowledge" ? <KnowledgeAssistPanel workspaceId={workspaceId} isGuest={isGuest} />
            : <OrderAssistPanel workspaceId={workspaceId} isGuest={isGuest} />}
        </div>
      </div>}
    </Drawer>
  </>;
}
