import type { AIConnectionTestResult } from "@/domain/ai-config/contracts";

import {
  invalidProviderConfiguration,
  invalidProviderResponse,
  normalizeAIProviderError,
  providerHttpError,
  ProviderTimeoutError,
} from "./errors";
import { buildSafeChatCompletionsUrl } from "./safe-url";
import type {
  AIProviderAdapter,
  AIProviderConnectionConfig,
  AIProviderConnectionDependencies,
} from "./types";

const DEFAULT_CONNECTION_TIMEOUT_MS = 8_000;
const MAX_CONNECTION_TIMEOUT_MS = 30_000;
const API_KEY_PATTERN = /^[\x21-\x7e]{4,4096}$/;

function connectionTimeout(value: number | undefined): number {
  if (value === undefined) return DEFAULT_CONNECTION_TIMEOUT_MS;
  if (!Number.isInteger(value) || value <= 0 || value > MAX_CONNECTION_TIMEOUT_MS) {
    throw invalidProviderConfiguration();
  }
  return value;
}

function hasValidAssistantMessage(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const choices = Reflect.get(value, "choices");
  if (!Array.isArray(choices) || choices.length === 0) return false;
  const first = choices[0];
  if (typeof first !== "object" || first === null) return false;
  const message = Reflect.get(first, "message");
  if (typeof message !== "object" || message === null) return false;
  const role = Reflect.get(message, "role");
  const content = Reflect.get(message, "content");
  return role === "assistant" && (typeof content === "string" || content === null);
}

async function executeConnectionTest(
  config: AIProviderConnectionConfig,
  dependencies: AIProviderConnectionDependencies,
): Promise<AIConnectionTestResult> {
  const apiKey = config.apiKey.trim();
  const model = config.model.trim();
  if (!API_KEY_PATTERN.test(apiKey) || !model) {
    throw invalidProviderConfiguration();
  }

  const timeoutMs = connectionTimeout(dependencies.timeoutMs);
  const abortController = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      abortController.abort();
      reject(new ProviderTimeoutError());
    }, timeoutMs);
  });

  const request = (async () => {
    const endpoint = await buildSafeChatCompletionsUrl(
      config.baseUrl,
      dependencies.resolveHostname,
    );
    if (abortController.signal.aborted) throw new ProviderTimeoutError();

    const response = await (dependencies.fetch ?? fetch)(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: "Reply with OK to confirm this model is available.",
          },
        ],
        max_tokens: 8,
        temperature: 0,
      }),
      redirect: "manual",
      signal: abortController.signal,
    });

    if (response.status >= 300 && response.status < 400) {
      throw invalidProviderResponse();
    }
    if (!response.ok) throw providerHttpError(response.status);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw invalidProviderResponse();
    }
    if (!hasValidAssistantMessage(body)) throw invalidProviderResponse();

    return {
      ok: true,
      checkedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
    } as const;
  })();

  try {
    return await Promise.race([request, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export const openAICompatibleAdapter: AIProviderAdapter = {
  providerType: "OPENAI_COMPATIBLE",
  async testConnection(config, dependencies = {}) {
    try {
      return await executeConnectionTest(config, dependencies);
    } catch (error) {
      throw normalizeAIProviderError(error);
    }
  },
};
