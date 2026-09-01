import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

export type AIProviderObservationTask =
  | "PROVIDER_TEST"
  | "OPERATIONS_QUERY"
  | "OPERATIONAL_INSIGHT"
  | "WORKFLOW_EXPLANATION"
  | "DOCUMENT_UNDERSTANDING";

export type AIProviderExchange = Readonly<{
  id: string;
  appTraceId: string;
  sequence: number;
  task: AIProviderObservationTask;
  createdAt: string;
  providerType: string;
  providerSource?: "SAVED" | "ENVIRONMENT";
  endpoint: string;
  model: string;
  method: "POST";
  statusCode: number;
  statusText: string;
  durationMs: number;
  request: Readonly<{
    headers: Readonly<Record<string, string>>;
    body: unknown;
  }>;
  response: Readonly<{
    headers: Readonly<Record<string, string>>;
    body: unknown;
  }>;
  error?: Readonly<{ name: string; message: string }>;
}>;

type ObservationContext = {
  appTraceId: string;
  task: AIProviderObservationTask;
  exchanges: AIProviderExchange[];
};

const storage = new AsyncLocalStorage<ObservationContext>();
const MAX_STRING = 32_000;
const MAX_DEPTH = 8;
const MAX_ARRAY = 80;
const MAX_KEYS = 120;
const SECRET_KEY = /(authorization|api[_-]?key|token|secret|password|credential|cookie|encryption)/i;
const DATA_URL = /^data:image\/[^;]+;base64,/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const BEARER_CREDENTIAL = /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi;

function truncate(value: string) {
  return value.length > MAX_STRING
    ? `${value.slice(0, MAX_STRING)}… [truncated ${value.length - MAX_STRING} chars]`
    : value;
}

function sanitizeString(value: string) {
  if (DATA_URL.test(value)) {
    return `[image data omitted · ${value.length} characters]`;
  }
  return truncate(
    value
      .replace(EMAIL, "[REDACTED_EMAIL]")
      .replace(BEARER_CREDENTIAL, "Bearer [REDACTED]"),
  );
}

/**
 * Sanitizes an exchange only for the lifetime of the request. Persistent AI
 * observability stores a stricter metadata-only summary and never writes raw
 * prompt/response bodies to the database.
 */
export function sanitizeAIProviderPayload(
  value: unknown,
  key = "",
  depth = 0,
): unknown {
  if (SECRET_KEY.test(key)) return "[REDACTED]";
  if (depth > MAX_DEPTH) return "[max depth]";
  if (
    value === null ||
    value === undefined ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) {
    const items: unknown[] = value
      .slice(0, MAX_ARRAY)
      .map((item) => sanitizeAIProviderPayload(item, key, depth + 1));
    if (value.length > MAX_ARRAY) {
      items.push(`[${value.length - MAX_ARRAY} more item(s)]`);
    }
    return items;
  }
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(object).slice(0, MAX_KEYS)) {
      result[childKey] = sanitizeAIProviderPayload(
        childValue,
        childKey,
        depth + 1,
      );
    }
    if (Object.keys(object).length > MAX_KEYS) {
      result.__truncated__ = "additional keys omitted";
    }
    return result;
  }
  return sanitizeString(String(value));
}

function safeResponseHeaders(
  headers: Headers,
): Readonly<Record<string, string>> {
  const allowed = [
    "content-type",
    "x-request-id",
    "openai-request-id",
    "x-ratelimit-limit-requests",
    "x-ratelimit-remaining-requests",
    "x-ratelimit-reset-requests",
  ];
  const result: Record<string, string> = {};
  for (const key of allowed) {
    const value = headers.get(key);
    if (value) result[key] = sanitizeString(value);
  }
  return result;
}

export function currentAIProviderObservationContext() {
  return storage.getStore();
}

export function recordAIProviderExchange(
  input: Omit<
    AIProviderExchange,
    "id" | "appTraceId" | "sequence" | "task" | "createdAt"
  >,
) {
  const context = storage.getStore();
  if (!context) return;
  context.exchanges.push({
    ...input,
    id: crypto.randomUUID(),
    appTraceId: context.appTraceId,
    sequence: context.exchanges.length + 1,
    task: context.task,
    createdAt: new Date().toISOString(),
  });
}

export function providerObservationResponseHeaders(headers: Headers) {
  return safeResponseHeaders(headers);
}

/**
 * Every supported AI route gets a server-owned observation context. Provider
 * capture no longer depends on a browser header or one tab's sessionStorage.
 */
export async function runWithAIProviderObservation<T>(
  _request: Request,
  task: AIProviderObservationTask,
  action: () => Promise<T>,
): Promise<
  | Readonly<{
      ok: true;
      value: T;
      traceId: string;
      exchanges: readonly AIProviderExchange[];
    }>
  | Readonly<{
      ok: false;
      error: unknown;
      traceId: string;
      exchanges: readonly AIProviderExchange[];
    }>
> {
  const context: ObservationContext = {
    appTraceId: crypto.randomUUID(),
    task,
    exchanges: [],
  };

  return storage.run(context, async () => {
    try {
      return {
        ok: true,
        value: await action(),
        traceId: context.appTraceId,
        exchanges: context.exchanges,
      } as const;
    } catch (error) {
      return {
        ok: false,
        error,
        traceId: context.appTraceId,
        exchanges: context.exchanges,
      } as const;
    }
  });
}
