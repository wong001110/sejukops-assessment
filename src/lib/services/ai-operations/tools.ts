import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  getJobsArgumentsSchema,
  getOperationalSummaryArgumentsSchema,
  getTechnicianStatsArgumentsSchema,
  getWorkloadArgumentsSchema,
  type GetJobsArguments,
  type GetOperationalSummaryArguments,
  type GetTechnicianStatsArguments,
  type GetWorkloadArguments,
  type OperationsToolName,
} from "@/domain/ai-operations/contracts";
import {
  AI_OPERATIONS_MESSAGES,
  AIOperationsError,
} from "@/domain/ai-operations/errors";
import type { AuthorizedDataContext } from "@/lib/supabase/privileged-server";
import { createAuthorizedDataContext } from "@/lib/supabase/privileged-server";

const rangeSchema = z
  .object({
    start: z.string().datetime({ offset: true }),
    end: z.string().datetime({ offset: true }),
  })
  .strict();

const jobsResultSchema = z
  .object({
    range: rangeSchema.nullable(),
    items: z
      .array(
        z
          .object({
            order_number: z.string().regex(/^ORD-[0-9]{4}-[0-9]{4,}$/),
            status: z.enum([
              "NEW",
              "ASSIGNED",
              "IN_PROGRESS",
              "JOB_DONE",
              "REVIEWED",
              "CLOSED",
            ]),
            service_type: z.string().min(1).max(240),
            technician_name: z.string().min(1).max(160).nullable(),
            scheduled_at: z.string().datetime({ offset: true }).nullable(),
            completed_at: z.string().datetime({ offset: true }).nullable(),
            final_amount: z.coerce.number().finite().nonnegative(),
            sort_at: z.string().datetime({ offset: true }),
          })
          .strict(),
      )
      .max(25),
  })
  .strict();

const technicianStatsResultSchema = z
  .object({
    range: rangeSchema,
    items: z
      .array(
        z
          .object({
            technician_id: z.string().uuid(),
            technician_name: z.string().min(1).max(160),
            completed_jobs: z.coerce.number().int().nonnegative(),
            completed_amount: z.coerce.number().finite().nonnegative(),
          })
          .strict(),
      )
      .max(25),
  })
  .strict();

const operationalSummaryResultSchema = z
  .object({
    range: rangeSchema,
    completedJobs: z.coerce.number().int().nonnegative(),
    totalAmount: z.coerce.number().finite().nonnegative(),
  })
  .strict();

const workloadResultSchema = z
  .object({
    range: rangeSchema,
    items: z
      .array(
        z
          .object({
            technician_id: z.string().uuid(),
            technician_name: z.string().min(1).max(160),
            active_jobs: z.coerce.number().int().nonnegative(),
            assigned_jobs: z.coerce.number().int().nonnegative(),
            in_progress_jobs: z.coerce.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(25),
  })
  .strict();

export type JobsToolResult = z.infer<typeof jobsResultSchema>;
export type TechnicianStatsToolResult = z.infer<
  typeof technicianStatsResultSchema
>;
export type OperationalSummaryToolResult = z.infer<
  typeof operationalSummaryResultSchema
>;
export type WorkloadToolResult = z.infer<typeof workloadResultSchema>;

export type OperationsToolResultMap = Readonly<{
  getJobs: JobsToolResult;
  getTechnicianStats: TechnicianStatsToolResult;
  getOperationalSummary: OperationalSummaryToolResult;
  getWorkload: WorkloadToolResult;
}>;

export type ExecutedOperationsTool<TName extends OperationsToolName = OperationsToolName> =
  Readonly<{
    name: TName;
    arguments: TName extends "getJobs"
      ? GetJobsArguments
      : TName extends "getTechnicianStats"
        ? GetTechnicianStatsArguments
        : TName extends "getOperationalSummary"
          ? GetOperationalSummaryArguments
          : GetWorkloadArguments;
    result: OperationsToolResultMap[TName];
    resultCount: number;
  }>;

function throwToolError(error: { message?: string } | null): never {
  if (
    error?.message?.includes("INVALID_MANAGER_ACTOR") ||
    error?.message?.includes("INVALID_AI_RUNTIME_ACTOR")
  ) {
    throw new AIOperationsError(
      "AI_OPERATIONS_PERMISSION_DENIED",
      AI_OPERATIONS_MESSAGES.AI_OPERATIONS_PERMISSION_DENIED,
      403,
      false,
      "USE_OPERATIONS_SCREENS",
    );
  }
  throw new AIOperationsError(
    "AI_TOOL_FAILED",
    AI_OPERATIONS_MESSAGES.AI_TOOL_FAILED,
    503,
    true,
    "USE_OPERATIONS_SCREENS",
  );
}

export async function createManagerAIDataContext(): Promise<AuthorizedDataContext> {
  const context = await createAuthorizedDataContext("ai:use");
  if (context.identity.role !== "MANAGER") {
    throw new AIOperationsError(
      "AI_OPERATIONS_PERMISSION_DENIED",
      AI_OPERATIONS_MESSAGES.AI_OPERATIONS_PERMISSION_DENIED,
      403,
      false,
      "USE_OPERATIONS_SCREENS",
    );
  }
  const { error } = await context.supabase.rpc("ai_assert_runtime_actor", {
    p_actor_profile_id: context.identity.profileId,
  });
  if (error) throwToolError(error);
  return context;
}

async function executeRpc(
  supabase: SupabaseClient,
  functionName: string,
  parameters: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await supabase.rpc(functionName, parameters);
  if (error) throwToolError(error);
  return data;
}

export async function executeOperationsTool<TName extends OperationsToolName>(
  context: AuthorizedDataContext,
  name: TName,
  rawArguments: unknown,
): Promise<ExecutedOperationsTool<TName>> {
  if (name === "getJobs") {
    const args = getJobsArgumentsSchema.parse(rawArguments);
    const result = jobsResultSchema.parse(
      await executeRpc(context.supabase, "manager_ai_get_jobs", {
        p_actor_profile_id: context.identity.profileId,
        p_period: args.period ?? null,
        p_technician_names: args.technicianNames ?? null,
        p_statuses: args.statuses ?? null,
        p_service_types: args.serviceTypes ?? null,
        p_order_numbers: args.orderNumbers ?? null,
        p_completed_only: args.completedOnly,
        p_limit: Math.min(Math.max(args.limit, 1), 25),
      }),
    );
    return {
      name,
      arguments: args,
      result,
      resultCount: result.items.length,
    } as ExecutedOperationsTool<TName>;
  }
  if (name === "getTechnicianStats") {
    const args = getTechnicianStatsArgumentsSchema.parse(rawArguments);
    const result = technicianStatsResultSchema.parse(
      await executeRpc(context.supabase, "manager_ai_get_technician_stats", {
        p_actor_profile_id: context.identity.profileId,
        p_period: args.period,
        p_technician_names: args.technicianNames ?? null,
        p_limit: Math.min(Math.max(args.limit, 1), 25),
      }),
    );
    return {
      name,
      arguments: args,
      result,
      resultCount: args.technicianNames?.length
        ? result.items.length
        : result.items.filter((item) => item.completed_jobs > 0).length,
    } as ExecutedOperationsTool<TName>;
  }
  if (name === "getOperationalSummary") {
    const args = getOperationalSummaryArgumentsSchema.parse(rawArguments);
    const result = operationalSummaryResultSchema.parse(
      await executeRpc(context.supabase, "manager_ai_get_operational_summary", {
        p_actor_profile_id: context.identity.profileId,
        p_period: args.period,
      }),
    );
    return {
      name,
      arguments: args,
      result,
      resultCount: result.completedJobs,
    } as ExecutedOperationsTool<TName>;
  }
  const args = getWorkloadArgumentsSchema.parse(rawArguments);
  const result = workloadResultSchema.parse(
    await executeRpc(context.supabase, "manager_ai_get_workload", {
      p_actor_profile_id: context.identity.profileId,
      p_period: args.period,
      p_technician_names: args.technicianNames ?? null,
      p_limit: Math.min(Math.max(args.limit, 1), 25),
    }),
  );
  return {
    name,
    arguments: args,
    result,
    resultCount: args.technicianNames?.length
      ? result.items.length
      : result.items.filter((item) => item.active_jobs > 0).length,
  } as ExecutedOperationsTool<TName>;
}
