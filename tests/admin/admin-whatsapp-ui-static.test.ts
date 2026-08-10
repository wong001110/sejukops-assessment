import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const workspace = readFileSync(resolve("src/components/admin/order-workspace.tsx"), "utf8");

describe("Admin WhatsApp follow-up UI", () => {
  it("offers a truthful user-initiated reopen action only after completion", () => {
    expect(workspace).toContain("function AdminWhatsAppOpenForm");
    expect(workspace).toContain('method="post"');
    expect(workspace).toContain('target="_blank"');
    expect(workspace).toContain("/api/admin/orders/${orderId}/whatsapp/open");
    expect(workspace).toContain('["JOB_DONE", "REVIEWED", "CLOSED"].includes(detail.order.status)');
    expect(workspace).toContain("Open customer WhatsApp");
  });

  it("keeps the follow-up request key stable while the open drawer is retried", () => {
    expect(workspace).toContain("const whatsappOpenKeys = useRef(new Map<string, string>())");
    expect(workspace).toContain("whatsappOpenKeys.current.get(detail.order.id)");
  });

  it("drops the per-order key when closing detail so a later completion gets a fresh notification audit key", () => {
    expect(workspace).toContain("whatsappOpenKeys.current.delete(detail.order.id)");
  });
});
