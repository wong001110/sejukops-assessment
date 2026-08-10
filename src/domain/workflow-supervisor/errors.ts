export type WorkflowSupervisorErrorCode =
  | "WORKFLOW_SUPERVISOR_PERMISSION_DENIED"
  | "WORKFLOW_FLAG_NOT_FOUND"
  | "WORKFLOW_EXPLANATION_CONFLICT"
  | "WORKFLOW_SUPERVISOR_DATA_ACCESS_FAILED";

export class WorkflowSupervisorError extends Error {
  constructor(
    readonly code: WorkflowSupervisorErrorCode,
    message: string,
    readonly status: 403 | 404 | 409 | 503,
    readonly retryable = false,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WorkflowSupervisorError";
  }

  toEnvelope() {
    return {
      error: {
        code: this.code,
        message: this.message,
        retryable: this.retryable,
        action: this.retryable ? ("RETRY" as const) : ("REVIEW_FLAG" as const),
      },
    };
  }
}

export const WORKFLOW_SUPERVISOR_MESSAGES = {
  WORKFLOW_SUPERVISOR_PERMISSION_DENIED:
    "Workflow explanations are available to active Manager users only.",
  WORKFLOW_FLAG_NOT_FOUND: "The workflow flag could not be found.",
  WORKFLOW_EXPLANATION_CONFLICT:
    "This explanation request is already in progress or conflicts with another flag.",
  WORKFLOW_SUPERVISOR_DATA_ACCESS_FAILED:
    "The workflow flag could not be updated. Its deterministic facts remain available in the review.",
} satisfies Record<WorkflowSupervisorErrorCode, string>;
