import type {
  AIConnectionTestResult,
  AIModelCapabilities,
  AIProviderType,
} from "@/domain/ai-config/contracts";

import type { ResolvedAddress } from "./network-address";

export type AIProviderConnectionConfig = Readonly<{
  providerType: AIProviderType;
  baseUrl: string;
  model: string;
  apiKey: string;
  capabilities: AIModelCapabilities;
  source?: "SAVED" | "ENVIRONMENT";
}>;

export type ProviderFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type ProviderHostnameResolver = (
  hostname: string,
) => Promise<readonly ResolvedAddress[]>;

export type AIProviderConnectionDependencies = Readonly<{
  fetch?: ProviderFetch;
  resolveHostname?: ProviderHostnameResolver;
  timeoutMs?: number;
  now?: () => Date;
}>;

export type AITextContentPart = Readonly<{
  type: "text";
  text: string;
}>;

export type AIImageContentPart = Readonly<{
  type: "image_url";
  image_url: Readonly<{
    url: string;
    detail?: "auto" | "low" | "high";
  }>;
}>;

export type AIChatContent =
  | string
  | readonly (AITextContentPart | AIImageContentPart)[];

export type AIChatMessage = Readonly<{
  role: "system" | "user" | "assistant";
  content: AIChatContent;
}>;

export type AIChatCompletionRequest = Readonly<{
  messages: readonly AIChatMessage[];
  maxTokens: number;
  responseFormat?: "JSON_OBJECT";
}>;

export type AIChatCompletionResult = Readonly<{
  content: string;
  usage: Readonly<{
    promptTokens: number | null;
    completionTokens: number | null;
    costUsd: number | null;
  }>;
}>;

export type AIChatCompletionDependencies = AIProviderConnectionDependencies;

export interface AIProviderAdapter {
  readonly providerType: AIProviderType;
  testConnection(
    config: AIProviderConnectionConfig,
    dependencies?: AIProviderConnectionDependencies,
  ): Promise<AIConnectionTestResult>;
}
