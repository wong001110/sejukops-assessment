import { afterEach, describe, expect, it, vi } from "vitest";

const browserMocks = vi.hoisted(() => ({ uploadToSignedUrl: vi.fn() }));

vi.mock("@/lib/supabase/browser", () => ({
  createBrowserSupabaseClient: () => ({
    storage: { from: () => ({ uploadToSignedUrl: browserMocks.uploadToSignedUrl }) },
  }),
}));

import { evidenceIdAfterUploadFailure, evidenceIdFromUploadFailure, receiptIdAfterUploadFailure, TechnicianEvidenceUploadError, TechnicianJobApiError, TechnicianReceiptUploadError, technicianCompletionApi } from "../../src/components/technician/job-api";

const evidenceId = "c396d88d-9f67-4d62-9e18-110b326bf57b";
const requestKey = "9953e846-6ad8-48c2-a60e-081bbc4d9061";
const response = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
}) as Response;

describe("Technician evidence reservation failure recovery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("retains a successful reservation id after browser upload failure so it can be deleted", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(response({
      evidence: { id: evidenceId, status: "RESERVED" },
      upload: { bucket: "service-evidence", path: "order/file.jpg", token: "signed-token" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    browserMocks.uploadToSignedUrl.mockResolvedValueOnce({ error: { message: "offline" } });

    let failure: unknown;
    try {
      await technicianCompletionApi.uploadEvidence("order-1", { name: "file.jpg", type: "image/jpeg", size: 10 } as File, requestKey);
    } catch (cause) {
      failure = cause;
    }

    expect(failure).toBeInstanceOf(TechnicianEvidenceUploadError);
    expect(evidenceIdFromUploadFailure(failure)).toBe(evidenceId);
    expect(browserMocks.uploadToSignedUrl).toHaveBeenCalledWith("order/file.jpg", "signed-token", expect.anything(), { contentType: "image/jpeg" });

    fetchMock.mockResolvedValueOnce(response(null, 204));
    await technicianCompletionApi.removeEvidence("order-1", evidenceId);
    expect(fetchMock).toHaveBeenLastCalledWith(`/api/technician/jobs/order-1/evidence/${evidenceId}`, expect.objectContaining({ method: "DELETE" }));
  });

  it("keeps an existing reservation id after a generic retry failure, while a typed error replaces it", () => {
    expect(evidenceIdAfterUploadFailure(new TechnicianJobApiError("Network failed"), evidenceId)).toBe(evidenceId);
    expect(evidenceIdAfterUploadFailure(new Error("Network failed"), evidenceId)).toBe(evidenceId);
    expect(evidenceIdAfterUploadFailure(new TechnicianEvidenceUploadError("New reservation", "evidence-2"), evidenceId)).toBe("evidence-2");
  });

  it("preserves a receipt reservation across upload failure and retries with the same request key", async () => {
    const receiptId = "211d0509-8856-41b4-9ea2-00a8849aa40a";
    const receipt = { id: receiptId, status: "RESERVED", originalFilename: "receipt.jpg", mimeType: "image/jpeg", sizeBytes: 10 };
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(response({ receipt, upload: { bucket: "service-evidence", path: "receipts/order/receipt.jpg", token: "token-1" } }))
      .mockResolvedValueOnce(response({ receipt, upload: { bucket: "service-evidence", path: "receipts/order/receipt.jpg", token: "token-2" } }))
      .mockResolvedValueOnce(response({ receipt: { ...receipt, status: "UPLOADED" } }));
    vi.stubGlobal("fetch", fetchMock);
    browserMocks.uploadToSignedUrl.mockResolvedValueOnce({ error: { message: "offline" } }).mockResolvedValueOnce({ error: null });
    const file = { name: "receipt.jpg", type: "image/jpeg", size: 10 } as File;

    let failure: unknown;
    try { await technicianCompletionApi.uploadReceipt("order-1", file, requestKey); } catch (cause) { failure = cause; }
    expect(failure).toBeInstanceOf(TechnicianReceiptUploadError);
    expect(receiptIdAfterUploadFailure(failure)).toBe(receiptId);
    expect(receiptIdAfterUploadFailure(new TechnicianJobApiError("Network failed"), receiptId)).toBe(receiptId);

    const uploaded = await technicianCompletionApi.uploadReceipt("order-1", file, requestKey);
    expect(uploaded.status).toBe("UPLOADED");
    const reservationBodies = [fetchMock.mock.calls[0], fetchMock.mock.calls[1]].map((call) => JSON.parse(String((call[1] as RequestInit).body)) as { requestKey: string });
    expect(reservationBodies.map((body) => body.requestKey)).toEqual([requestKey, requestKey]);
  });

  it("removes the retained receipt id after upload failure", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response(null, 204));
    vi.stubGlobal("fetch", fetchMock);
    await technicianCompletionApi.removeReceipt("order-1", "receipt-1");
    expect(fetchMock).toHaveBeenCalledWith("/api/technician/jobs/order-1/receipt/receipt-1", expect.objectContaining({ method: "DELETE" }));
  });
});
