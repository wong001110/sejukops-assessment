"use client";

import { AI_TASK_TYPES } from "@/domain/ai-config/contracts";
import type { AIConnectionTestResult, AIEnvironmentFallbackSummary, AIModelCapabilities, AIProviderProfile, AIRoutingMode, AISettingsSnapshot as SharedAISettingsSnapshot, AITaskType, CreateAIProviderInput, UpdateAIRoutingInput } from "@/domain/ai-config/contracts";

export const AI_TASKS = AI_TASK_TYPES;
export type { AIModelCapabilities, AITaskType };
export type RoutingMode = AIRoutingMode;
export type SafeProfile = AIProviderProfile;
export type SafeFallback = AIEnvironmentFallbackSummary;
export type AISettingsSnapshot = SharedAISettingsSnapshot;
export type ProviderInput = Readonly<{
  name: CreateAIProviderInput["name"];
  providerType: CreateAIProviderInput["providerType"];
  baseUrl: CreateAIProviderInput["baseUrl"];
  model: CreateAIProviderInput["model"];
  capabilities: CreateAIProviderInput["capabilities"];
  status: CreateAIProviderInput["status"];
  apiKey?: string;
}>;
export type RoutingInput = UpdateAIRoutingInput;

type ErrorEnvelope = { error?: { code?: string; message?: string; fieldErrors?: Record<string, string[] | string> } };
export class AISettingsApiError extends Error {
  constructor(message: string, readonly status?: number, readonly code?: string, readonly fieldErrors?: Record<string, string[] | string>) { super(message); this.name = "AISettingsApiError"; }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await response.json().catch(() => null) as T | ErrorEnvelope | null;
  if (!response.ok) {
    const error = (body as ErrorEnvelope | null)?.error;
    throw new AISettingsApiError(error?.message ?? "The AI settings request could not be completed.", response.status, error?.code, error?.fieldErrors);
  }
  return body as T;
}

export const aiSettingsApi = {
  get: () => request<AISettingsSnapshot>("/api/admin/ai-settings"),
  createProvider: (input: ProviderInput & { apiKey: string; requestKey: string }) => request<unknown>("/api/admin/ai-settings/providers", { method: "POST", body: JSON.stringify(input) }),
  updateProvider: (id: string, input: ProviderInput) => request<unknown>(`/api/admin/ai-settings/providers/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  deleteProvider: (id: string) => request<void>(`/api/admin/ai-settings/providers/${id}`, { method: "DELETE" }),
  testSavedProvider: (id: string, apiKey?: string) => request<AIConnectionTestResult>(`/api/admin/ai-settings/providers/${id}/test`, { method: "POST", body: JSON.stringify(apiKey ? { apiKey } : {}) }),
  testUnsavedProvider: (input: ProviderInput & { apiKey: string }) => request<AIConnectionTestResult>("/api/admin/ai-settings/test", { method: "POST", body: JSON.stringify({ providerType: input.providerType, baseUrl: input.baseUrl, model: input.model, capabilities: input.capabilities, apiKey: input.apiKey }) }),
  updateRouting: (input: RoutingInput) => request<AISettingsSnapshot>("/api/admin/ai-settings/routing", { method: "PUT", body: JSON.stringify(input) }),
};
