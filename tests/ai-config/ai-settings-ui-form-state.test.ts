import { describe, expect, it } from "vitest";

import type { AIProviderProfile } from "../../src/domain/ai-config/contracts";
import { providerEditorInitialValues } from "../../src/components/admin/ai-settings/provider-form-state";

describe("Admin AI provider editor mounted defaults", () => {
  it("provides connected Add defaults for adapter, status, and all capability switches", () => {
    const values = providerEditorInitialValues();
    expect(values.providerType).toBe("OPENAI_COMPATIBLE");
    expect(values.status).toBe("ACTIVE");
    expect(values.capabilities).toEqual({ text: true, vision: false, toolCalling: false, structuredOutput: true });
    expect(values.apiKey).toBe("");
  });

  it("hydrates edit metadata but always clears the plaintext credential field", () => {
    const profile = { name: "Documents", providerType: "OPENAI_COMPATIBLE", baseUrl: "https://api.example.com/v1", model: "vision-model", status: "INVALID", capabilities: { text: true, vision: true, toolCalling: false, structuredOutput: true } } as AIProviderProfile;
    const values = providerEditorInitialValues(profile);
    expect(values).toMatchObject({ name: "Documents", status: "INVALID", model: "vision-model", apiKey: "" });
    expect(values.capabilities.vision).toBe(true);
  });
});
