import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  operationalInsightRequestSchema,
  operationalInsightResponseSchema,
  type OperationalInsightRequest,
  type OperationalInsightResponse,
  type OperationsFact,
} from "@/domain/ai-operations/contracts";
import {
  AI_OPERATIONS_MESSAGES,
  AIOperationsError,
} from "@/domain/ai-operations/errors";
import { AIConfigError } from "@/domain/ai-config/errors";
import type { ManagerDashboardResponse } from "@/domain/manager-dashboard/contracts";
import { ManagerDashboardError } from "@/domain/manager-dashboard/errors";
import {
  requestAIProviderCompletion,
  type AIChatCompletionDependencies,
  type AIChatCompletionResult,
  type AIProviderConnectionConfig,
} from "@/lib/ai/providers";
import { resolveAIProviderForTask } from "@/lib/services/ai-config/service";
import { getManagerDashboard } from "@/lib/services/manager-dashboard/service";

import { createManagerAIDataContext } from "./tools";

const insightModelResponseSchema = z
  .object({
    headline: z.string().trim().min(1).max(180),
    observations: z
      .array(
        z
          .object({
            text: z.string().trim().min(1).max(500),
            factKeys: z.array(z.string().min(1).max(120)).min(1).max(8),
          })
          .strict(),
      )
      .min(1)
      .max(4),
    recommendation: z.string().trim().min(1).max(500),
  })
  .strict();

type InsightModelResponse = z.infer<typeof insightModelResponseSchema>;

export type OperationalInsightTelemetry = Readonly<{
  latencyMs: number;
  cached: boolean;
  usage: AIChatCompletionResult["usage"] | null;
}>;

export type OperationalInsightDependencies = Readonly<{
  now?: () => Date;
  getDashboard?: typeof getManagerDashboard;
  createContext?: typeof createManagerAIDataContext;
  resolveProvider?: (
    task: "OPERATIONAL_INSIGHT",
  ) => Promise<AIProviderConnectionConfig>;
  complete?: typeof requestAIProviderCompletion;
  provider?: AIChatCompletionDependencies;
  onTelemetry?: (telemetry: OperationalInsightTelemetry) => void;
}>;

type InsightCacheRow = Readonly<{
  insight: string;
  citations: unknown;
  generated_at: string;
}>;

function factKeySegment(value: string): string {
  return value.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`);
}

export function buildDashboardInsightFacts(
  snapshot: ManagerDashboardResponse,
): readonly OperationsFact[] {
  const facts: OperationsFact[] = [
    { key: "summary.completed_jobs", label: "Completed jobs", value: snapshot.summary.completedJobs, kind: "COUNT" },
    { key: "summary.total_amount", label: "Total amount", value: snapshot.summary.totalAmount, kind: "AMOUNT" },
    { key: "summary.rescheduled", label: "Rescheduled", value: snapshot.summary.rescheduled, kind: "COUNT" },
    { key: "summary.average_job_value", label: "Average job value", value: snapshot.summary.averageJobValue, kind: "AMOUNT" },
    { key: "range.start", label: "Range start", value: snapshot.range.currentStart, kind: "DATE_RANGE" },
    { key: "range.end", label: "Range end", value: snapshot.range.currentEnd, kind: "DATE_RANGE" },
  ];
  for (const [key, metric] of Object.entries(snapshot.comparison)) {
    const normalizedKey = factKeySegment(key);
    facts.push(
      { key: `comparison.${normalizedKey}.current`, label: `${key} current`, value: metric.current, kind: key.toLowerCase().includes("amount") || key === "averageJobValue" ? "AMOUNT" : "COUNT" },
      { key: `comparison.${normalizedKey}.previous`, label: `${key} previous`, value: metric.previous, kind: key.toLowerCase().includes("amount") || key === "averageJobValue" ? "AMOUNT" : "COUNT" },
    );
    if (metric.percentChange !== null) {
      facts.push({ key: `comparison.${normalizedKey}.percent_change`, label: `${key} percent change`, value: metric.percentChange, kind: "COUNT" });
    }
  }
  const topTechnician = snapshot.technicians[0];
  if (topTechnician) {
    facts.push(
      { key: "technicians.top_name", label: "Top technician", value: topTechnician.name, kind: "TEXT" },
      { key: "technicians.top_jobs", label: "Top technician jobs", value: topTechnician.jobs, kind: "COUNT" },
      { key: "technicians.top_amount", label: "Top technician amount", value: topTechnician.amount, kind: "AMOUNT" },
      { key: "technicians.top_rescheduled", label: "Top technician reschedules", value: topTechnician.rescheduled, kind: "COUNT" },
    );
  }
  const topServiceType = snapshot.serviceTypes[0];
  if (topServiceType) {
    facts.push(
      { key: "service_types.top_name", label: "Top service type", value: topServiceType.type, kind: "TEXT" },
      { key: "service_types.top_count", label: "Top service type count", value: topServiceType.count, kind: "COUNT" },
      { key: "service_types.top_share_percent", label: "Top service type share", value: topServiceType.sharePercent, kind: "COUNT" },
    );
  }
  return facts;
}

function factMap(facts: readonly OperationsFact[]): ReadonlyMap<string, OperationsFact> {
  return new Map(facts.map((fact) => [fact.key, fact]));
}

function assertNumericClaimsAreCited(
  text: string,
  citedFacts: readonly OperationsFact[],
): void {
  const allowed = citedFacts
    .filter((fact) => typeof fact.value === "number")
    .map((fact) => Number(fact.value));
  const scrubbed = text.replace(/\d{4}-\d{2}-\d{2}T[^\s]+/g, "");
  for (const match of scrubbed.matchAll(/(?:^|[^\w.])(-?\d+(?:\.\d+)?)/g)) {
    const numeric = Number(match[1]);
    if (!allowed.some((value) => Math.abs(value - numeric) < 0.005)) {
      throw new Error("Insight contains a numeric claim not present in cited facts");
    }
  }
}

function validateInsightGrounding(
  model: InsightModelResponse,
  facts: readonly OperationsFact[],
): readonly string[] {
  const available = factMap(facts);
  const citations = new Set<string>();
  // Headline/recommendation may be qualitative but may not smuggle in uncited numbers.
  assertNumericClaimsAreCited(model.headline, []);
  assertNumericClaimsAreCited(model.recommendation, []);
  for (const observation of model.observations) {
    const cited = observation.factKeys.map((key) => {
      const fact = available.get(key);
      if (!fact) throw new Error("Insight cites an unknown fact");
      citations.add(key);
      return fact;
    });
    assertNumericClaimsAreCited(observation.text, cited);
  }
  return [...citations];
}

function formatInsight(model: InsightModelResponse): string {
  return [
    model.headline,
    ...model.observations.map((observation) => observation.text),
    `Suggested follow-up: ${model.recommendation}`,
  ].join("\n\n");
}

function parseCachedRow(value: unknown): InsightCacheRow | null {
  const parsed = z
    .object({
      insight: z.string().trim().min(1).max(4_000),
      citations: z.array(z.string().min(1).max(120)).min(1).max(50),
      generated_at: z.string().datetime({ offset: true }),
    })
    .strict()
    .safeParse(value);
  return parsed.success ? parsed.data : null;
}

async function readCache(
  supabase: SupabaseClient,
  request: OperationalInsightRequest,
): Promise<InsightCacheRow | null> {
  const { data, error } = await supabase
    .from("ai_operational_insight_cache")
    .select("insight,citations,generated_at")
    .eq("period", request.period)
    .eq("metrics_version", request.metricsVersion)
    .maybeSingle();
  if (error) {
    throw new AIOperationsError(
      "AI_TOOL_FAILED",
      AI_OPERATIONS_MESSAGES.AI_TOOL_FAILED,
      503,
      true,
      "USE_OPERATIONS_SCREENS",
      { cause: error },
    );
  }
  return data ? parseCachedRow(data) : null;
}

async function writeCache(
  supabase: SupabaseClient,
  request: OperationalInsightRequest,
  insight: string,
  citations: readonly string[],
  generatedAt: string,
): Promise<InsightCacheRow> {
  const { error } = await supabase.from("ai_operational_insight_cache").upsert(
    {
      period: request.period,
      metrics_version: request.metricsVersion,
      insight,
      citations,
      generated_at: generatedAt,
    },
    { onConflict: "period,metrics_version", ignoreDuplicates: true },
  );
  if (error) {
    throw new AIOperationsError(
      "AI_TOOL_FAILED",
      AI_OPERATIONS_MESSAGES.AI_TOOL_FAILED,
      503,
      true,
      "USE_OPERATIONS_SCREENS",
      { cause: error },
    );
  }
  const winner = await readCache(supabase, request);
  if (!winner) {
    throw new AIOperationsError(
      "AI_TOOL_FAILED",
      AI_OPERATIONS_MESSAGES.AI_TOOL_FAILED,
      503,
      true,
      "USE_OPERATIONS_SCREENS",
    );
  }
  return winner;
}

function mapProviderError(error: AIConfigError): AIOperationsError {
  const runtimeCode =
    error.code === "AI_AUTH_FAILED" ||
    error.code === "AI_RATE_LIMITED" ||
    error.code === "AI_TIMEOUT" ||
    error.code === "AI_PROVIDER_UNAVAILABLE" ||
    error.code === "AI_INVALID_RESPONSE" ||
    error.code === "AI_CAPABILITY_MISMATCH" ||
    error.code === "AI_NOT_CONFIGURED"
      ? error.code
      : "AI_NOT_CONFIGURED";
  const retryable =
    runtimeCode === "AI_RATE_LIMITED" ||
    runtimeCode === "AI_TIMEOUT" ||
    runtimeCode === "AI_PROVIDER_UNAVAILABLE" ||
    runtimeCode === "AI_INVALID_RESPONSE";
  return new AIOperationsError(
    runtimeCode,
    AI_OPERATIONS_MESSAGES[runtimeCode],
    error.status === 404 ? 503 : error.status,
    retryable,
    runtimeCode === "AI_NOT_CONFIGURED" ||
      runtimeCode === "AI_AUTH_FAILED" ||
      runtimeCode === "AI_CAPABILITY_MISMATCH"
      ? "CONTACT_ADMIN"
      : "RETRY",
    { cause: error },
  );
}

function parseOperationalInsightResponse(
  value: unknown,
): OperationalInsightResponse {
  const parsed = operationalInsightResponseSchema.safeParse(value);
  if (!parsed.success) {
    throw new AIOperationsError(
      "AI_INVALID_RESPONSE",
      AI_OPERATIONS_MESSAGES.AI_INVALID_RESPONSE,
      502,
      true,
      "RETRY",
      { cause: parsed.error },
    );
  }
  return parsed.data;
}

export async function getOperationalInsight(
  rawRequest: OperationalInsightRequest,
  dependencies: OperationalInsightDependencies = {},
): Promise<OperationalInsightResponse> {
  const request = operationalInsightRequestSchema.parse(rawRequest);
  const startedAt = performance.now();
  const now = dependencies.now ?? (() => new Date());
  const context = await (dependencies.createContext ?? createManagerAIDataContext)();
  let dashboard: ManagerDashboardResponse;
  try {
    dashboard = await (dependencies.getDashboard ?? getManagerDashboard)(
      request.period,
    );
  } catch (error) {
    if (error instanceof ManagerDashboardError) {
      throw new AIOperationsError(
        error.code === "MANAGER_DASHBOARD_PERMISSION_DENIED"
          ? "AI_OPERATIONS_PERMISSION_DENIED"
          : "AI_TOOL_FAILED",
        error.code === "MANAGER_DASHBOARD_PERMISSION_DENIED"
          ? AI_OPERATIONS_MESSAGES.AI_OPERATIONS_PERMISSION_DENIED
          : AI_OPERATIONS_MESSAGES.AI_TOOL_FAILED,
        error.code === "MANAGER_DASHBOARD_PERMISSION_DENIED" ? 403 : 503,
        error.code !== "MANAGER_DASHBOARD_PERMISSION_DENIED",
        "USE_OPERATIONS_SCREENS",
        { cause: error },
      );
    }
    throw error;
  }
  if (dashboard.metricsVersion !== request.metricsVersion) {
    throw new AIOperationsError(
      "AI_OPERATIONS_STALE_METRICS",
      AI_OPERATIONS_MESSAGES.AI_OPERATIONS_STALE_METRICS,
      409,
      false,
      "REFRESH_DASHBOARD",
    );
  }
  const facts = buildDashboardInsightFacts(dashboard);
  const cached = await readCache(context.supabase, request);
  if (cached) {
    const available = factMap(facts);
    const citations = z.array(z.string()).parse(cached.citations);
    if (citations.every((key) => available.has(key))) {
      try {
        assertNumericClaimsAreCited(
          cached.insight,
          citations.map((key) => available.get(key) as OperationsFact),
        );
      } catch {
        citations.length = 0;
      }
    }
    if (citations.length > 0) {
      dependencies.onTelemetry?.({
        latencyMs: performance.now() - startedAt,
        cached: true,
        usage: null,
      });
      return parseOperationalInsightResponse({
        period: request.period,
        metricsVersion: request.metricsVersion,
        insight: cached.insight,
        cached: true,
        generatedAt: cached.generated_at,
        facts,
        citations,
        metadata: { grounded: true, timezone: "Asia/Kuala_Lumpur" },
      });
    }
  }

  let provider: AIProviderConnectionConfig;
  try {
    provider = await (
      dependencies.resolveProvider ??
      ((task) => resolveAIProviderForTask(task))
    )("OPERATIONAL_INSIGHT");
  } catch (error) {
    if (error instanceof AIConfigError) throw mapProviderError(error);
    throw error;
  }
  let completion: AIChatCompletionResult;
  try {
    completion = await (dependencies.complete ?? requestAIProviderCompletion)(
      provider,
      {
        messages: [
          {
            role: "system",
            content:
              "Interpret only the supplied deterministic SejukOps dashboard facts. Return one JSON object with headline, 1-4 observations, and recommendation. Every observation must cite exact supplied factKeys. Do not claim causes, predictions, percentages, counts, or amounts not present in cited facts. Headline and recommendation must contain no numbers. This is decision support, not an automated decision.",
          },
          {
            role: "user",
            content: JSON.stringify({
              period: request.period,
              metricsVersion: request.metricsVersion,
              facts,
              schema: {
                headline: "string without numeric claims",
                observations: [{ text: "string", factKeys: ["exact.fact.key"] }],
                recommendation: "string without numeric claims",
              },
            }),
          },
        ],
        maxTokens: 650,
        responseFormat: "JSON_OBJECT",
      },
      dependencies.provider,
    );
  } catch (error) {
    if (error instanceof AIConfigError) throw mapProviderError(error);
    throw error;
  }
  let model: InsightModelResponse;
  let citations: readonly string[];
  try {
    model = insightModelResponseSchema.parse(JSON.parse(completion.content));
    citations = validateInsightGrounding(model, facts);
  } catch (error) {
    throw new AIOperationsError(
      "AI_INVALID_RESPONSE",
      AI_OPERATIONS_MESSAGES.AI_INVALID_RESPONSE,
      502,
      true,
      "RETRY",
      { cause: error },
    );
  }
  const insight = formatInsight(model);
  const generatedAt = now().toISOString();
  const cacheWinner = await writeCache(
    context.supabase,
    request,
    insight,
    citations,
    generatedAt,
  );
  const winnerCitations = z.array(z.string()).parse(cacheWinner.citations);
  const available = factMap(facts);
  if (!winnerCitations.every((key) => available.has(key))) {
    throw new AIOperationsError(
      "AI_INVALID_RESPONSE",
      AI_OPERATIONS_MESSAGES.AI_INVALID_RESPONSE,
      502,
      true,
      "RETRY",
    );
  }
  try {
    assertNumericClaimsAreCited(
      cacheWinner.insight,
      winnerCitations.map((key) => available.get(key) as OperationsFact),
    );
  } catch (error) {
    throw new AIOperationsError(
      "AI_INVALID_RESPONSE",
      AI_OPERATIONS_MESSAGES.AI_INVALID_RESPONSE,
      502,
      true,
      "RETRY",
      { cause: error },
    );
  }
  dependencies.onTelemetry?.({
    latencyMs: performance.now() - startedAt,
    cached: false,
    usage: completion.usage,
  });
  return parseOperationalInsightResponse({
    period: request.period,
    metricsVersion: request.metricsVersion,
    insight: cacheWinner.insight,
    cached: false,
    generatedAt: cacheWinner.generated_at,
    facts,
    citations: winnerCitations,
    metadata: { grounded: true, timezone: "Asia/Kuala_Lumpur" },
  });
}
