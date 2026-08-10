import { DocumentUnderstandingError } from "@/domain/document-understanding/errors";

export function normalizeDocumentStorageMetadata(
  metadata: Readonly<Record<string, unknown>>,
): { mimeType: string; sizeBytes: number } {
  const rawMimeType =
    metadata.mimetype ?? metadata.contentType ?? metadata.content_type;
  const mimeType = typeof rawMimeType === "string"
    ? rawMimeType.trim().toLowerCase()
    : "";
  const sizeBytes = Number(metadata.size);
  if (!mimeType || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1) {
    throw new DocumentUnderstandingError(
      "DOCUMENT_STORAGE_FAILED",
      "The private source metadata could not be verified. Upload the source again.",
      502,
    );
  }
  return { mimeType, sizeBytes };
}
