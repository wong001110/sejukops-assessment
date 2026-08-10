import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { AIConfigError } from "@/domain/ai-config/errors";

type ErrorLike = Readonly<{ code?: unknown; name?: unknown }>;

function errorLike(value: unknown): ErrorLike {
  return value && typeof value === "object" ? (value as ErrorLike) : {};
}

export function aiSettingsApiError(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "AI_CONFIG_VALIDATION_FAILED",
          message: "Check the highlighted AI settings and try again.",
          fieldErrors: error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    );
  }
  if (error instanceof SyntaxError) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_JSON",
          message: "The request body is not valid JSON.",
        },
      },
      { status: 400 },
    );
  }
  if (error instanceof AIConfigError) {
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
      {
        error: {
          code: "AI_CONFIG_PERMISSION_DENIED",
          message: "AI provider settings are available to Admin users only.",
        },
      },
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
          code: "AI_CONFIG_DATA_ACCESS_FAILED",
          message: "AI settings are not configured on this environment.",
        },
      },
      { status: 503 },
    );
  }
  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "The AI settings request could not be completed.",
      },
    },
    { status: 500 },
  );
}
