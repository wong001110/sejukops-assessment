import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { DocumentUnderstandingError } from "@/domain/document-understanding/errors";
import { extractReadableDocumentText } from "@/lib/services/document-understanding/text-extraction";

describe("bounded text-native document extraction", () => {
  it("extracts the committed fictional text-native PDF fixture", async () => {
    const encoded = readFileSync(
      resolve("tests/fixtures/documents/complete-service-invoice.pdf.base64"),
      "utf8",
    ).trim();
    const text = await extractReadableDocumentText(
      "application/pdf",
      new Uint8Array(Buffer.from(encoded, "base64")),
    );
    expect(text).toContain("Customer: Nur Aina");
    expect(text).toContain("Amount: RM 320.00");
    expect(text).toContain("Date: 2026-08-14");
  });

  it("reads bounded UTF-8 text and rejects empty/unsafe text", async () => {
    await expect(extractReadableDocumentText(
      "text/plain",
      new TextEncoder().encode("Customer: Fictional Test"),
    )).resolves.toBe("Customer: Fictional Test");
    await expect(extractReadableDocumentText(
      "text/plain",
      new TextEncoder().encode("   \n"),
    )).rejects.toBeInstanceOf(DocumentUnderstandingError);
    await expect(extractReadableDocumentText(
      "text/plain",
      new Uint8Array([0xff, 0xfe]),
    )).rejects.toMatchObject({ code: "DOCUMENT_TEXT_UNREADABLE" });
  });
});
