import { describe, expect, it } from "vitest";

import { normalizeStorageObjectMetadata } from "../../src/lib/services/technician-completion/storage-metadata";

describe("Supabase Storage object metadata normalization", () => {
  it("normalizes native mimetype and numeric size", () => {
    expect(
      normalizeStorageObjectMetadata({ mimetype: " Image/JPEG ", size: 1024 }),
    ).toEqual({ mimeType: "image/jpeg", sizeBytes: 1024 });
  });

  it("supports contentType variants and exact integer string sizes", () => {
    expect(
      normalizeStorageObjectMetadata({ contentType: "application/pdf", size: "4096" }),
    ).toEqual({ mimeType: "application/pdf", sizeBytes: 4096 });
    expect(
      normalizeStorageObjectMetadata({ content_type: "video/mp4", size: 75 }),
    ).toEqual({ mimeType: "video/mp4", sizeBytes: 75 });
  });

  it("rejects absent MIME, fractional, zero, and unsafe sizes", () => {
    expect(() => normalizeStorageObjectMetadata({ size: 1 })).toThrow();
    expect(() =>
      normalizeStorageObjectMetadata({ mimetype: "image/png", size: 1.5 }),
    ).toThrow();
    expect(() =>
      normalizeStorageObjectMetadata({ mimetype: "image/png", size: 0 }),
    ).toThrow();
    expect(() =>
      normalizeStorageObjectMetadata({
        mimetype: "image/png",
        size: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toThrow();
  });
});
