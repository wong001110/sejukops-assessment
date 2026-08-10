import { z } from "zod";

export const AI_TASK_TYPES = [
  "OPERATIONS_QUERY",
  "WORKFLOW_EXPLANATION",
  "OPERATIONAL_INSIGHT",
  "DOCUMENT_UNDERSTANDING",
] as const;
export const aiTaskTypeSchema = z.enum(AI_TASK_TYPES);
export type AITaskType = z.infer<typeof aiTaskTypeSchema>;

export const AI_PROVIDER_TYPES = ["OPENAI_COMPATIBLE"] as const;
export const aiProviderTypeSchema = z.enum(AI_PROVIDER_TYPES);
export type AIProviderType = z.infer<typeof aiProviderTypeSchema>;

export const AI_PROVIDER_STATUSES = ["ACTIVE", "DISABLED", "INVALID"] as const;
export const aiProviderStatusSchema = z.enum(AI_PROVIDER_STATUSES);
export type AIProviderStatus = z.infer<typeof aiProviderStatusSchema>;

export const AI_ROUTING_MODES = ["SINGLE_MODEL", "TASK_BASED"] as const;
export const aiRoutingModeSchema = z.enum(AI_ROUTING_MODES);
export type AIRoutingMode = z.infer<typeof aiRoutingModeSchema>;

export const AI_INPUT_KINDS = ["TEXT", "IMAGE"] as const;
export const aiInputKindSchema = z.enum(AI_INPUT_KINDS);
export type AIInputKind = z.infer<typeof aiInputKindSchema>;

export const aiModelCapabilitiesSchema = z
  .object({
    text: z.boolean(),
    vision: z.boolean(),
    toolCalling: z.boolean(),
    structuredOutput: z.boolean(),
  })
  .strict();
export type AIModelCapabilities = z.infer<typeof aiModelCapabilitiesSchema>;
export type AICapability = keyof AIModelCapabilities;

export const AI_TASK_REQUIREMENTS: Readonly<
  Record<AITaskType, readonly AICapability[]>
> = {
  OPERATIONS_QUERY: ["text", "toolCalling", "structuredOutput"],
  WORKFLOW_EXPLANATION: ["text"],
  OPERATIONAL_INSIGHT: ["text"],
  DOCUMENT_UNDERSTANDING: ["text", "structuredOutput"],
};

export function requiredCapabilitiesForTask(
  task: AITaskType,
  inputKind: AIInputKind = "TEXT",
): readonly AICapability[] {
  const base = AI_TASK_REQUIREMENTS[task];
  if (task === "DOCUMENT_UNDERSTANDING" && inputKind === "IMAGE") {
    return [...base, "vision"];
  }
  return base;
}

export function missingCapabilitiesForTask(
  capabilities: AIModelCapabilities,
  task: AITaskType,
  inputKind: AIInputKind = "TEXT",
): readonly AICapability[] {
  return requiredCapabilitiesForTask(task, inputKind).filter(
    (capability) => !capabilities[capability],
  );
}

const forbiddenHostSuffixes = [".localhost", ".local", ".internal"];

function isPublicIpv4(hostname: string): boolean {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return true;
  const octets = hostname.split(".").map(Number);
  if (octets.some((part) => part < 0 || part > 255)) return false;
  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

export function normalizeSafeAIBaseUrl(value: string): string {
  const parsed = new URL(value.trim());
  const hostname = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    hostname === "localhost" ||
    hostname.includes(":") ||
    hostname.startsWith("[") ||
    forbiddenHostSuffixes.some((suffix) => hostname.endsWith(suffix)) ||
    !isPublicIpv4(hostname)
  ) {
    throw new Error("Base URL must be a public HTTPS endpoint without credentials, query, or fragment");
  }
  const normalizedPath = parsed.pathname.replace(/\/+$/, "");
  parsed.pathname = normalizedPath || "/";
  return parsed.toString().replace(/\/$/, "");
}

const safeBaseUrlSchema = z
  .string()
  .trim()
  .min(1, "Base URL is required")
  .max(2048)
  .transform((value, context) => {
    try {
      return normalizeSafeAIBaseUrl(value);
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Use a public HTTPS provider URL without credentials, query parameters, or fragments",
      });
      return z.NEVER;
    }
  });

const boundedText = (label: string, maximum: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(maximum)
    .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), `${label} contains invalid characters`);

const providerFieldsSchema = z
  .object({
    name: boundedText("Provider name", 120),
    providerType: aiProviderTypeSchema,
    baseUrl: safeBaseUrlSchema,
    model: boundedText("Model", 240),
    capabilities: aiModelCapabilitiesSchema,
    status: aiProviderStatusSchema.default("ACTIVE"),
  })
  .strict();

const PRINTABLE_TOKEN = /^[!-~]+$/;
const apiKeySchema = z
  .string()
  .trim()
  .min(4, "API key must contain at least 4 characters")
  .max(4096)
  .regex(PRINTABLE_TOKEN, "API key must not contain whitespace or control characters");

export const createAIProviderSchema = providerFieldsSchema.extend({
  apiKey: apiKeySchema,
  requestKey: z.string().uuid(),
});

export const updateAIProviderSchema = providerFieldsSchema
  .partial()
  .extend({
    apiKey: z
      .string()
      .trim()
      .max(4096)
      .refine(
        (value) =>
          value === "" || (value.length >= 4 && PRINTABLE_TOKEN.test(value)),
        "API key must be blank to preserve it or contain at least 4 non-whitespace characters",
      )
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Provide at least one change");

export const testUnsavedAIProviderSchema = providerFieldsSchema
  .omit({ name: true, status: true })
  .extend({ apiKey: apiKeySchema })
  .strict();

export const testSavedAIProviderSchema = z
  .object({
    apiKey: z
      .string()
      .trim()
      .max(4096)
      .refine(
        (value) =>
          value === "" || (value.length >= 4 && PRINTABLE_TOKEN.test(value)),
        "API key must be blank to use the saved credential or be a valid token",
      )
      .optional(),
  })
  .strict();

export const aiTaskRoutesInputSchema = z
  .object({
    OPERATIONS_QUERY: z.string().uuid().nullable(),
    WORKFLOW_EXPLANATION: z.string().uuid().nullable(),
    OPERATIONAL_INSIGHT: z.string().uuid().nullable(),
    DOCUMENT_UNDERSTANDING: z.string().uuid().nullable(),
  })
  .strict();

export const updateAIRoutingSchema = z.discriminatedUnion("routingMode", [
  z
    .object({
      routingMode: z.literal("SINGLE_MODEL"),
      defaultProviderConfigId: z.string().uuid().nullable(),
    })
    .strict(),
  z
    .object({
      routingMode: z.literal("TASK_BASED"),
      routes: aiTaskRoutesInputSchema,
    })
    .strict(),
]);

export type CreateAIProviderInput = z.infer<typeof createAIProviderSchema>;
export type UpdateAIProviderInput = z.infer<typeof updateAIProviderSchema>;
export type TestUnsavedAIProviderInput = z.infer<typeof testUnsavedAIProviderSchema>;
export type TestSavedAIProviderInput = z.infer<typeof testSavedAIProviderSchema>;
export type UpdateAIRoutingInput = z.infer<typeof updateAIRoutingSchema>;

export type AIProviderProfile = Readonly<{
  id: string;
  name: string;
  providerType: AIProviderType;
  baseUrl: string;
  model: string;
  capabilities: AIModelCapabilities;
  status: AIProviderStatus;
  credential: Readonly<{ configured: boolean; last4: string | null }>;
  createdAt: string;
  updatedAt: string;
}>;

export type AIRouteMap = Readonly<Record<AITaskType, string | null>>;

export type AIEnvironmentFallbackSummary = Readonly<{
  id: "environment:openrouter";
  name: string;
  providerType: AIProviderType;
  baseUrl: string;
  model: string;
  capabilities: AIModelCapabilities;
  tasks: readonly AITaskType[];
  configured: boolean;
}>;

export type AISettingsSnapshot = Readonly<{
  settings: Readonly<{
    routingMode: AIRoutingMode;
    defaultProviderConfigId: string | null;
    updatedAt: string | null;
  }>;
  providers: readonly AIProviderProfile[];
  routes: AIRouteMap;
  environmentFallbacks: readonly AIEnvironmentFallbackSummary[];
}>;

export type AIConnectionTestResult = Readonly<{
  ok: true;
  checkedAt: string;
}>;
