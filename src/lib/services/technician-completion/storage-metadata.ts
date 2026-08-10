import { TechnicianCompletionError } from "@/domain/technician-completion/errors";

type StorageMetadata = Readonly<Record<string, unknown>>;

export function normalizeStorageObjectMetadata(metadata: StorageMetadata): {
  mimeType: string;
  sizeBytes: number;
} {
  const rawMimeType =
    metadata.mimetype ?? metadata.contentType ?? metadata.content_type;
  const mimeType = typeof rawMimeType === "string" ? rawMimeType.trim().toLowerCase() : "";
  const sizeBytes = Number(metadata.size);
  if (!mimeType || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1) {
    throw new TechnicianCompletionError(
      "TECHNICIAN_COMPLETION_STORAGE_FAILED",
      "The uploaded evidence metadata could not be verified. Upload the file again.",
      502,
    );
  }
  return { mimeType, sizeBytes };
}
