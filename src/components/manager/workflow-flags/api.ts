"use client";

import {
  workflowExplanationResponseSchema,
  type WorkflowExplanationRequest,
  type WorkflowExplanationResponse,
} from "@/domain/workflow-supervisor/contracts";

export class WorkflowExplanationApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly retryable = false,
    readonly status?: number,
  ) {
    super(message);
    this.name = "WorkflowExplanationApiError";
  }
}

export async function requestWorkflowExplanation(
  flagId: string,
  input: WorkflowExplanationRequest,
): Promise<WorkflowExplanationResponse> {
  const response = await fetch(`/api/manager/workflow-flags/${flagId}/explanation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const error = payload && typeof payload === "object" && "error" in payload
      ? (payload as { error?: { code?: string; message?: string; retryable?: boolean } }).error
      : undefined;
    throw new WorkflowExplanationApiError(
      error?.message ?? "The optional AI explanation could not be requested.",
      error?.code,
      error?.retryable ?? response.status >= 500,
      response.status,
    );
  }
  return workflowExplanationResponseSchema.parse(payload);
}
