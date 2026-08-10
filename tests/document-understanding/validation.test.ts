import { describe, expect, it } from "vitest";

import { AIConfigError } from "@/domain/ai-config/errors";
import {
  parseModelDocumentExtraction,
  validateExtractedServiceDocument,
} from "@/lib/services/document-understanding/validation";

const extraction = {
  customerName: { value: "Nur Aina", confidence: "high" },
  serviceType: { value: "Aircond Repair", confidence: "high" },
  serviceDetails: { value: "Replace fictional capacitor", confidence: "medium" },
  amount: { value: 320, confidence: "high" },
  date: { value: "2026-08-14", confidence: "high" },
} as const;

describe("strict document extraction validation", () => {
  it("accepts one schema-valid object with harmless Markdown/preamble", () => {
    expect(parseModelDocumentExtraction(`Draft follows:\n\`\`\`json\n${JSON.stringify(extraction)}\n\`\`\``))
      .toEqual(extraction);
  });

  it("rejects multiple valid objects as ambiguous", () => {
    expect(() => parseModelDocumentExtraction(
      `${JSON.stringify(extraction)}\n${JSON.stringify(extraction)}`,
    )).toThrowError(AIConfigError);
  });

  it("rejects a second parseable but unapproved object", () => {
    expect(() => parseModelDocumentExtraction(
      `${JSON.stringify(extraction)}\n{"comment":"not in the extraction schema"}`,
    )).toThrowError(AIConfigError);
  });

  it("keeps missing explicit and deterministically rejects unsafe amount/date", () => {
    const draft = validateExtractedServiceDocument({
      ...extraction,
      customerName: { value: null, confidence: "high" },
      amount: { value: 12.345, confidence: "high" },
      date: { value: "2026-02-30", confidence: "high" },
    });
    expect(draft.customerName).toEqual({ value: null, confidence: "missing", issues: [] });
    expect(draft.amount.value).toBeNull();
    expect(draft.amount.confidence).toBe("missing");
    expect(draft.amount.issues[0]).toMatch(/two decimal/i);
    expect(draft.date.value).toBeNull();
    expect(draft.date.issues[0]).toMatch(/valid YYYY-MM-DD/i);
  });

  it("accepts ordinary floating-point two-decimal money but rejects a third decimal", () => {
    const valid = validateExtractedServiceDocument({
      ...extraction,
      amount: { value: 0.29, confidence: "high" },
    });
    expect(valid.amount).toEqual({ value: 0.29, confidence: "high", issues: [] });

    const invalid = validateExtractedServiceDocument({
      ...extraction,
      amount: { value: 0.291, confidence: "high" },
    });
    expect(invalid.amount.value).toBeNull();
    expect(invalid.amount.issues[0]).toMatch(/two decimal/i);
  });

  it("discards a candidate that the model itself marked missing", () => {
    const draft = validateExtractedServiceDocument({
      ...extraction,
      serviceType: { value: "Invented candidate", confidence: "missing" },
    });
    expect(draft.serviceType.value).toBeNull();
    expect(draft.serviceType.confidence).toBe("missing");
    expect(draft.serviceType.issues).toHaveLength(1);
  });
});
