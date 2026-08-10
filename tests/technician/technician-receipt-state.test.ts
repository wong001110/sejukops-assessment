import { describe, expect, it } from "vitest";

import type { TechnicianPaymentReceipt } from "../../src/domain/technician-completion/contracts";
import { confirmedReceiptUploadId, receiptCompletionError } from "../../src/components/technician/receipt-state";

const uploadedReceipt = { id: "211d0509-8856-41b4-9ea2-00a8849aa40a", status: "UPLOADED" } as TechnicianPaymentReceipt;

describe("Technician receipt completion state", () => {
  it("allows optional payment with no receipt", () => {
    expect(receiptCompletionError({ paymentAmount: 80, paymentMethod: "CASH" })).toBeUndefined();
    expect(confirmedReceiptUploadId(null)).toBeUndefined();
  });

  it("requires complete payment details when a confirmed receipt exists", () => {
    expect(receiptCompletionError({ paymentAmount: null, remoteStatus: "UPLOADED" })).toContain("requires both payment amount and payment method");
    expect(receiptCompletionError({ paymentAmount: 80, paymentMethod: "CASH", remoteStatus: "UPLOADED" })).toBeUndefined();
    expect(confirmedReceiptUploadId(uploadedReceipt)).toBe(uploadedReceipt.id);
  });

  it("blocks interrupted or deleting receipt state and sends only confirmed uploads", () => {
    expect(receiptCompletionError({ paymentAmount: 80, paymentMethod: "CASH", remoteStatus: "RESERVED" })).toBeTruthy();
    expect(receiptCompletionError({ paymentAmount: 80, paymentMethod: "CASH", remoteStatus: "DELETING" })).toBeTruthy();
    expect(confirmedReceiptUploadId({ ...uploadedReceipt, status: "RESERVED" })).toBeUndefined();
    expect(confirmedReceiptUploadId({ ...uploadedReceipt, status: "ATTACHED" })).toBeUndefined();
  });
});
