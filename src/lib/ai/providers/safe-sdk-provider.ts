import "server-only";

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import type { AIProviderConnectionConfig, ProviderHostnameResolver } from "./types";
import { pinnedHttpsFetch } from "./pinned-https";
import { boundedTaskRequestOptions } from "./bounded-task-request-options";
import { resolveSafeChatCompletionsTarget, UnsafeProviderUrlError } from "./safe-url";

const MAX_REQUEST_BYTES = 131_072;

/** Keep SDK requests on the already-reviewed HTTPS/DNS-pinned transport. */
export function createPinnedSDKFetch(
  config: AIProviderConnectionConfig,
  dependencies: {
    resolveHostname?: ProviderHostnameResolver;
    send?: typeof pinnedHttpsFetch;
  } = {},
) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const target = await resolveSafeChatCompletionsTarget(
      config.baseUrl,
      dependencies.resolveHostname,
    );
    // The SDK currently passes a URL and RequestInit. Fail closed if its
    // transport contract changes rather than accidentally using global fetch.
    if (input instanceof Request || !init || init.method?.toUpperCase() !== "POST") {
      throw new UnsafeProviderUrlError();
    }
    const requestedUrl = new URL(input.toString());
    if (requestedUrl.href !== target.endpoint.href || typeof init.body !== "string") {
      throw new UnsafeProviderUrlError();
    }
    if (Buffer.byteLength(init.body, "utf8") > MAX_REQUEST_BYTES) {
      throw new UnsafeProviderUrlError();
    }
    let requestInit = init;
    const options = boundedTaskRequestOptions(target.hostname, config.model);
    if (options.reasoning) {
      let body: unknown;
      try { body = JSON.parse(init.body); } catch { throw new UnsafeProviderUrlError(); }
      if (!body || typeof body !== "object" || Array.isArray(body) || Reflect.get(body, "model") !== config.model.trim()) {
        throw new UnsafeProviderUrlError();
      }
      const rewrittenBody = JSON.stringify({ ...body, ...options });
      if (Buffer.byteLength(rewrittenBody, "utf8") > MAX_REQUEST_BYTES) throw new UnsafeProviderUrlError();
      requestInit = { ...init, body: rewrittenBody };
    }
    return (dependencies.send ?? pinnedHttpsFetch)(target, requestInit, {
      providerSource: config.source,
    });
  };
}

export function createSafeSDKChatModel(config: AIProviderConnectionConfig) {
  if (config.providerType !== "OPENAI_COMPATIBLE" || !config.capabilities.toolCalling) {
    throw new UnsafeProviderUrlError();
  }
  const provider = createOpenAICompatible({
    name: "sejukops-openai-compatible",
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
    fetch: createPinnedSDKFetch(config),
  });
  return provider.chatModel(config.model);
}
