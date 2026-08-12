import { z } from "zod";

export const AI_OBSERVATION_TASKS = [
  "PROVIDER_TEST",
  "OPERATIONS_QUERY",
  "OPERATIONAL_INSIGHT",
  "WORKFLOW_EXPLANATION",
  "DOCUMENT_UNDERSTANDING",
] as const;

export const aiObservationTaskSchema = z.enum(AI_OBSERVATION_TASKS);
export type AIObservationTask = z.infer<typeof aiObservationTaskSchema>;

export const aiObservationStatusSchema = z.enum(["SUCCEEDED", "FAILED"]);
export type AIObservationStatus = z.infer<typeof aiObservationStatusSchema>;

const tokenUsageSchema = z
  .object({
    promptTokens: z.number().int().nonnegative().nullable(),
    completionTokens: z.number().int().nonnegative().nullable(),
    totalTokens: z.number().int().nonnegative().nullable(),
  })
  .strict();

export const aiProviderCallSummarySchema = z
  .object({
    sequence: z.number().int().positive(),
    providerType: z.string().min(1).max(120),
    providerSource: z.enum(["SAVED", "ENVIRONMENT"]).nullable(),
    endpoint: z.string().min(1).max(2048),
    model: z.string().min(1).max(240),
    statusCode: z.number().int().min(0).max(599),
    statusText: z.string().max(160),
    durationMs: z.number().int().nonnegative(),
    usage: tokenUsageSchema.nullable(),
    errorName: z.string().max(120).nullable(),
  })
  .strict();

export const aiObservationSafetySchema = z
  .object({
    rawPromptPersisted: z.literal(false),
    rawProviderResponsePersisted: z.literal(false),
    credentialsPersisted: z.literal(false),
    documentFieldValuesPersisted: z.literal(false),
  })
  .strict();

export const aiObservationRecordSchema = z
  .object({
    id: z.string().uuid(),
    traceId: z.string().uuid(),
    createdAt: z.string().datetime({ offset: true }),
    task: aiObservationTaskSchema,
    actorRole: z.enum(["ADMIN", "TECHNICIAN", "MANAGER"]),
    status: aiObservationStatusSchema,
    durationMs: z.number().int().nonnegative(),
    execution: z.record(z.string(), z.unknown()),
    providerCalls: z.array(aiProviderCallSummarySchema).max(8),
    errorCode: z.string().max(120).nullable(),
    safety: aiObservationSafetySchema,
  })
  .strict();

export const aiObservationListResponseSchema = z
  .object({
    retentionDays: z.literal(7),
    observations: z.array(aiObservationRecordSchema).max(100),
  })
  .strict();

export type AIProviderCallSummary = z.infer<
  typeof aiProviderCallSummarySchema
>;
export type AIObservationSafety = z.infer<typeof aiObservationSafetySchema>;
export type AIObservationRecord = z.infer<typeof aiObservationRecordSchema>;
export type AIObservationListResponse = z.infer<
  typeof aiObservationListResponseSchema
>;
