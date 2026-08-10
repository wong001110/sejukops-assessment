import { afterEach, describe, expect, it, vi } from "vitest";

const browserMocks = vi.hoisted(() => ({ uploadToSignedUrl: vi.fn() }));

vi.mock("@/lib/supabase/browser", () => ({
  createBrowserSupabaseClient: () => ({
    storage: { from: () => ({ uploadToSignedUrl: browserMocks.uploadToSignedUrl }) },
  }),
}));

import { evidenceIdAfterUploadFailure, evidenceIdFromUploadFailure, TechnicianEvidenceUploadError, TechnicianJobApiError, technicianCompletionApi } from "../../src/components/technician/job-api";

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
});
