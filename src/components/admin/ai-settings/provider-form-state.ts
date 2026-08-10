import type { ProviderInput, SafeProfile } from "./ai-settings-api";

export type ProviderEditorFormValues = ProviderInput & { apiKey?: string };

const createCapabilities = () => ({ text: true, vision: false, toolCalling: false, structuredOutput: true });

export function providerEditorInitialValues(profile?: SafeProfile): ProviderEditorFormValues {
  if (profile) return { name: profile.name, providerType: profile.providerType, baseUrl: profile.baseUrl, model: profile.model, status: profile.status, apiKey: "", capabilities: { ...profile.capabilities } };
  return { name: "", providerType: "OPENAI_COMPATIBLE", baseUrl: "", model: "", status: "ACTIVE", apiKey: "", capabilities: createCapabilities() };
}
