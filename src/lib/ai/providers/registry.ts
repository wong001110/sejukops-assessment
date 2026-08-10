import "server-only";

import { invalidProviderConfiguration } from "./errors";
import {
  executeOpenAICompatibleChatCompletion,
  openAICompatibleAdapter,
} from "./openai-compatible";
import type {
  AIChatCompletionDependencies,
  AIChatCompletionRequest,
  AIProviderConnectionConfig,
  AIProviderConnectionDependencies,
} from "./types";

export async function testAIProviderConnection(
  config: AIProviderConnectionConfig,
  dependencies?: AIProviderConnectionDependencies,
) {
  if (config.providerType !== openAICompatibleAdapter.providerType) {
    throw invalidProviderConfiguration();
  }

  // Deliberately invoke only the selected adapter once. Connection testing never
  // retries or falls through to another configured provider.
  return openAICompatibleAdapter.testConnection(config, dependencies);
}

export async function requestAIProviderCompletion(
  config: AIProviderConnectionConfig,
  request: AIChatCompletionRequest,
  dependencies?: AIChatCompletionDependencies,
) {
  if (config.providerType !== openAICompatibleAdapter.providerType) {
    throw invalidProviderConfiguration();
  }
  // One selected provider, one bounded attempt. Runtime orchestration owns any
  // explicit manual retry initiated by the Manager.
  return executeOpenAICompatibleChatCompletion(config, request, dependencies);
}
