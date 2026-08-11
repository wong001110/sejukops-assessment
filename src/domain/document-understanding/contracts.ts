import { z } from "zod";

import type {
  AdminBranchOption,
  AdminOrderDetail,
  AdminTechnicianOption,
} from "@/domain/admin-orders/contracts";
import type { OrderStatus } from "@/domain/operations";

const uuid = z.string().uuid();
const requiredText = (label: string, maximum: number) =>
  z.string().trim().min(1, `${label} is required`).max(maximum);

export function hasAtMostTwoDecimalPlaces(value: number): boolean {
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-8;
}

export const DOCUMENT_IMPORT_POLICY = {
  bucket: "documents",
  maximumTextBytes: 2 * 1024 * 1024,
  maximumImageBytes: 12 * 1024 * 1024,
  maximumPdfBytes: 15 * 1024 * 1024,
  maximumPdfPages: 20,
  maximumExtractedCharacters: 24_000,
  extractionTimeoutMs: 20_000,
  allowedMimeTypes: [
    "text/plain",
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
  ],
} as const;

export type DocumentImportMimeType =
  (typeof DOCUMENT_IMPORT_POLICY.allowedMimeTypes)[number];

export const documentImportMimeTypeSchema = z.enum(
  DOCUMENT_IMPORT_POLICY.allowedMimeTypes,
);

export const reserveDocumentImportSchema = z
  .object({
    originalFilename: requiredText("Filename", 240),
    mimeType: documentImportMimeTypeSchema,
    sizeBytes: z.number().int().positive(),
    requestKey: uuid,
  })
  .superRefine((value, context) => {
    const maximum = value.mimeType === "text/plain"
      ? DOCUMENT_IMPORT_POLICY.maximumTextBytes
      : value.mimeType === "application/pdf"
        ? DOCUMENT_IMPORT_POLICY.maximumPdfBytes
        : DOCUMENT_IMPORT_POLICY.maximumImageBytes;
    if (value.sizeBytes > maximum) {
      context.addIssue({
        code: z.ZodIssueCode.too_big,
        maximum,
        inclusive: true,
        type: "number",
        path: ["sizeBytes"],
        message: "The source document exceeds the allowed size for this file type.",
      });
    }
  });

export const confirmDocumentSourceSchema = z.object({ requestKey: uuid });
export const extractDocumentImportSchema = z.object({ requestKey: uuid });

export const extractionConfidenceSchema = z.enum([
  "high",
  "medium",
  "low",
  "missing",
]);

export type ExtractionConfidence = z.infer<typeof extractionConfidenceSchema>;

const modelField = <T extends z.ZodTypeAny>(value: T) =>
  z.object({
    value: value.nullable(),
    confidence: extractionConfidenceSchema,
  }).strict();

export const modelExtractedServiceDocumentSchema = z.object({
  customerName: modelField(z.string().trim().min(1).max(160)),
  serviceType: modelField(z.string().trim().min(1).max(120)),
  serviceDetails: modelField(z.string().trim().min(1).max(4000)),
  amount: modelField(z.number().finite().min(0).max(9_999_999_999.99)),
  date: modelField(z.string().trim().min(1).max(40)),
}).strict();

const reviewedDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
  }, "Enter a real calendar date");

export const confirmDocumentImportSchema = z.object({
  action: z.literal("CREATE"),
  requestKey: uuid,
  reviewed: z.object({
    customerName: requiredText("Customer name", 160),
    customerPhone: z.string().trim().regex(
      /^\+?[0-9][0-9 -]{6,20}$/,
      "Enter a valid customer phone number",
    ),
    customerAddress: requiredText("Customer address", 800),
    serviceType: requiredText("Service type", 120),
    serviceDetails: requiredText("Service details", 4000),
    amount: z.number().finite().min(0).max(9_999_999_999.99).refine(
      hasAtMostTwoDecimalPlaces,
      "Use no more than two decimal places",
    ),
    date: reviewedDateSchema,
    branchId: uuid,
    technicianId: uuid.optional(),
    adminNotes: z.string().trim().max(4000).optional(),
  }).strict(),
}).strict();

export type ReserveDocumentImportInput = z.infer<typeof reserveDocumentImportSchema>;
export type ConfirmDocumentSourceInput = z.infer<typeof confirmDocumentSourceSchema>;
export type ExtractDocumentImportInput = z.infer<typeof extractDocumentImportSchema>;
export type ConfirmDocumentImportInput = z.infer<typeof confirmDocumentImportSchema>;
export type ModelExtractedServiceDocument = z.infer<
  typeof modelExtractedServiceDocumentSchema
>;

export type ValidatedExtractionField<T> = Readonly<{
  value: T | null;
  confidence: ExtractionConfidence;
  issues: readonly string[];
}>;

export type ValidatedServiceDocumentDraft = Readonly<{
  customerName: ValidatedExtractionField<string>;
  serviceType: ValidatedExtractionField<string>;
  serviceDetails: ValidatedExtractionField<string>;
  amount: ValidatedExtractionField<number>;
  date: ValidatedExtractionField<string>;
}>;

const validatedField = <T extends z.ZodTypeAny>(value: T) => z.object({
  value: value.nullable(),
  confidence: extractionConfidenceSchema,
  issues: z.array(z.string().max(300)).max(10),
}).strict();

export const validatedServiceDocumentDraftSchema = z.object({
  customerName: validatedField(z.string()),
  serviceType: validatedField(z.string()),
  serviceDetails: validatedField(z.string()),
  amount: validatedField(z.number()),
  date: validatedField(z.string()),
}).strict();

export type DocumentImportSourceStatus = "RESERVED" | "UPLOADED";
export type DocumentImportExtractionStatus =
  | "NOT_STARTED"
  | "EXTRACTING"
  | "EXTRACTED"
  | "FAILED"
  | "CONFIRMED";

export type DocumentExtractionFailureCode =
  | "AI_NOT_CONFIGURED"
  | "AI_CAPABILITY_MISMATCH"
  | "AI_AUTH_FAILED"
  | "AI_RATE_LIMITED"
  | "AI_TIMEOUT"
  | "AI_PROVIDER_UNAVAILABLE"
  | "AI_INVALID_RESPONSE"
  | "DOCUMENT_STORAGE_FAILED"
  | "DOCUMENT_TEXT_UNREADABLE"
  | "DOCUMENT_EXTRACTION_FAILED"
  | "DOCUMENT_DATA_ACCESS_FAILED";

export type DocumentImportRecoveryAction =
  | "CONFIGURE_PROVIDER"
  | "RETRY_EXTRACTION"
  | "UPLOAD_READABLE_SOURCE"
  | "REUPLOAD_SOURCE"
  | "CONTACT_SUPPORT";

export type DocumentImportFailure = Readonly<{
  code: DocumentExtractionFailureCode;
  message: string;
  retryable: boolean;
  recoveryAction: DocumentImportRecoveryAction;
}>;

export type DocumentImportRecord = Readonly<{
  id: string;
  originalFilename: string;
  mimeType: DocumentImportMimeType;
  sizeBytes: number;
  sourceStatus: DocumentImportSourceStatus;
  extractionStatus: DocumentImportExtractionStatus;
  extractionAttemptCount: number;
  sourceUploadedAt: string | null;
  draft: ValidatedServiceDocumentDraft | null;
  failure: DocumentImportFailure | null;
  confirmedOrderId: string | null;
  confirmation: Readonly<{
    orderId: string;
    orderNo: string;
    status: OrderStatus;
    customerReused: boolean;
  }> | null;
  createdAt: string;
  updatedAt: string;
  sourceUrl: string | null;
}>;

export type DocumentImportReservationResponse = Readonly<{
  documentImport: DocumentImportRecord;
  upload: Readonly<{ bucket: string; path: string; token: string }> | null;
}>;

export type DocumentImportOptions = Readonly<{
  branches: readonly AdminBranchOption[];
  technicians: readonly AdminTechnicianOption[];
}>;

export type DocumentImportDetailResponse = Readonly<{
  documentImport: DocumentImportRecord;
  options: DocumentImportOptions;
}>;

export type DocumentImportMutationResponse = Readonly<{
  documentImport: DocumentImportRecord;
}>;

export type ConfirmDocumentImportResponse = Readonly<{
  documentImport: DocumentImportRecord;
  order: AdminOrderDetail;
  customerReused: boolean;
}>;

export type DocumentImportApiErrorEnvelope = Readonly<{
  error: Readonly<{
    code: string;
    message: string;
    fieldErrors?: Readonly<Record<string, readonly string[] | undefined>>;
  }>;
}>;
