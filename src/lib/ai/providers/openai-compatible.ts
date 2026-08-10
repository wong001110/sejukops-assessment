import type { AIConnectionTestResult } from "@/domain/ai-config/contracts";

import {
  invalidProviderConfiguration,
  invalidProviderResponse,
  normalizeAIProviderError,
  providerHttpError,
  ProviderTimeoutError,
} from "./errors";
import { pinnedHttpsFetch } from "./pinned-https";
import { resolveSafeChatCompletionsTarget } from "./safe-url";
import type {
  AIProviderAdapter,
  AIChatCompletionDependencies,
  AIChatCompletionRequest,
  AIChatCompletionResult,
  AIProviderConnectionConfig,
  AIProviderConnectionDependencies,
} from "./types";

const DEFAULT_CONNECTION_TIMEOUT_MS = 8_000;
const MAX_CONNECTION_TIMEOUT_MS = 30_000;
const API_KEY_PATTERN = /^[\x21-\x7e]{4,4096}$/;
const DEFAULT_COMPLETION_TIMEOUT_MS = 20_000;
const MAX_COMPLETION_TIMEOUT_MS = 30_000;
const MAX_COMPLETION_MESSAGES = 8;
const MAX_COMPLETION_INPUT_CHARACTERS = 32_000;
const MAX_COMPLETION_OUTPUT_CHARACTERS = 16_000;

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
    const target = await resolveSafeChatCompletionsTarget(
      config.baseUrl,
      dependencies.resolveHostname,
    );
    if (abortController.signal.aborted) throw new ProviderTimeoutError();

    const requestInit: RequestInit = {
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
    };
    // A supplied fetch is a trusted test seam. Production always uses the
    // pinned HTTPS transport so the validated DNS address is the address dialed.
    const response = dependencies.fetch
      ? await dependencies.fetch(target.endpoint, requestInit)
      : await pinnedHttpsFetch(target, requestInit);

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

function readTokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function readCost(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function parseChatCompletion(value: unknown): AIChatCompletionResult {
  if (!value || typeof value !== "object") throw invalidProviderResponse();
  const choices = Reflect.get(value, "choices");
  if (!Array.isArray(choices) || choices.length === 0) {
    throw invalidProviderResponse();
  }
  const message =
    choices[0] && typeof choices[0] === "object"
      ? Reflect.get(choices[0], "message")
      : null;
  const content =
    message && typeof message === "object"
      ? Reflect.get(message, "content")
      : null;
  if (
    typeof content !== "string" ||
    content.trim().length === 0 ||
    content.length > MAX_COMPLETION_OUTPUT_CHARACTERS
  ) {
    throw invalidProviderResponse();
  }
  const usage = Reflect.get(value, "usage");
  return {
    content: content.trim(),
    usage: {
      promptTokens:
        usage && typeof usage === "object"
          ? readTokenCount(Reflect.get(usage, "prompt_tokens"))
          : null,
      completionTokens:
        usage && typeof usage === "object"
          ? readTokenCount(Reflect.get(usage, "completion_tokens"))
          : null,
      costUsd:
        usage && typeof usage === "object"
          ? readCost(Reflect.get(usage, "cost"))
          : null,
    },
  };
}

function validateCompletionRequest(request: AIChatCompletionRequest): void {
  const totalCharacters = request.messages.reduce(
    (total, message) => total + message.content.length,
    0,
  );
  if (
    request.messages.length === 0 ||
    request.messages.length > MAX_COMPLETION_MESSAGES ||
    totalCharacters > MAX_COMPLETION_INPUT_CHARACTERS ||
    !Number.isInteger(request.maxTokens) ||
    request.maxTokens < 1 ||
    request.maxTokens > 1_000 ||
    request.messages.some(
      (message) =>
        message.content.trim().length === 0 || message.content.length > 20_000,
    )
  ) {
    throw invalidProviderConfiguration();
  }
}

export async function executeOpenAICompatibleChatCompletion(
  config: AIProviderConnectionConfig,
  completion: AIChatCompletionRequest,
  dependencies: AIChatCompletionDependencies = {},
): Promise<AIChatCompletionResult> {
  try {
    validateCompletionRequest(completion);
    const apiKey = config.apiKey.trim();
    const model = config.model.trim();
    if (!API_KEY_PATTERN.test(apiKey) || !model) {
      throw invalidProviderConfiguration();
    }

    const configuredTimeout = dependencies.timeoutMs ?? DEFAULT_COMPLETION_TIMEOUT_MS;
    if (
      !Number.isInteger(configuredTimeout) ||
      configuredTimeout < 1 ||
      configuredTimeout > MAX_COMPLETION_TIMEOUT_MS
    ) {
      throw invalidProviderConfiguration();
    }
    const abortController = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abortController.abort();
        reject(new ProviderTimeoutError());
      }, configuredTimeout);
    });

    const providerRequest = (async () => {
      const target = await resolveSafeChatCompletionsTarget(
        config.baseUrl,
        dependencies.resolveHostname,
      );
      if (abortController.signal.aborted) throw new ProviderTimeoutError();
      const requestInit: RequestInit = {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: completion.messages,
          max_tokens: completion.maxTokens,
          temperature: 0,
          ...(completion.responseFormat === "JSON_OBJECT"
            ? { response_format: { type: "json_object" } }
            : {}),
        }),
        redirect: "manual",
        signal: abortController.signal,
      };
      const response = dependencies.fetch
        ? await dependencies.fetch(target.endpoint, requestInit)
        : await pinnedHttpsFetch(target, requestInit);
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
      return parseChatCompletion(body);
    })();

    try {
      return await Promise.race([providerRequest, deadline]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  } catch (error) {
    throw normalizeAIProviderError(error);
  }
}
