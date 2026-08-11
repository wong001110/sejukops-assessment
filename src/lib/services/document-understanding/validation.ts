import {
  extractionConfidenceSchema,
  hasAtMostTwoDecimalPlaces,
  modelExtractedServiceDocumentSchema,
  type ExtractionConfidence,
  type ModelExtractedServiceDocument,
  type ValidatedExtractionField,
  type ValidatedServiceDocumentDraft,
} from "@/domain/document-understanding/contracts";
import { AIConfigError, AI_ERROR_MESSAGES } from "@/domain/ai-config/errors";

function invalidAIResponse(cause?: unknown): AIConfigError {
  return new AIConfigError(
    "AI_INVALID_RESPONSE",
    AI_ERROR_MESSAGES.AI_INVALID_RESPONSE,
    502,
    cause === undefined ? undefined : { cause },
  );
}

function extractBalancedObjects(content: string): string[] {
  const objects: string[] = [];
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (start < 0) {
      if (character === "{") {
        start = index;
        depth = 1;
      }
      continue;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && quoted) {
      escaped = true;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (character === "{") depth += 1;
    if (character === "}") depth -= 1;
    if (depth === 0) {
      objects.push(content.slice(start, index + 1));
      start = -1;
    }
  }
  return objects;
}

export function parseModelDocumentExtraction(content: string): ModelExtractedServiceDocument {
  const parseable: unknown[] = [];
  for (const candidate of extractBalancedObjects(content)) {
    try {
      parseable.push(JSON.parse(candidate));
    } catch {
      // Markdown/preamble braces that are not JSON are not provider objects.
    }
  }
  if (parseable.length !== 1) throw invalidAIResponse();
  const parsed = modelExtractedServiceDocumentSchema.safeParse(parseable[0]);
  if (!parsed.success) throw invalidAIResponse(parsed.error);
  return parsed.data;
}

function normalizedField<T>(
  value: T | null,
  confidence: ExtractionConfidence,
  issues: readonly string[] = [],
): ValidatedExtractionField<T> {
  if (value === null) {
    return { value: null, confidence: "missing", issues };
  }
  if (confidence === "missing") {
    return {
      value: null,
      confidence: "missing",
      issues: [...issues, "The model marked this field missing; its candidate was discarded."],
    };
  }
  return { value, confidence: extractionConfidenceSchema.parse(confidence), issues };
}

function normalizedText(
  field: ModelExtractedServiceDocument["customerName"],
): ValidatedExtractionField<string> {
  const value = field.value?.trim() || null;
  return normalizedField(value, field.confidence);
}

function validCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

export function validateExtractedServiceDocument(
  model: ModelExtractedServiceDocument,
): ValidatedServiceDocumentDraft {
  const amount = (() => {
    if (model.amount.value === null) return normalizedField<number>(null, "missing");
    if (!hasAtMostTwoDecimalPlaces(model.amount.value)) {
      return normalizedField<number>(null, "missing", [
        "The amount used more than two decimal places and was rejected.",
      ]);
    }
    return normalizedField(model.amount.value, model.amount.confidence);
  })();
  const date = (() => {
    const candidate = model.date.value?.trim() || null;
    if (!candidate) return normalizedField<string>(null, "missing");
    if (!validCalendarDate(candidate)) {
      return normalizedField<string>(null, "missing", [
        "The date was not a valid YYYY-MM-DD calendar date and was rejected.",
      ]);
    }
    return normalizedField(candidate, model.date.confidence);
  })();
  return {
    customerName: normalizedText(model.customerName),
    serviceType: normalizedText(model.serviceType),
    serviceDetails: normalizedText(model.serviceDetails),
    amount,
    date,
  };
}
