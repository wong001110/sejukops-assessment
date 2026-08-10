import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { AIConfigError } from "@/domain/ai-config/errors";
import { documentImportFieldErrors } from "@/domain/document-understanding/api-errors";
import { DocumentUnderstandingError } from "@/domain/document-understanding/errors";

type ErrorLike = Readonly<{ code?: unknown; name?: unknown }>;

function errorLike(value: unknown): ErrorLike {
  return value && typeof value === "object" ? value as ErrorLike : {};
}

export function documentImportApiError(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_FAILED",
          message: "Check the highlighted document fields and try again.",
          fieldErrors: documentImportFieldErrors(error),
        },
      },
      { status: 400 },
    );
  }
  if (error instanceof SyntaxError) {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: "The request body is not valid JSON." } },
      { status: 400 },
    );
  }
  if (error instanceof DocumentUnderstandingError || error instanceof AIConfigError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  const candidate = errorLike(error);
  if (candidate.code === "DEMO_SESSION_REQUIRED") {
    return NextResponse.json(
      { error: { code: "DEMO_SESSION_REQUIRED", message: "Choose a demo user first." } },
      { status: 401 },
    );
  }
  if (candidate.code === "PERMISSION_DENIED") {
    return NextResponse.json(
      { error: { code: "PERMISSION_DENIED", message: "You cannot perform this action." } },
      { status: 403 },
    );
  }
  if (
    candidate.code === "SUPABASE_SERVICE_ROLE_CONFIGURATION_MISSING" ||
    candidate.name === "SupabaseConfigurationError"
  ) {
    return NextResponse.json(
      {
        error: {
          code: "DATA_SERVICE_UNAVAILABLE",
          message: "The document import service is not configured on this environment.",
        },
      },
      { status: 503 },
    );
  }
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "The document request could not be completed." } },
    { status: 500 },
  );
}
