import { describe, expect, it } from "vitest";

import { DocumentUnderstandingError } from "@/domain/document-understanding/errors";
import { normalizeDocumentStorageMetadata } from "@/lib/services/document-understanding/storage-metadata";

describe("document source Storage metadata", () => {
  it.each([
    [{ mimetype: "IMAGE/PNG", size: 120 }, "image/png", 120],
    [{ contentType: "image/webp", size: "121" }, "image/webp", 121],
    [{ content_type: "application/pdf", size: 122 }, "application/pdf", 122],
  ] as const)("normalizes Supabase metadata variants", (metadata, mimeType, sizeBytes) => {
    expect(normalizeDocumentStorageMetadata(metadata)).toEqual({ mimeType, sizeBytes });
  });

  it.each([
    { mimetype: "image/png", size: 1.5 },
    { mimetype: "image/png", size: "not-a-number" },
    { size: 100 },
  ])("rejects unsafe or incomplete metadata", (metadata) => {
    expect(() => normalizeDocumentStorageMetadata(metadata)).toThrowError(
      DocumentUnderstandingError,
    );
  });
});
