import "server-only";

import { invalidProviderConfiguration } from "./errors";
import { openAICompatibleAdapter } from "./openai-compatible";
import type {
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

