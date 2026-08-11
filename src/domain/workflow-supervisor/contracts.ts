import { z } from "zod";

export const WORKFLOW_SUPERVISOR_THRESHOLDS = Object.freeze({
  highAmountVarianceRatio: 0.5,
  highAmountVarianceMinimum: 100,
  unusualExtraChargeRatio: 1,
  unusualExtraChargeMinimum: 250,
});

export const workflowExplanationRequestSchema = z
  .object({ requestKey: z.string().uuid() })
  .strict();

const workflowExplanationSchema = z
  .object({
    status: z.enum(["NOT_REQUESTED", "AVAILABLE", "UNAVAILABLE"]),
    summary: z.string().trim().min(1).max(1_000).nullable(),
    recommendation: z.string().trim().min(1).max(1_000).nullable(),
    errorCode: z.string().trim().min(1).max(80).nullable(),
    generatedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

export const workflowFlagSchema = z
  .object({
    id: z.string().uuid(),
    orderId: z.string().uuid(),
    ruleCode: z.enum([
      "HIGH_AMOUNT_VARIANCE",
      "MISSING_EVIDENCE",
      "UNUSUAL_EXTRA_CHARGE",
    ]),
    completionRevision: z.coerce.number().int().positive(),
    severity: z.enum(["WARNING", "CRITICAL"]),
    title: z.string().trim().min(1).max(240),
    deterministicSummary: z.string().trim().min(1).max(1_000),
    details: z.record(z.unknown()),
    status: z.enum(["OPEN", "RESOLVED"]),
    explanation: workflowExplanationSchema,
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const workflowExplanationResponseSchema = z
  .object({
    flag: workflowFlagSchema,
    replayed: z.boolean(),
  })
  .strict();

export type WorkflowExplanationRequest = z.infer<
  typeof workflowExplanationRequestSchema
>;
export type WorkflowFlag = z.infer<typeof workflowFlagSchema>;
export type WorkflowExplanationResponse = z.infer<
  typeof workflowExplanationResponseSchema
>;

export const WORKFLOW_EXPLANATION_SAFE_ERROR_CODES = [
  "AI_NOT_CONFIGURED",
  "AI_AUTH_FAILED",
  "AI_RATE_LIMITED",
  "AI_TIMEOUT",
  "AI_PROVIDER_UNAVAILABLE",
  "AI_INVALID_RESPONSE",
  "AI_CAPABILITY_MISMATCH",
] as const;

export type WorkflowExplanationSafeErrorCode =
  (typeof WORKFLOW_EXPLANATION_SAFE_ERROR_CODES)[number];
