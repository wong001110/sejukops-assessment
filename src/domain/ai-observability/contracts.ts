import { z } from "zod";

export const AI_OBSERVATION_TASKS = ["PROVIDER_TEST","OPERATIONS_QUERY","OPERATIONAL_INSIGHT","WORKFLOW_EXPLANATION","DOCUMENT_UNDERSTANDING"] as const;
export const aiObservationTaskSchema = z.enum(AI_OBSERVATION_TASKS);
export type AIObservationTask = z.infer<typeof aiObservationTaskSchema>;
export const aiObservationStatusSchema = z.enum(["SUCCEEDED","CONTROLLED","FAILED"]);
export type AIObservationStatus = z.infer<typeof aiObservationStatusSchema>;
export const aiObservationListQuerySchema = z.object({task:aiObservationTaskSchema.optional(),status:aiObservationStatusSchema.optional(),page:z.coerce.number().int().min(1).max(10000).default(1),pageSize:z.coerce.number().int().min(5).max(100).default(12)});
export type AIObservationListQuery = z.infer<typeof aiObservationListQuerySchema>;

const tokenUsageSchema=z.object({promptTokens:z.number().int().nonnegative().nullable(),completionTokens:z.number().int().nonnegative().nullable(),totalTokens:z.number().int().nonnegative().nullable()}).strict();
const EMPTY_DEBUG_SNAPSHOT={systemPrompt:null,requestBody:null,responseBody:null,documentPayloadOmitted:false} as const;
export const aiProviderDebugSnapshotSchema=z.object({systemPrompt:z.string().max(32000).nullable(),requestBody:z.unknown().nullable(),responseBody:z.unknown().nullable(),documentPayloadOmitted:z.boolean()}).strict().default(EMPTY_DEBUG_SNAPSHOT);
export const aiProviderCallSummarySchema=z.object({sequence:z.number().int().positive(),providerType:z.string().min(1).max(120),providerSource:z.enum(["SAVED","ENVIRONMENT"]).nullable(),endpoint:z.string().min(1).max(2048),model:z.string().min(1).max(240),statusCode:z.number().int().min(0).max(599),statusText:z.string().max(160),durationMs:z.number().int().nonnegative(),usage:tokenUsageSchema.nullable(),errorName:z.string().max(120).nullable(),debug:aiProviderDebugSnapshotSchema}).strict();
export const aiObservationSafetySchema=z.object({rawPromptPersisted:z.literal(false),rawProviderResponsePersisted:z.literal(false),sanitizedDebugPayloadPersisted:z.boolean().default(false),credentialsPersisted:z.literal(false),documentFieldValuesPersisted:z.literal(false)}).strict();
export const aiObservationRecordSchema=z.object({id:z.string().uuid(),traceId:z.string().uuid(),createdAt:z.string().datetime({offset:true}),task:aiObservationTaskSchema,actorRole:z.enum(["ADMIN","TECHNICIAN","MANAGER"]),status:aiObservationStatusSchema,durationMs:z.number().int().nonnegative(),execution:z.record(z.string(),z.unknown()),providerCalls:z.array(aiProviderCallSummarySchema).max(8),errorCode:z.string().max(120).nullable(),safety:aiObservationSafetySchema}).strict();
export const aiObservationListResponseSchema=z.object({retentionDays:z.literal(7),observations:z.array(aiObservationRecordSchema).max(100),pagination:z.object({page:z.number().int().positive(),pageSize:z.number().int().positive(),total:z.number().int().nonnegative(),totalPages:z.number().int().positive(),hasMore:z.boolean()}).strict(),summary:z.object({runs:z.number().int().nonnegative(),providerCalls:z.number().int().nonnegative(),controlled:z.number().int().nonnegative(),failures:z.number().int().nonnegative(),averageLatency:z.number().int().nonnegative()}).strict()}).strict();
export type AIProviderDebugSnapshot=z.infer<typeof aiProviderDebugSnapshotSchema>;
export type AIProviderCallSummary=z.infer<typeof aiProviderCallSummarySchema>;
export type AIObservationSafety=z.infer<typeof aiObservationSafetySchema>;
export type AIObservationRecord=z.infer<typeof aiObservationRecordSchema>;
export type AIObservationListResponse=z.infer<typeof aiObservationListResponseSchema>;
