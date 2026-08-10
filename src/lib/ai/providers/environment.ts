import "server-only";

import type { AIProviderConnectionConfig } from "./types";

type EnvironmentSource = Readonly<Record<string, string | undefined>>;
const API_KEY_PATTERN = /^[\x21-\x7e]{4,4096}$/;

const OPENROUTER_ENVIRONMENT_CAPABILITIES = {
  text: true,
  vision: false,
  toolCalling: false,
  structuredOutput: false,
} as const;

export function getOpenRouterEnvironmentFallback(
  environment: EnvironmentSource = process.env,
): AIProviderConnectionConfig | null {
  const apiKey = environment.OPENROUTER_API_KEY?.trim();
  const baseUrl = environment.OPENROUTER_BASE_URL?.trim();
  const model = environment.OPENROUTER_MODEL?.trim();

  if (!apiKey || !API_KEY_PATTERN.test(apiKey) || !baseUrl || !model) return null;

  return {
    providerType: "OPENAI_COMPATIBLE",
    baseUrl,
    model,
    apiKey,
    capabilities: OPENROUTER_ENVIRONMENT_CAPABILITIES,
    source: "ENVIRONMENT",
  };
}
