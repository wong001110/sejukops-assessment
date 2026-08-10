import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const completion = readFileSync(
  resolve("src/lib/services/technician-completion/service.ts"),
  "utf8",
);
const notifications = readFileSync(
  resolve("src/lib/services/completion-notifications/service.ts"),
  "utf8",
);
const manager = readFileSync(
  resolve("src/lib/services/manager-review/service.ts"),
  "utf8",
);
const technicianOpenRoute = readFileSync(
  resolve("src/app/api/technician/jobs/[id]/whatsapp/open/route.ts"),
  "utf8",
);
const adminOpenRoute = readFileSync(
  resolve("src/app/api/admin/orders/[id]/whatsapp/open/route.ts"),
  "utf8",
);
const openResponses = readFileSync(
  resolve("src/app/api/_shared/whatsapp-open.ts"),
  "utf8",
);

describe("Phase 4 server boundaries", () => {
  it("commits completion before isolated notification preparation", () => {
    const complete = completion.slice(completion.indexOf("function completeTechnicianJob"));
    expect(complete.indexOf('rpc(\n    "technician_complete_job_with_receipt"')).toBeLessThan(
      complete.indexOf("prepareCompletionWhatsApp"),
    );
    expect(complete).toContain("try {");
    expect(complete).toContain("WHATSAPP_PREPARATION_FAILED");
    expect(complete).toContain("Core completion is already committed");
  });

  it("makes the user-click POST a preparation-failure retry before OPENED", () => {
    const open = notifications.slice(notifications.indexOf("function openCompletionWhatsApp"));
    expect(open.indexOf('"prepare_completion_whatsapp"')).toBeLessThan(
      open.indexOf('"open_completion_whatsapp"'),
    );
    expect(open).toContain("manual retry");
    expect(technicianOpenRoute).toContain("whatsappOpenResponse");
    expect(technicianOpenRoute).not.toContain("export async function GET");
    expect(openResponses).toContain("application/x-www-form-urlencoded");
    expect(openResponses).toContain("NextResponse.redirect(notification.url, 303)");
    expect(openResponses).toContain("NextResponse.json({ notification, url: notification.url })");
  });

  it("requires active DB profiles before privileged broad reads", () => {
    expect(manager).toContain('.from("profiles")');
    expect(manager).toContain('.eq("role", "MANAGER")');
    expect(manager).toContain('.eq("active", true)');
    expect(notifications).toContain('.eq("role", context.identity.role)');
    expect(notifications).toContain('.eq("active", true)');
  });

  it("keeps Technician reads assignment-scoped and office actions role-scoped", () => {
    expect(notifications).toContain('.eq("assigned_technician_id", technicianId)');
    expect(technicianOpenRoute).toContain('["TECHNICIAN"]');
    expect(adminOpenRoute).toContain('["ADMIN"]');
    expect(manager).toContain('context.identity.role !== "MANAGER"');
  });

  it("serves compact JOB_DONE queue data and private signed evidence", () => {
    expect(manager).toContain('.eq("status", "JOB_DONE")');
    expect(manager).toContain("item.serviceType");
    expect(manager).toContain("createSignedUrl");
    expect(manager).toContain('from("service_attachments")');
    expect(manager).toContain('from("payments")');
    expect(manager).toContain('from("audit_logs")');
    expect(manager).toContain('from("ai_flags")');
  });

  it("selects the latest revision notification and hides superseded receipt staging", () => {
    expect(notifications).toContain('.order("generated_at", { ascending: false })');
    expect(notifications).toContain(".limit(1)");
    expect(manager).toContain('.order("generated_at", { ascending: false })');
    expect(completion).toContain("SUPERSEDED_BY_CLARIFICATION");
  });
});
