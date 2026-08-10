import { describe, expect, it } from "vitest";

import {
  confirmDocumentImportSchema,
  DOCUMENT_IMPORT_POLICY,
  reserveDocumentImportSchema,
} from "@/domain/document-understanding/contracts";
import { documentImportFieldErrors } from "@/domain/document-understanding/api-errors";

describe("document import browser contract", () => {
  it("enforces the durable source MIME and per-type size policy", () => {
    expect(reserveDocumentImportSchema.parse({
      originalFilename: "fictional-invoice.pdf",
      mimeType: "application/pdf",
      sizeBytes: DOCUMENT_IMPORT_POLICY.maximumPdfBytes,
      requestKey: "10000000-0000-4000-8000-000000000001",
    }).mimeType).toBe("application/pdf");
    expect(() => reserveDocumentImportSchema.parse({
      originalFilename: "oversized.txt",
      mimeType: "text/plain",
      sizeBytes: DOCUMENT_IMPORT_POLICY.maximumTextBytes + 1,
      requestKey: "10000000-0000-4000-8000-000000000001",
    })).toThrow();
    expect(() => reserveDocumentImportSchema.parse({
      originalFilename: "unsafe.exe",
      mimeType: "application/octet-stream",
      sizeBytes: 10,
      requestKey: "10000000-0000-4000-8000-000000000001",
    })).toThrow();
  });

  it("requires explicit CREATE and fully human-normalized order values", () => {
    const result = confirmDocumentImportSchema.parse({
      action: "CREATE",
      requestKey: "10000000-0000-4000-8000-000000000002",
      reviewed: {
        customerName: "Nur Aina",
        customerPhone: "+6012 345 6789",
        customerAddress: "12 Fictional Street, Kuala Lumpur",
        serviceType: "Aircond Repair",
        serviceDetails: "Replace fictional capacitor",
        amount: 320,
        date: "2026-08-14",
        branchId: "10000000-0000-4000-8000-000000000003",
      },
    });
    expect(result.action).toBe("CREATE");
    expect(result.reviewed.amount).toBe(320);
    expect(confirmDocumentImportSchema.safeParse({
      ...result,
      reviewed: { ...result.reviewed, amount: 0.29 },
    }).success).toBe(true);
    expect(confirmDocumentImportSchema.safeParse({
      ...result,
      reviewed: { ...result.reviewed, amount: 0.291 },
    }).success).toBe(false);
    expect(() => confirmDocumentImportSchema.parse({
      ...result,
      reviewed: { ...result.reviewed, date: "2026-02-30" },
    })).toThrow();
  });

  it("keeps nested reviewed-field paths precise for form errors", () => {
    const failure = confirmDocumentImportSchema.safeParse({
      action: "CREATE",
      requestKey: "10000000-0000-4000-8000-000000000002",
      reviewed: {
        customerName: "",
        customerPhone: "bad",
        customerAddress: "",
        serviceType: "",
        serviceDetails: "",
        amount: -1,
        date: "bad-date",
        branchId: "bad-uuid",
      },
    });
    expect(failure.success).toBe(false);
    if (failure.success) return;
    const fields = documentImportFieldErrors(failure.error);
    expect(fields).toHaveProperty("reviewed.customerName");
    expect(fields).toHaveProperty("reviewed.customerPhone");
    expect(fields).toHaveProperty("reviewed.date");
    expect(fields).not.toHaveProperty("reviewed");
  });
});
