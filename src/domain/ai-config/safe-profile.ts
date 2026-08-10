import {
  aiModelCapabilitiesSchema,
  aiProviderStatusSchema,
  aiProviderTypeSchema,
  type AIProviderProfile,
} from "./contracts";
import { AIConfigError, AI_ERROR_MESSAGES } from "./errors";

export type SafeAIProviderSource = Readonly<{
  id: string;
  name: string;
  providerType: string;
  baseUrl: string | null;
  model: string;
  capabilities: unknown;
  status: string;
  credentialConfigured: boolean;
  keyLast4: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export function safeAIProviderProfile(source: SafeAIProviderSource): AIProviderProfile {
  if (!source.baseUrl) {
    throw new AIConfigError(
      "AI_CONFIG_DATA_ACCESS_FAILED",
      AI_ERROR_MESSAGES.AI_CONFIG_DATA_ACCESS_FAILED,
      503,
    );
  }
  return {
    id: source.id,
    name: source.name,
    providerType: aiProviderTypeSchema.parse(source.providerType),
    baseUrl: source.baseUrl,
    model: source.model,
    capabilities: aiModelCapabilitiesSchema.parse(source.capabilities),
    status: aiProviderStatusSchema.parse(source.status),
    credential: {
      configured: source.credentialConfigured,
      last4: source.keyLast4,
    },
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
}
