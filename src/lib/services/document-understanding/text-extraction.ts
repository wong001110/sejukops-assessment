import "server-only";

import { extractText, getDocumentProxy } from "unpdf";

import {
  DOCUMENT_IMPORT_POLICY,
  type DocumentImportMimeType,
} from "@/domain/document-understanding/contracts";
import { DocumentUnderstandingError } from "@/domain/document-understanding/errors";

function timeoutFailure(): DocumentUnderstandingError {
  return new DocumentUnderstandingError(
    "DOCUMENT_EXTRACTION_FAILED",
    "The document took too long to read. Try a smaller or simpler source file.",
    504,
  );
}

async function withTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(timeoutFailure()),
      DOCUMENT_IMPORT_POLICY.extractionTimeoutMs,
    );
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function normalizeExtractedText(value: string): string {
  if (value.includes("\0")) {
    throw new DocumentUnderstandingError(
      "DOCUMENT_TEXT_UNREADABLE",
      "The uploaded source does not contain safely readable text.",
      422,
    );
  }
  const normalized = value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
  if (!normalized) {
    throw new DocumentUnderstandingError(
      "DOCUMENT_TEXT_UNREADABLE",
      "No readable text was found. Upload a text-native PDF or use a supported image source with a vision-capable model.",
      422,
    );
  }
  return normalized.slice(0, DOCUMENT_IMPORT_POLICY.maximumExtractedCharacters);
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const proxy = await getDocumentProxy(bytes);
  try {
    if (proxy.numPages < 1 || proxy.numPages > DOCUMENT_IMPORT_POLICY.maximumPdfPages) {
      throw new DocumentUnderstandingError(
        "DOCUMENT_VALIDATION_FAILED",
        `PDF sources must contain between 1 and ${DOCUMENT_IMPORT_POLICY.maximumPdfPages} pages.`,
        400,
      );
    }
    const result = await extractText(proxy, { mergePages: true });
    return normalizeExtractedText(result.text);
  } finally {
    await proxy.destroy();
  }
}

export async function extractReadableDocumentText(
  mimeType: DocumentImportMimeType,
  bytes: Uint8Array,
): Promise<string> {
  if (mimeType !== "text/plain" && mimeType !== "application/pdf") {
    throw new DocumentUnderstandingError(
      "DOCUMENT_VALIDATION_FAILED",
      "This source requires the vision document path.",
      400,
    );
  }
  const maximum = mimeType === "text/plain"
    ? DOCUMENT_IMPORT_POLICY.maximumTextBytes
    : DOCUMENT_IMPORT_POLICY.maximumPdfBytes;
  if (bytes.byteLength < 1 || bytes.byteLength > maximum) {
    throw new DocumentUnderstandingError(
      "DOCUMENT_VALIDATION_FAILED",
      "The uploaded source size is outside the allowed document limit.",
      400,
    );
  }

  return withTimeout((async () => {
    try {
      if (mimeType === "application/pdf") return await extractPdfText(bytes);
      return normalizeExtractedText(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch (error) {
      if (error instanceof DocumentUnderstandingError) throw error;
      throw new DocumentUnderstandingError(
        "DOCUMENT_TEXT_UNREADABLE",
        "The uploaded source could not be read safely. Upload a text-native PDF or UTF-8 text file.",
        422,
        { cause: error },
      );
    }
  })());
}
