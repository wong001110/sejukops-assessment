import type { WhatsAppNotification } from "@/domain/manager-review/contracts";

export type CompletionNotificationRecord = Readonly<{
  id: string;
  orderId: string;
  recipient: string;
  message: string;
  status: "READY" | "OPENED";
  generatedAt: string;
  openedAt: string | null;
}>;

export interface CompletionNotificationAdapter {
  toNotification(record: CompletionNotificationRecord): WhatsAppNotification;
}

function normalizeWhatsAppRecipient(recipient: string): string {
  const digits = recipient.replace(/\D/g, "");
  const international = digits.startsWith("0") ? `60${digits.slice(1)}` : digits;
  if (international.length < 8 || international.length > 15) {
    throw new Error("WHATSAPP_RECIPIENT_INVALID");
  }
  return international;
}

export class DeepLinkWhatsAppAdapter implements CompletionNotificationAdapter {
  toNotification(record: CompletionNotificationRecord): WhatsAppNotification {
    const recipient = normalizeWhatsAppRecipient(record.recipient);
    return {
      ...record,
      url: `https://wa.me/${recipient}?text=${encodeURIComponent(record.message)}`,
    };
  }
}

export const completionNotificationAdapter: CompletionNotificationAdapter =
  new DeepLinkWhatsAppAdapter();
