import { describe, expect, it } from "vitest";

import { DeepLinkWhatsAppAdapter } from "@/lib/services/completion-notifications/whatsapp-adapter";

const adapter = new DeepLinkWhatsAppAdapter();

describe("deep-link WhatsApp adapter", () => {
  it("normalizes a Malaysian local number and URL-encodes the authoritative message", () => {
    const notification = adapter.toNotification({
      id: "notification-1",
      orderId: "order-1",
      recipient: "012-345 6789",
      message: "Hi A & B,\nJob ORD-2026-0041 is done.",
      status: "READY",
      generatedAt: "2026-08-10T10:00:00.000Z",
      openedAt: null,
    });
    expect(notification.url).toBe(
      `https://wa.me/60123456789?text=${encodeURIComponent(
        "Hi A & B,\nJob ORD-2026-0041 is done.",
      )}`,
    );
  });

  it("rejects a recipient that cannot produce a truthful usable action", () => {
    expect(() =>
      adapter.toNotification({
        id: "notification-1",
        orderId: "order-1",
        recipient: "1234567",
        message: "Message",
        status: "READY",
        generatedAt: "2026-08-10T10:00:00.000Z",
        openedAt: null,
      }),
    ).toThrow("WHATSAPP_RECIPIENT_INVALID");
  });
});
