import { NextResponse } from "next/server";
import { ZodError } from "zod";

import {
  AI_OPERATIONS_MESSAGES,
  AIOperationsError,
} from "@/domain/ai-operations/errors";

type ErrorLike = Readonly<{ code?: unknown; name?: unknown }>;

export function aiOperationsApiError(error: unknown): NextResponse {
  if (error instanceof AIOperationsError) {
    return NextResponse.json(error.toEnvelope(), { status: error.status });
  }
  if (error instanceof ZodError) {
    const normalized = new AIOperationsError(
      "AI_OPERATIONS_VALIDATION_FAILED",
      AI_OPERATIONS_MESSAGES.AI_OPERATIONS_VALIDATION_FAILED,
      400,
      false,
      "USE_OPERATIONS_SCREENS",
    );
    return NextResponse.json(normalized.toEnvelope(), { status: 400 });
  }
  if (error instanceof SyntaxError) {
    const normalized = new AIOperationsError(
      "AI_OPERATIONS_VALIDATION_FAILED",
      "The request body is not valid JSON.",
      400,
      false,
      "USE_OPERATIONS_SCREENS",
    );
    return NextResponse.json(normalized.toEnvelope(), { status: 400 });
  }
  const candidate =
    error && typeof error === "object" ? (error as ErrorLike) : {};
  if (candidate.code === "DEMO_SESSION_REQUIRED") {
    return NextResponse.json(
      {
        error: {
          code: "AI_OPERATIONS_PERMISSION_DENIED",
          message: "Choose a Manager demo user first.",
          retryable: false,
          action: "USE_OPERATIONS_SCREENS",
        },
      },
      { status: 401 },
    );
  }
  if (candidate.code === "PERMISSION_DENIED") {
    return NextResponse.json(
      new AIOperationsError(
        "AI_OPERATIONS_PERMISSION_DENIED",
        AI_OPERATIONS_MESSAGES.AI_OPERATIONS_PERMISSION_DENIED,
        403,
        false,
        "USE_OPERATIONS_SCREENS",
      ).toEnvelope(),
      { status: 403 },
    );
  }
  const unavailable =
    candidate.code === "SUPABASE_SERVICE_ROLE_CONFIGURATION_MISSING" ||
    candidate.name === "SupabaseConfigurationError";
  return NextResponse.json(
    new AIOperationsError(
      "AI_TOOL_FAILED",
      unavailable
        ? "The operations data service is not configured on this environment."
        : AI_OPERATIONS_MESSAGES.AI_TOOL_FAILED,
      unavailable ? 503 : 500,
      !unavailable,
      "USE_OPERATIONS_SCREENS",
    ).toEnvelope(),
    { status: unavailable ? 503 : 500 },
  );
}
