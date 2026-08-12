export const API_OBSERVATION_STORAGE_KEY = "sejukops:api-observation:v1";
export const API_OBSERVATION_PAUSED_KEY = "sejukops:api-observation:paused";
export const API_OBSERVATION_EVENT = "sejukops:api-observation-updated";
export const API_OBSERVATION_LIMIT = 150;

export type ApiObservationScope = "ADMIN" | "MANAGER" | "TECHNICIAN" | "SYSTEM";

export type ApiObservationPayload = Readonly<{
  headers: Readonly<Record<string, string>>;
  contentType?: string;
  body?: unknown;
}>;

export type ApiObservationEvent = Readonly<{
  id: string;
  traceId: string;
  createdAt: string;
  scope: ApiObservationScope;
  method: string;
  route: string;
  query: Readonly<Record<string, string>>;
  statusCode: number;
  statusText: string;
  durationMs: number;
  request: ApiObservationPayload;
  response: ApiObservationPayload;
}>;

const REDACTED = "[REDACTED]";
const REDACTED_PII = "[REDACTED_PII]";
const MAX_STRING = 800;
const MAX_DEPTH = 5;
const MAX_ARRAY = 24;
const MAX_KEYS = 60;
const MAX_CAPTURED_TEXT = 64_000;

const secretKeyPattern = /(api[_-]?key|authorization|cookie|set-cookie|token|secret|password|credential|encryption|signed.?url|upload.?url|view.?url|source.?url|base64|binary|file.?content)/i;
const piiKeyPattern = /(^|[_-])(phone|email|address)([_-]|$)|customerPhone|customerAddress/i;

function truncate(value: string) {
  return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}… [truncated]` : value;
}

export function redactObservationValue(value: unknown, key = "", depth = 0): unknown {
  if (secretKeyPattern.test(key)) return REDACTED;
  if (piiKeyPattern.test(key)) return REDACTED_PII;
  if (depth > MAX_DEPTH) return "[max depth]";
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return truncate(value);
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    const items: unknown[] = value.slice(0, MAX_ARRAY).map((item) => redactObservationValue(item, key, depth + 1));
    if (value.length > MAX_ARRAY) items.push(`[${value.length - MAX_ARRAY} more item(s)]`);
    return items;
  }
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    const entries = Object.entries(object).slice(0, MAX_KEYS);
    const result: Record<string, unknown> = {};
    for (const [childKey, childValue] of entries) result[childKey] = redactObservationValue(childValue, childKey, depth + 1);
    if (Object.keys(object).length > MAX_KEYS) result.__truncated__ = "additional keys omitted";
    return result;
  }
  return truncate(String(value));
}

function safeHeaders(headers: Headers): Readonly<Record<string, string>> {
  const allowed = ["accept", "content-type", "x-request-id", "x-sejuk-trace-id"];
  const result: Record<string, string> = {};
  for (const name of allowed) {
    const value = headers.get(name);
    if (value) result[name] = truncate(value);
  }
  return result;
}

function safeQuery(url: URL): Readonly<Record<string, string>> {
  const query: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    query[key] = String(redactObservationValue(value, key));
  });
  return query;
}

function requestBodySummary(body: BodyInit | null | undefined, contentType: string | null): unknown {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") {
    if (contentType?.includes("application/json")) {
      try { return redactObservationValue(JSON.parse(body)); }
      catch { return truncate(body); }
    }
    return truncate(body);
  }
  if (typeof FormData !== "undefined" && body instanceof FormData) return "[FormData omitted]";
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) return redactObservationValue(Object.fromEntries(body.entries()));
  if (typeof Blob !== "undefined" && body instanceof Blob) return `[Blob omitted · ${body.type || "unknown"} · ${body.size} bytes]`;
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return "[binary body omitted]";
  return "[stream/request body omitted]";
}

async function responseBodySummary(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > MAX_CAPTURED_TEXT) return `[response body omitted · ${contentLength} bytes]`;
  if (!contentType.includes("application/json") && !contentType.startsWith("text/")) return `[${contentType || "non-text response"} body omitted]`;
  try {
    const text = await response.clone().text();
    if (text.length > MAX_CAPTURED_TEXT) return `[response body omitted · ${text.length} characters]`;
    if (!text) return undefined;
    if (contentType.includes("application/json")) {
      try { return redactObservationValue(JSON.parse(text)); }
      catch { return truncate(text); }
    }
    return truncate(text);
  } catch {
    return "[response body unavailable]";
  }
}

function storageAvailable() {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

export function readApiObservationEvents(): ApiObservationEvent[] {
  if (!storageAvailable()) return [];
  try {
    const raw = window.sessionStorage.getItem(API_OBSERVATION_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed as ApiObservationEvent[] : [];
  } catch {
    return [];
  }
}

export function clearApiObservationEvents() {
  if (!storageAvailable()) return;
  window.sessionStorage.removeItem(API_OBSERVATION_STORAGE_KEY);
  window.dispatchEvent(new CustomEvent(API_OBSERVATION_EVENT));
}

export function apiObservationPaused() {
  if (!storageAvailable()) return false;
  return window.sessionStorage.getItem(API_OBSERVATION_PAUSED_KEY) === "1";
}

export function setApiObservationPaused(paused: boolean) {
  if (!storageAvailable()) return;
  if (paused) window.sessionStorage.setItem(API_OBSERVATION_PAUSED_KEY, "1");
  else window.sessionStorage.removeItem(API_OBSERVATION_PAUSED_KEY);
  window.dispatchEvent(new CustomEvent(API_OBSERVATION_EVENT));
}

function appendApiObservationEvent(event: ApiObservationEvent) {
  if (!storageAvailable()) return;
  try {
    const next = [event, ...readApiObservationEvents()].slice(0, API_OBSERVATION_LIMIT);
    window.sessionStorage.setItem(API_OBSERVATION_STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(API_OBSERVATION_EVENT, { detail: event }));
  } catch {
    // Observation must never break the product path it is observing.
  }
}

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function scopeForRoute(pathname: string): ApiObservationScope {
  if (pathname.startsWith("/api/admin/")) return "ADMIN";
  if (pathname.startsWith("/api/manager/")) return "MANAGER";
  if (pathname.startsWith("/api/technician/")) return "TECHNICIAN";
  return "SYSTEM";
}

export function installApiObservation(): () => void {
  if (typeof window === "undefined") return () => undefined;
  const originalFetch = window.fetch.bind(window);

  const observedFetch: typeof window.fetch = async (input, init) => {
    let url: URL;
    try { url = new URL(requestUrl(input), window.location.origin); }
    catch { return originalFetch(input, init); }

    const shouldObserve = url.origin === window.location.origin && url.pathname.startsWith("/api/") && !apiObservationPaused();
    if (!shouldObserve) return originalFetch(input, init);

    const traceId = crypto.randomUUID();
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const requestHeaders = new Headers(input instanceof Request ? input.headers : undefined);
    if (init?.headers) new Headers(init.headers).forEach((value, key) => requestHeaders.set(key, value));
    requestHeaders.set("x-sejuk-trace-id", traceId);
    const contentType = requestHeaders.get("content-type") ?? undefined;
    const requestPayload: ApiObservationPayload = {
      headers: safeHeaders(requestHeaders),
      contentType,
      body: requestBodySummary(init?.body, contentType ?? null),
    };
    const started = performance.now();

    try {
      const response = await originalFetch(input, { ...init, headers: requestHeaders });
      const durationMs = Math.max(0, Math.round(performance.now() - started));
      const responseContentType = response.headers.get("content-type") ?? undefined;
      const baseEvent = {
        id: crypto.randomUUID(),
        traceId,
        createdAt: new Date().toISOString(),
        scope: scopeForRoute(url.pathname),
        method,
        route: url.pathname,
        query: safeQuery(url),
        statusCode: response.status,
        statusText: response.statusText,
        durationMs,
        request: requestPayload,
      } as const;

      // Clone/parsing happens outside the caller's critical path so observation does not
      // delay the workflow response being returned to React Query or the form UI.
      void responseBodySummary(response).then((body) => appendApiObservationEvent({
        ...baseEvent,
        response: { headers: safeHeaders(response.headers), contentType: responseContentType, body },
      }));
      return response;
    } catch (error) {
      appendApiObservationEvent({
        id: crypto.randomUUID(),
        traceId,
        createdAt: new Date().toISOString(),
        scope: scopeForRoute(url.pathname),
        method,
        route: url.pathname,
        query: safeQuery(url),
        statusCode: 0,
        statusText: "NETWORK_ERROR",
        durationMs: Math.max(0, Math.round(performance.now() - started)),
        request: requestPayload,
        response: { headers: {}, body: { error: error instanceof Error ? error.message : "Request failed" } },
      });
      throw error;
    }
  };

  window.fetch = observedFetch;
  return () => {
    if (window.fetch === observedFetch) window.fetch = originalFetch;
  };
}
