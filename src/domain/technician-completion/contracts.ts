import { z } from "zod";

import { SERVICE_EVIDENCE_POLICY } from "@/domain/operations";
import type {
  WhatsAppNotification,
  WhatsAppPreparationWarning,
} from "@/domain/manager-review/contracts";

export const TECHNICIAN_EVIDENCE_POLICY = SERVICE_EVIDENCE_POLICY;
export const TECHNICIAN_EVIDENCE_MIME_TYPES = Object.keys(
  TECHNICIAN_EVIDENCE_POLICY.mimeMaximumBytes,
) as Array<keyof typeof TECHNICIAN_EVIDENCE_POLICY.mimeMaximumBytes>;

export const TECHNICIAN_RECEIPT_POLICY = {
  bucket: "service-evidence",
  maximumFileCount: 1,
  maximumBytes: 12 * 1024 * 1024,
  mimeTypes: ["image/jpeg", "image/png", "image/webp"],
} as const;

export const evidenceUploadStatuses = [
  "RESERVED",
  "UPLOADED",
  "ATTACHED",
  "FAILED",
  "ORPHANED",
  "DELETING",
  "DELETED",
] as const;
export type EvidenceUploadStatus = (typeof evidenceUploadStatuses)[number];

const requestKeySchema = z.string().uuid();
const evidenceMimeSchema = z.enum([
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "application/pdf",
]);

export const reserveEvidenceUploadSchema = z
  .object({
    originalFilename: z.string().trim().min(1, "A filename is required").max(255),
    mimeType: evidenceMimeSchema,
    sizeBytes: z.number().int().positive(),
    requestKey: requestKeySchema,
  })
  .superRefine((value, context) => {
    const maximum = TECHNICIAN_EVIDENCE_POLICY.mimeMaximumBytes[value.mimeType];
    if (value.sizeBytes > maximum) {
      context.addIssue({
        code: z.ZodIssueCode.too_big,
        type: "number",
        inclusive: true,
        maximum,
        path: ["sizeBytes"],
        message: `This file exceeds the ${Math.round(maximum / 1024 / 1024)} MB limit.`,
      });
    }
  });

export const confirmEvidenceUploadSchema = z.object({
  requestKey: requestKeySchema,
});

export const reservePaymentReceiptSchema = z.object({
  originalFilename: z.string().trim().min(1, "A filename is required").max(255),
  mimeType: z.enum(TECHNICIAN_RECEIPT_POLICY.mimeTypes),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(
      TECHNICIAN_RECEIPT_POLICY.maximumBytes,
      "A receipt image may be at most 12 MB.",
    ),
  requestKey: requestKeySchema,
});

export const paymentMethods = [
  "CASH",
  "CARD",
  "BANK_TRANSFER",
  "EWALLET",
  "OTHER",
] as const;

const moneySchema = z
  .number()
  .finite()
  .min(0)
  .max(9_999_999_999.99)
  .refine(
    (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8,
    "Use no more than two decimal places",
  );

export const completeTechnicianJobSchema = z.object({
  workDone: z.string().trim().min(1, "Work done is required").max(5000),
  extraCharges: moneySchema,
  remarks: z
    .string()
    .trim()
    .max(4000)
    .optional()
    .transform((value) => value || undefined),
  payment: z
    .object({
      amount: moneySchema,
      method: z.enum(paymentMethods),
      receiptUploadId: z.string().uuid().optional(),
    })
    .optional(),
  requestKey: requestKeySchema,
});

export type ReserveEvidenceUploadInput = z.infer<typeof reserveEvidenceUploadSchema>;
export type ConfirmEvidenceUploadInput = z.infer<typeof confirmEvidenceUploadSchema>;
export type ReservePaymentReceiptInput = z.infer<typeof reservePaymentReceiptSchema>;
export type CompleteTechnicianJobInput = z.infer<typeof completeTechnicianJobSchema>;

export type TechnicianEvidenceItem = Readonly<{
  id: string;
  orderId: string;
  originalFilename: string;
  mimeType: z.infer<typeof evidenceMimeSchema>;
  sizeBytes: number;
  status: EvidenceUploadStatus;
  createdAt: string;
  uploadedAt: string | null;
  failureCode: string | null;
  viewUrl: string | null;
}>;

export type EvidenceUploadAuthorization = Readonly<{
  bucket: "service-evidence";
  path: string;
  token: string;
}>;

export type EvidenceReservationResponse = Readonly<{
  evidence: TechnicianEvidenceItem;
  upload: EvidenceUploadAuthorization | null;
}>;

export type TechnicianPaymentReceipt = Readonly<{
  id: string;
  orderId: string;
  originalFilename: string;
  mimeType: (typeof TECHNICIAN_RECEIPT_POLICY.mimeTypes)[number];
  sizeBytes: number;
  status: EvidenceUploadStatus;
  createdAt: string;
  uploadedAt: string | null;
  failureCode: string | null;
  viewUrl: string | null;
}>;

export type PaymentReceiptReservationResponse = Readonly<{
  receipt: TechnicianPaymentReceipt;
  upload: EvidenceUploadAuthorization | null;
}>;

export type TechnicianCompletionReport = Readonly<{
  id: string;
  workDone: string;
  extraCharges: number;
  quotedPriceSnapshot: number;
  finalAmount: number;
  remarks: string | null;
  startedAt: string | null;
  completedAt: string;
}>;

export type TechnicianCompletionPayment = Readonly<{
  id: string;
  amount: number;
  method: (typeof paymentMethods)[number];
  recordedAt: string;
}>;

export type TechnicianCompletionResponse = Readonly<{
  job: Readonly<{ id: string; orderNo: string; status: "JOB_DONE" }>;
  report: TechnicianCompletionReport;
  attachments: TechnicianEvidenceItem[];
  payment: TechnicianCompletionPayment | null;
  receipt: TechnicianPaymentReceipt | null;
  notification: WhatsAppNotification | null;
  notificationWarning: WhatsAppPreparationWarning | null;
}>;
