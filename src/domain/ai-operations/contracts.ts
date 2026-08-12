import { z } from "zod";

import { ORDER_STATUSES } from "@/domain/operations";
import {
  MANAGER_DASHBOARD_TIMEZONE,
  managerDashboardPeriodSchema,
} from "@/domain/manager-dashboard/contracts";

export const OPERATIONAL_PERIODS = [
  "today",
  "this_week",
  "last_week",
  "this_month",
] as const;
export const operationalPeriodSchema = z.enum(OPERATIONAL_PERIODS);
export type OperationalPeriod = z.infer<typeof operationalPeriodSchema>;

export const SUPPORTED_OPERATION_INTENTS = [
  "JOBS_LOOKUP",
  "TECHNICIAN_PERFORMANCE",
  "OPERATIONAL_SUMMARY",
  "WORKLOAD",
] as const;
export const supportedOperationIntentSchema = z.enum(
  SUPPORTED_OPERATION_INTENTS,
);
export type SupportedOperationIntent = z.infer<
  typeof supportedOperationIntentSchema
>;

export const OPERATIONS_TOOL_NAMES = [
  "getJobs",
  "getTechnicianStats",
  "getOperationalSummary",
  "getWorkload",
] as const;
export const operationsToolNameSchema = z.enum(OPERATIONS_TOOL_NAMES);
export type OperationsToolName = z.infer<typeof operationsToolNameSchema>;

const boundedFilterTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine(
    (value) => !/[\u0000-\u001f\u007f]/.test(value),
    "Filter contains invalid characters",
  );

export const conversationContextSchema = z
  .object({
    intent: supportedOperationIntentSchema,
    period: operationalPeriodSchema.optional(),
    technicianName: boundedFilterTextSchema.optional(),
    status: z.enum(ORDER_STATUSES).optional(),
    serviceType: boundedFilterTextSchema.optional(),
    orderNumber: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^ORD-[0-9]{4}-[0-9]{4,}$/)
      .optional(),
  })
  .strict();
export type ConversationContext = z.infer<typeof conversationContextSchema>;

export const aiOperationsRequestSchema = z
  .object({
    question: z
      .string()
      .trim()
      .min(1, "Enter an operations question")
      .max(1_000)
      .refine(
        (value) => !/[\u0000\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),
        "Question contains invalid characters",
      ),
    context: conversationContextSchema.nullable().optional(),
  })
  .strict();
export type AIOperationsRequest = z.infer<typeof aiOperationsRequestSchema>;

const boundedLimitSchema = z.number().int().min(1).max(25).default(20);

export const getJobsArgumentsSchema = z
  .object({
    period: operationalPeriodSchema.optional(),
    technicianName: boundedFilterTextSchema.optional(),
    status: z.enum(ORDER_STATUSES).optional(),
    serviceType: boundedFilterTextSchema.optional(),
    orderNumber: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^ORD-[0-9]{4}-[0-9]{4,}$/)
      .optional(),
    completedOnly: z.boolean().default(false),
    limit: boundedLimitSchema,
  })
  .strict()
  .refine((value) => Boolean(value.period || value.orderNumber), {
    message: "A supported period or order number is required",
  });
export type GetJobsArguments = z.infer<typeof getJobsArgumentsSchema>;

export const getTechnicianStatsArgumentsSchema = z
  .object({
    period: operationalPeriodSchema,
    technicianName: boundedFilterTextSchema.optional(),
    limit: boundedLimitSchema,
  })
  .strict();
export type GetTechnicianStatsArguments = z.infer<
  typeof getTechnicianStatsArgumentsSchema
>;

export const getOperationalSummaryArgumentsSchema = z
  .object({ period: operationalPeriodSchema })
  .strict();
export type GetOperationalSummaryArguments = z.infer<
  typeof getOperationalSummaryArgumentsSchema
>;

export const getWorkloadArgumentsSchema = z
  .object({
    period: operationalPeriodSchema,
    technicianName: boundedFilterTextSchema.optional(),
    limit: boundedLimitSchema,
  })
  .strict();
export type GetWorkloadArguments = z.infer<typeof getWorkloadArgumentsSchema>;

export const operationsToolArgumentsSchemas = {
  getJobs: getJobsArgumentsSchema,
  getTechnicianStats: getTechnicianStatsArgumentsSchema,
  getOperationalSummary: getOperationalSummaryArgumentsSchema,
  getWorkload: getWorkloadArgumentsSchema,
} as const;

export type OperationsToolArguments =
  | GetJobsArguments
  | GetTechnicianStatsArguments
  | GetOperationalSummaryArguments
  | GetWorkloadArguments;

export const operationsFactSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_.-]{0,119}$/),
    label: z.string().trim().min(1).max(160),
    value: z.union([
      z.string().max(1_000),
      z.number().finite(),
      z.array(z.string().max(160)).max(25),
    ]),
    kind: z.enum([
      "COUNT",
      "AMOUNT",
      "TEXT",
      "STATUS",
      "ORDER_NUMBER",
      "DATE_RANGE",
    ]),
  })
  .strict();
export type OperationsFact = z.infer<typeof operationsFactSchema>;

export const operationsToolCallSchema = z
  .object({
    name: operationsToolNameSchema,
    arguments: z.record(z.string(), z.unknown()),
    resultCount: z.number().int().min(0).max(25),
  })
  .strict();
export type OperationsToolCall = z.infer<typeof operationsToolCallSchema>;

const jobPresentationRowSchema = z
  .object({
    orderNumber: z.string().regex(/^ORD-[0-9]{4}-[0-9]{4,}$/),
    status: z.enum(ORDER_STATUSES),
    technicianName: z.string().trim().min(1).max(160).nullable(),
    serviceType: z.string().trim().min(1).max(120),
    finalAmount: z.number().finite().min(0),
  })
  .strict();

const technicianPresentationRowSchema = z
  .object({
    technicianId: z.string().uuid(),
    technicianName: z.string().trim().min(1).max(160),
    completedJobs: z.number().int().min(0),
    completedAmount: z.number().finite().min(0),
  })
  .strict();

const workloadPresentationRowSchema = z
  .object({
    technicianId: z.string().uuid(),
    technicianName: z.string().trim().min(1).max(160),
    activeJobs: z.number().int().min(0),
    assignedJobs: z.number().int().min(0),
    inProgressJobs: z.number().int().min(0),
  })
  .strict();

export const operationsPresentationSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("JOBS"),
        rows: z.array(jobPresentationRowSchema).max(25),
      })
      .strict(),
    z
      .object({
        kind: z.literal("TECHNICIAN_PERFORMANCE"),
        rows: z.array(technicianPresentationRowSchema).max(25),
      })
      .strict(),
    z
      .object({
        kind: z.literal("OPERATIONAL_SUMMARY"),
        completedJobs: z.number().int().min(0),
        totalAmount: z.number().finite().min(0),
      })
      .strict(),
    z
      .object({
        kind: z.literal("WORKLOAD"),
        rows: z.array(workloadPresentationRowSchema).max(25),
      })
      .strict(),
  ])
  .nullable()
  .default(null);
export type OperationsPresentation = z.infer<typeof operationsPresentationSchema>;

export const AI_OPERATIONS_OUTCOMES = [
  "ANSWER",
  "NO_DATA",
  "UNSUPPORTED",
  "CLARIFICATION",
] as const;
export const aiOperationsOutcomeSchema = z.enum(AI_OPERATIONS_OUTCOMES);
export type AIOperationsOutcome = z.infer<typeof aiOperationsOutcomeSchema>;

export const aiOperationsResponseSchema = z
  .object({
    outcome: aiOperationsOutcomeSchema,
    answer: z.string().trim().min(1).max(4_000),
    context: conversationContextSchema.nullable(),
    toolCalls: z.array(operationsToolCallSchema).max(1),
    facts: z.array(operationsFactSchema).max(150),
    presentation: operationsPresentationSchema,
    metadata: z
      .object({
        grounded: z.boolean(),
        timezone: z.literal(MANAGER_DASHBOARD_TIMEZONE),
        generatedAt: z.string().datetime({ offset: true }),
      })
      .strict(),
  })
  .strict();
export type AIOperationsResponse = z.infer<typeof aiOperationsResponseSchema>;

export const operationalInsightRequestSchema = z
  .object({
    period: managerDashboardPeriodSchema,
    metricsVersion: z
      .string()
      .regex(/^(today|this_week|this_month):[a-f0-9]{32}$/),
  })
  .strict();
export type OperationalInsightRequest = z.infer<
  typeof operationalInsightRequestSchema
>;

export const operationalInsightResponseSchema = z
  .object({
    period: managerDashboardPeriodSchema,
    metricsVersion: z.string().min(1).max(160),
    insight: z.string().trim().min(1).max(4_000),
    cached: z.boolean(),
    generatedAt: z.string().datetime({ offset: true }),
    facts: z.array(operationsFactSchema).min(1).max(150),
    citations: z.array(z.string().min(1).max(120)).min(1).max(50),
    metadata: z
      .object({
        grounded: z.literal(true),
        timezone: z.literal(MANAGER_DASHBOARD_TIMEZONE),
      })
      .strict(),
  })
  .strict();
export type OperationalInsightResponse = z.infer<
  typeof operationalInsightResponseSchema
>;

export const AI_OPERATIONS_ERROR_CODES = [
  "AI_OPERATIONS_VALIDATION_FAILED",
  "AI_OPERATIONS_PERMISSION_DENIED",
  "AI_OPERATIONS_CONTEXT_REQUIRED",
  "AI_OPERATIONS_STALE_METRICS",
  "AI_NOT_CONFIGURED",
  "AI_AUTH_FAILED",
  "AI_RATE_LIMITED",
  "AI_TIMEOUT",
  "AI_PROVIDER_UNAVAILABLE",
  "AI_TOOL_FAILED",
  "AI_INVALID_RESPONSE",
  "AI_CAPABILITY_MISMATCH",
] as const;
export const aiOperationsErrorCodeSchema = z.enum(AI_OPERATIONS_ERROR_CODES);
export type AIOperationsErrorCode = z.infer<
  typeof aiOperationsErrorCodeSchema
>;

export const aiOperationsErrorEnvelopeSchema = z
  .object({
    error: z
      .object({
        code: aiOperationsErrorCodeSchema,
        message: z.string().min(1).max(500),
        retryable: z.boolean(),
        action: z.enum([
          "RETRY",
          "CONTACT_ADMIN",
          "USE_OPERATIONS_SCREENS",
          "REFRESH_DASHBOARD",
        ]),
      })
      .strict(),
  })
  .strict();
export type AIOperationsErrorEnvelope = z.infer<
  typeof aiOperationsErrorEnvelopeSchema
>;
