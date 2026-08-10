import "server-only";

import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AI_TASK_TYPES,
  aiModelCapabilitiesSchema,
  aiProviderStatusSchema,
  aiProviderTypeSchema,
  aiRoutingModeSchema,
  missingCapabilitiesForTask,
  normalizeSafeAIBaseUrl,
  type AIConnectionTestResult,
  type AIEnvironmentFallbackSummary,
  type AIInputKind,
  type AIProviderProfile,
  type AISettingsSnapshot,
  type AITaskType,
  type CreateAIProviderInput,
  type TestSavedAIProviderInput,
  type TestUnsavedAIProviderInput,
  type UpdateAIProviderInput,
  type UpdateAIRoutingInput,
} from "@/domain/ai-config/contracts";
import { AIConfigError, AI_ERROR_MESSAGES } from "@/domain/ai-config/errors";
import { safeAIProviderProfile } from "@/domain/ai-config/safe-profile";
import {
  getOpenRouterEnvironmentFallback,
  testAIProviderConnection,
  type AIProviderConnectionConfig,
  type AIProviderConnectionDependencies,
} from "@/lib/ai/providers";
import { createAuthorizedDataContext } from "@/lib/supabase/privileged-server";

import {
  decryptAIProviderCredential,
  encryptAIProviderCredential,
  signAIProviderCreatePayload,
  type EncryptedAIProviderCredential,
} from "./crypto";

const SETTINGS_ID = "00000000-0000-4000-8000-00000000a100";

type DataRecord = Record<string, unknown>;

type StoredProviderRow = Readonly<{
  id: string;
  name: string;
  provider_type: string;
  base_url: string | null;
  model: string;
  capabilities: unknown;
  encrypted_api_key: string | null;
  api_key_iv: string | null;
  api_key_auth_tag: string | null;
  encryption_version: number | null;
  key_last4: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}>;

export type ResolvedAIProvider = AIProviderConnectionConfig &
  Readonly<{ providerConfigId: string | null }>;

function dataRecord(value: unknown): DataRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AIConfigError(
      "AI_CONFIG_DATA_ACCESS_FAILED",
      AI_ERROR_MESSAGES.AI_CONFIG_DATA_ACCESS_FAILED,
      503,
    );
  }
  return value as DataRecord;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : text(value);
}

function mapStoredProvider(value: unknown): StoredProviderRow {
  const row = dataRecord(value);
  return {
    id: text(row.id),
    name: text(row.name),
    provider_type: text(row.provider_type),
    base_url: nullableText(row.base_url),
    model: text(row.model),
    capabilities: row.capabilities,
    encrypted_api_key: nullableText(row.encrypted_api_key),
    api_key_iv: nullableText(row.api_key_iv),
    api_key_auth_tag: nullableText(row.api_key_auth_tag),
    encryption_version:
      row.encryption_version === null || row.encryption_version === undefined
        ? null
        : Number(row.encryption_version),
    key_last4: nullableText(row.key_last4),
    status: text(row.status),
    created_at: text(row.created_at),
    updated_at: text(row.updated_at),
  };
}

export function mapSafeAIProvider(value: unknown): AIProviderProfile {
  const row = mapStoredProvider(value);
  return safeAIProviderProfile({
    id: row.id,
    name: row.name,
    providerType: row.provider_type,
    baseUrl: row.base_url,
    model: row.model,
    capabilities: row.capabilities,
    status: row.status,
    credentialConfigured: Boolean(
      row.encrypted_api_key &&
        row.api_key_iv &&
        row.api_key_auth_tag &&
        row.encryption_version,
    ),
    keyLast4: row.key_last4,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function throwDataError(error: { message?: string; code?: string } | null): never {
  const message = error?.message ?? "Unknown AI configuration data error";
  if (message.includes("INVALID_ADMIN_ACTOR")) {
    throw new AIConfigError(
      "AI_CONFIG_PERMISSION_DENIED",
      AI_ERROR_MESSAGES.AI_CONFIG_PERMISSION_DENIED,
      403,
    );
  }
  if (message.includes("INVALID_AI_RUNTIME_ACTOR")) {
    throw new AIConfigError(
      "AI_CONFIG_PERMISSION_DENIED",
      "You cannot use this AI feature.",
      403,
    );
  }
  if (message.includes("AI_PROVIDER_NOT_FOUND") || error?.code === "PGRST116") {
    throw new AIConfigError(
      "AI_CONFIG_NOT_FOUND",
      AI_ERROR_MESSAGES.AI_CONFIG_NOT_FOUND,
      404,
    );
  }
  if (message.includes("AI_CAPABILITY_MISMATCH")) {
    throw new AIConfigError(
      "AI_CAPABILITY_MISMATCH",
      AI_ERROR_MESSAGES.AI_CAPABILITY_MISMATCH,
      422,
    );
  }
  if (
    message.includes("IDEMPOTENCY_KEY_CONFLICT") ||
    message.includes("AI_PROVIDER_ID_CONFLICT")
  ) {
    throw new AIConfigError(
      "AI_CONFIG_CONFLICT",
      AI_ERROR_MESSAGES.AI_CONFIG_CONFLICT,
      409,
    );
  }
  if (
    message.includes("INVALID_AI_PROVIDER_CONFIG") ||
    message.includes("AI_PROVIDER_NOT_ROUTABLE") ||
    message.includes("INVALID_AI_ROUTES") ||
    message.includes("INVALID_AI_TASK") ||
    message.includes("INCOMPLETE_AI_ROUTES") ||
    message.includes("INVALID_AI_PROVIDER_ROUTE") ||
    message.includes("SINGLE_MODEL_ROUTES_NOT_ALLOWED") ||
    message.includes("TASK_ROUTING_DEFAULT_NOT_ALLOWED") ||
    message.includes("INVALID_AI_PROVIDER_IDEMPOTENCY") ||
    message.includes("AI_PROVIDER_CREATE_REQUEST_KEY_REQUIRED")
  ) {
    throw new AIConfigError(
      "AI_CONFIG_VALIDATION_FAILED",
      AI_ERROR_MESSAGES.AI_CONFIG_VALIDATION_FAILED,
      400,
    );
  }
  throw new AIConfigError(
    "AI_CONFIG_DATA_ACCESS_FAILED",
    AI_ERROR_MESSAGES.AI_CONFIG_DATA_ACCESS_FAILED,
    503,
  );
}

async function assertDatabaseActor(
  supabase: SupabaseClient,
  actorProfileId: string,
  purpose: "CONFIG" | "RUNTIME",
): Promise<void> {
  const functionName =
    purpose === "CONFIG" ? "ai_assert_config_actor" : "ai_assert_runtime_actor";
  const { error } = await supabase.rpc(functionName, {
    p_actor_profile_id: actorProfileId,
  });
  if (error) throwDataError(error);
}

async function createAdminAIContext(permission: "ai_config:view" | "ai_config:manage") {
  const context = await createAuthorizedDataContext(permission);
  if (context.identity.role !== "ADMIN") {
    throw new AIConfigError(
      "AI_CONFIG_PERMISSION_DENIED",
      AI_ERROR_MESSAGES.AI_CONFIG_PERMISSION_DENIED,
      403,
    );
  }
  await assertDatabaseActor(context.supabase, context.identity.profileId, "CONFIG");
  return context;
}

async function createRuntimeAIContext() {
  const context = await createAuthorizedDataContext("ai:use");
  await assertDatabaseActor(context.supabase, context.identity.profileId, "RUNTIME");
  return context;
}

const PROVIDER_SELECT = [
  "id",
  "name",
  "provider_type",
  "base_url",
  "model",
  "capabilities",
  "encrypted_api_key",
  "api_key_iv",
  "api_key_auth_tag",
  "encryption_version",
  "key_last4",
  "status",
  "created_at",
  "updated_at",
].join(",");

async function getProviderRow(
  supabase: SupabaseClient,
  providerConfigId: string,
): Promise<StoredProviderRow> {
  const { data, error } = await supabase
    .from("ai_provider_configs")
    .select(PROVIDER_SELECT)
    .eq("id", providerConfigId)
    .maybeSingle();
  if (error) throwDataError(error);
  if (!data) {
    throw new AIConfigError(
      "AI_CONFIG_NOT_FOUND",
      AI_ERROR_MESSAGES.AI_CONFIG_NOT_FOUND,
      404,
    );
  }
  return mapStoredProvider(data);
}

function environmentFallback(): ResolvedAIProvider | null {
  const fallback = getOpenRouterEnvironmentFallback();
  if (!fallback) return null;
  let baseUrl: string;
  try {
    baseUrl = normalizeSafeAIBaseUrl(fallback.baseUrl);
  } catch {
    return null;
  }
  return { ...fallback, baseUrl, providerConfigId: null };
}

function environmentFallbackSummaries(): readonly AIEnvironmentFallbackSummary[] {
  const fallback = environmentFallback();
  if (!fallback) return [];
  return [
    {
      id: "environment:openrouter",
      name: "Deployment OpenRouter",
      providerType: fallback.providerType,
      baseUrl: fallback.baseUrl,
      model: fallback.model,
      capabilities: fallback.capabilities,
      tasks: AI_TASK_TYPES.filter(
        (task) => missingCapabilitiesForTask(fallback.capabilities, task).length === 0,
      ),
      configured: true,
    },
  ];
}

function emptyRoutes(): Record<AITaskType, string | null> {
  return {
    OPERATIONS_QUERY: null,
    WORKFLOW_EXPLANATION: null,
    OPERATIONAL_INSIGHT: null,
    DOCUMENT_UNDERSTANDING: null,
  };
}

async function buildSnapshot(supabase: SupabaseClient): Promise<AISettingsSnapshot> {
  const [settingsResult, providerResult, routeResult] = await Promise.all([
    supabase
      .from("ai_settings")
      .select("routing_mode,default_provider_config_id,updated_at")
      .eq("id", SETTINGS_ID)
      .maybeSingle(),
    supabase.from("ai_provider_configs").select(PROVIDER_SELECT).order("created_at"),
    supabase.from("ai_task_routes").select("task_type,provider_config_id"),
  ]);
  if (settingsResult.error) throwDataError(settingsResult.error);
  if (providerResult.error) throwDataError(providerResult.error);
  if (routeResult.error) throwDataError(routeResult.error);

  const routes = emptyRoutes();
  for (const value of routeResult.data ?? []) {
    const row = dataRecord(value);
    const task = AI_TASK_TYPES.find((candidate) => candidate === row.task_type);
    if (!task) throwDataError(null);
    routes[task] = text(row.provider_config_id);
  }
  const settings = settingsResult.data ? dataRecord(settingsResult.data) : null;
  return {
    settings: {
      routingMode: settings
        ? aiRoutingModeSchema.parse(settings.routing_mode)
        : "SINGLE_MODEL",
      defaultProviderConfigId: settings
        ? nullableText(settings.default_provider_config_id)
        : null,
      updatedAt: settings ? nullableText(settings.updated_at) : null,
    },
    providers: (providerResult.data ?? []).map(mapSafeAIProvider),
    routes,
    environmentFallbacks: environmentFallbackSummaries(),
  };
}

export async function getAISettings(): Promise<AISettingsSnapshot> {
  const { supabase } = await createAdminAIContext("ai_config:view");
  return buildSnapshot(supabase);
}

function credentialRpcFields(credential: EncryptedAIProviderCredential) {
  return {
    p_encrypted_api_key: credential.encryptedApiKey,
    p_api_key_iv: credential.apiKeyIv,
    p_api_key_auth_tag: credential.apiKeyAuthTag,
    p_encryption_version: credential.encryptionVersion,
    p_key_last4: credential.keyLast4,
  };
}

async function upsertProvider(
  supabase: SupabaseClient,
  actorProfileId: string,
  providerConfigId: string,
  input: Omit<CreateAIProviderInput, "apiKey" | "requestKey">,
  credential: EncryptedAIProviderCredential,
  createIdentity?: Readonly<{ requestKey: string; payloadSignature: string }>,
): Promise<AIProviderProfile> {
  const { data, error } = await supabase.rpc("admin_upsert_ai_provider", {
    p_actor_profile_id: actorProfileId,
    p_provider_config_id: providerConfigId,
    p_create_request_key: createIdentity?.requestKey ?? null,
    p_create_payload_signature: createIdentity?.payloadSignature ?? null,
    p_name: input.name,
    p_provider_type: input.providerType,
    p_base_url: input.baseUrl,
    p_model: input.model,
    p_capabilities: input.capabilities,
    ...credentialRpcFields(credential),
    p_status: input.status,
  });
  if (error) throwDataError(error);
  const result = dataRecord(Array.isArray(data) ? data[0] : data);
  const persistedProviderConfigId = text(result.provider_config_id);
  return mapSafeAIProvider(
    await getProviderRow(supabase, persistedProviderConfigId),
  );
}

export async function createAIProvider(
  input: CreateAIProviderInput,
): Promise<AIProviderProfile> {
  const { identity, supabase } = await createAdminAIContext("ai_config:manage");
  const providerConfigId = randomUUID();
  const credential = encryptAIProviderCredential(providerConfigId, input.apiKey);
  const payloadSignature = signAIProviderCreatePayload(input);
  return upsertProvider(
    supabase,
    identity.profileId,
    providerConfigId,
    {
      name: input.name,
      providerType: input.providerType,
      baseUrl: input.baseUrl,
      model: input.model,
      capabilities: input.capabilities,
      status: input.status,
    },
    credential,
    { requestKey: input.requestKey, payloadSignature },
  );
}

export async function updateAIProvider(
  providerConfigId: string,
  input: UpdateAIProviderInput,
): Promise<AIProviderProfile> {
  const { identity, supabase } = await createAdminAIContext("ai_config:manage");
  const existing = await getProviderRow(supabase, providerConfigId);
  if (
    !existing.base_url ||
    !existing.encrypted_api_key ||
    !existing.api_key_iv ||
    !existing.api_key_auth_tag ||
    existing.encryption_version !== 1 ||
    !existing.key_last4
  ) {
    throw new AIConfigError(
      "AI_CONFIG_DECRYPTION_FAILED",
      AI_ERROR_MESSAGES.AI_CONFIG_DECRYPTION_FAILED,
      503,
    );
  }
  const savedCapabilities = aiModelCapabilitiesSchema.parse(existing.capabilities);
  const replacementKey = input.apiKey?.trim();
  const credential: EncryptedAIProviderCredential = replacementKey
    ? encryptAIProviderCredential(providerConfigId, replacementKey)
    : {
        encryptedApiKey: existing.encrypted_api_key,
        apiKeyIv: existing.api_key_iv,
        apiKeyAuthTag: existing.api_key_auth_tag,
        encryptionVersion: 1,
        keyLast4: existing.key_last4,
      };
  return upsertProvider(
    supabase,
    identity.profileId,
    providerConfigId,
    {
      name: input.name ?? existing.name,
      providerType:
        input.providerType ?? aiProviderTypeSchema.parse(existing.provider_type),
      baseUrl: input.baseUrl ?? existing.base_url,
      model: input.model ?? existing.model,
      capabilities: input.capabilities ?? savedCapabilities,
      status: input.status ?? aiProviderStatusSchema.parse(existing.status),
    },
    credential,
  );
}

export async function deleteAIProvider(providerConfigId: string): Promise<void> {
  const { identity, supabase } = await createAdminAIContext("ai_config:manage");
  const { error } = await supabase.rpc("admin_delete_ai_provider", {
    p_actor_profile_id: identity.profileId,
    p_provider_config_id: providerConfigId,
  });
  if (error) throwDataError(error);
}

export async function updateAIRouting(
  input: UpdateAIRoutingInput,
): Promise<AISettingsSnapshot> {
  const { identity, supabase } = await createAdminAIContext("ai_config:manage");
  const singleModel = input.routingMode === "SINGLE_MODEL";
  const { error } = await supabase.rpc("admin_update_ai_routing", {
    p_actor_profile_id: identity.profileId,
    p_routing_mode: input.routingMode,
    p_default_provider_config_id: singleModel
      ? input.defaultProviderConfigId
      : null,
    p_routes: singleModel ? {} : input.routes,
  });
  if (error) throwDataError(error);
  return buildSnapshot(supabase);
}

function decryptStoredProvider(row: StoredProviderRow): AIProviderConnectionConfig {
  if (
    !row.base_url ||
    !row.encrypted_api_key ||
    !row.api_key_iv ||
    !row.api_key_auth_tag ||
    row.encryption_version === null
  ) {
    throw new AIConfigError(
      "AI_NOT_CONFIGURED",
      AI_ERROR_MESSAGES.AI_NOT_CONFIGURED,
      503,
    );
  }
  return {
    providerType: aiProviderTypeSchema.parse(row.provider_type),
    baseUrl: row.base_url,
    model: row.model,
    capabilities: aiModelCapabilitiesSchema.parse(row.capabilities),
    apiKey: decryptAIProviderCredential({
      providerConfigId: row.id,
      encryptedApiKey: row.encrypted_api_key,
      apiKeyIv: row.api_key_iv,
      apiKeyAuthTag: row.api_key_auth_tag,
      encryptionVersion: row.encryption_version,
    }),
    source: "SAVED",
  };
}

function assertTaskCompatibility(
  config: AIProviderConnectionConfig,
  task: AITaskType,
  inputKind: AIInputKind,
): void {
  if (missingCapabilitiesForTask(config.capabilities, task, inputKind).length > 0) {
    throw new AIConfigError(
      "AI_CAPABILITY_MISMATCH",
      AI_ERROR_MESSAGES.AI_CAPABILITY_MISMATCH,
      422,
    );
  }
}

export async function resolveAIProviderForTask(
  task: AITaskType,
  inputKind: AIInputKind = "TEXT",
): Promise<ResolvedAIProvider> {
  const { supabase } = await createRuntimeAIContext();
  const { data: settingsData, error: settingsError } = await supabase
    .from("ai_settings")
    .select("routing_mode,default_provider_config_id")
    .eq("id", SETTINGS_ID)
    .maybeSingle();
  if (settingsError) throwDataError(settingsError);

  let selectedId: string | null = null;
  if (settingsData) {
    const settings = dataRecord(settingsData);
    const routingMode = aiRoutingModeSchema.parse(settings.routing_mode);
    if (routingMode === "SINGLE_MODEL") {
      selectedId = nullableText(settings.default_provider_config_id);
    } else {
      const { data: routeData, error: routeError } = await supabase
        .from("ai_task_routes")
        .select("provider_config_id")
        .eq("task_type", task)
        .maybeSingle();
      if (routeError) throwDataError(routeError);
      selectedId = routeData
        ? text(dataRecord(routeData).provider_config_id)
        : null;
    }
  }

  if (selectedId) {
    const row = await getProviderRow(supabase, selectedId);
    if (row.status !== "ACTIVE") {
      throw new AIConfigError(
        "AI_NOT_CONFIGURED",
        AI_ERROR_MESSAGES.AI_NOT_CONFIGURED,
        503,
      );
    }
    const config = decryptStoredProvider(row);
    assertTaskCompatibility(config, task, inputKind);
    return { ...config, providerConfigId: row.id };
  }

  const fallback = environmentFallback();
  if (!fallback) {
    throw new AIConfigError(
      "AI_NOT_CONFIGURED",
      AI_ERROR_MESSAGES.AI_NOT_CONFIGURED,
      503,
    );
  }
  assertTaskCompatibility(fallback, task, inputKind);
  return fallback;
}

export async function testUnsavedAIProvider(
  input: TestUnsavedAIProviderInput,
  dependencies?: AIProviderConnectionDependencies,
): Promise<AIConnectionTestResult> {
  await createAdminAIContext("ai_config:manage");
  return testAIProviderConnection(
    {
      providerType: input.providerType,
      baseUrl: input.baseUrl,
      model: input.model,
      apiKey: input.apiKey,
      capabilities: input.capabilities,
    },
    dependencies,
  );
}

export async function testSavedAIProvider(
  providerConfigId: string,
  input: TestSavedAIProviderInput,
  dependencies?: AIProviderConnectionDependencies,
): Promise<AIConnectionTestResult> {
  const { supabase } = await createAdminAIContext("ai_config:manage");
  const row = await getProviderRow(supabase, providerConfigId);
  const config = decryptStoredProvider(row);
  const replacementKey = input.apiKey?.trim();
  return testAIProviderConnection(
    replacementKey ? { ...config, apiKey: replacementKey } : config,
    dependencies,
  );
}
