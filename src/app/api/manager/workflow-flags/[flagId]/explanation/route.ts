import { NextResponse } from "next/server";
import { z, ZodError } from "zod";

import { workflowExplanationRequestSchema } from "@/domain/workflow-supervisor/contracts";
import { WorkflowSupervisorError } from "@/domain/workflow-supervisor/errors";
import { explainWorkflowFlag } from "@/lib/services/workflow-supervisor/service";
import { observedAIJson } from "@/app/api/_shared/ai-provider-observation";

export const runtime = "nodejs";

type RouteContext = Readonly<{ params: Promise<{ flagId: string }> }>;
type ErrorLike = Readonly<{ code?: unknown; name?: unknown }>;

function apiError(error: unknown): NextResponse {
  if (error instanceof WorkflowSupervisorError) {
    return NextResponse.json(error.toEnvelope(), { status: error.status });
  }
  if (error instanceof ZodError || error instanceof SyntaxError) {
    return NextResponse.json(
      {
        error: {
          code: "WORKFLOW_SUPERVISOR_VALIDATION_FAILED",
          message: "Provide a valid explanation request and try again.",
          retryable: false,
          action: "REVIEW_FLAG",
        },
      },
      { status: 400 },
    );
  }
  const candidate =
    error && typeof error === "object" ? (error as ErrorLike) : {};
  if (candidate.code === "DEMO_SESSION_REQUIRED") {
    return NextResponse.json(
      {
        error: {
          code: "WORKFLOW_SUPERVISOR_PERMISSION_DENIED",
          message: "Choose a Manager demo user first.",
          retryable: false,
          action: "REVIEW_FLAG",
        },
      },
      { status: 401 },
    );
  }
  if (candidate.code === "PERMISSION_DENIED") {
    return NextResponse.json(
      new WorkflowSupervisorError(
        "WORKFLOW_SUPERVISOR_PERMISSION_DENIED",
        "Workflow explanations are available to active Manager users only.",
        403,
      ).toEnvelope(),
      { status: 403 },
    );
  }
  return NextResponse.json(
    new WorkflowSupervisorError(
      "WORKFLOW_SUPERVISOR_DATA_ACCESS_FAILED",
      "The explanation could not be generated. The deterministic workflow flag remains available.",
      503,
      true,
    ).toEnvelope(),
    { status: 503 },
  );
}

export async function POST(request: Request, context: RouteContext) {
  return observedAIJson(
    request,
    "WORKFLOW_EXPLANATION",
    async () => {
      const { flagId: candidate } = await context.params;
      const flagId = z.string().uuid().parse(candidate);
      const input = workflowExplanationRequestSchema.parse(await request.json());
      return explainWorkflowFlag(flagId, input);
    },
    apiError,
  );
}
