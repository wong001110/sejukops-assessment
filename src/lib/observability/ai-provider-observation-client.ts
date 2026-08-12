export const AI_PROVIDER_OBSERVATION_STORAGE_KEY = "sejukops:ai-provider-observation:v1";
export const AI_PROVIDER_OBSERVATION_EVENT = "sejukops:ai-provider-observation-updated";
export const AI_PROVIDER_OBSERVATION_LIMIT = 80;

export type AIProviderExchangeView = Readonly<{
  id: string;
  appTraceId: string;
  sequence: number;
  task: "PROVIDER_TEST" | "OPERATIONS_QUERY" | "OPERATIONAL_INSIGHT" | "WORKFLOW_EXPLANATION" | "DOCUMENT_UNDERSTANDING";
  createdAt: string;
  providerType: string;
  providerSource?: "SAVED" | "ENVIRONMENT";
  endpoint: string;
  model: string;
  method: "POST";
  statusCode: number;
  statusText: string;
  durationMs: number;
  request: Readonly<{ headers: Readonly<Record<string, string>>; body: unknown }>;
  response: Readonly<{ headers: Readonly<Record<string, string>>; body: unknown }>;
  error?: Readonly<{ name: string; message: string }>;
}>;

const DEBUG_KEY = "__aiProviderObservation";
const SECRET_KEY = /(authorization|api[_-]?key|token|secret|password|credential|cookie|encryption)/i;
const DATA_URL = /^data:image\/[^;]+;base64,/i;
const MAX_STRING = 32_000;
const MAX_DEPTH = 8;
const MAX_ARRAY = 80;
const MAX_KEYS = 120;

function storageAvailable() {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

function safeValue(value: unknown, key = "", depth = 0): unknown {
  if (SECRET_KEY.test(key)) return "[REDACTED]";
  if (depth > MAX_DEPTH) return "[max depth]";
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (DATA_URL.test(value)) return `[image data omitted · ${value.length} characters]`;
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}… [truncated]` : value;
  }
  if (Array.isArray(value)) {
    const items: unknown[] = value.slice(0, MAX_ARRAY).map((item) => safeValue(item, key, depth + 1));
    if (value.length > MAX_ARRAY) items.push(`[${value.length - MAX_ARRAY} more item(s)]`);
    return items;
  }
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(object).slice(0, MAX_KEYS)) result[childKey] = safeValue(childValue, childKey, depth + 1);
    if (Object.keys(object).length > MAX_KEYS) result.__truncated__ = "additional keys omitted";
    return result;
  }
  return String(value);
}

function isExchange(value: unknown): value is AIProviderExchangeView {
  if (!value || typeof value !== "object") return false;
  const object = value as Record<string, unknown>;
  return typeof object.id === "string"
    && typeof object.appTraceId === "string"
    && typeof object.task === "string"
    && typeof object.endpoint === "string"
    && typeof object.model === "string"
    && typeof object.statusCode === "number"
    && typeof object.durationMs === "number";
}

export function isAIProviderObservationRoute(pathname: string) {
  return pathname === "/api/manager/ai-operations"
    || pathname === "/api/manager/operational-insight"
    || /^\/api\/manager\/workflow-flags\/[^/]+\/explanation$/.test(pathname)
    || /^\/api\/admin\/document-imports\/[^/]+\/extract$/.test(pathname)
    || pathname === "/api/admin/ai-settings/test"
    || /^\/api\/admin\/ai-settings\/providers\/[^/]+\/test$/.test(pathname);
}

export function readAIProviderExchanges(): AIProviderExchangeView[] {
  if (!storageAvailable()) return [];
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(AI_PROVIDER_OBSERVATION_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isExchange) : [];
  } catch {
    return [];
  }
}

export function clearAIProviderExchanges() {
  if (!storageAvailable()) return;
  window.sessionStorage.removeItem(AI_PROVIDER_OBSERVATION_STORAGE_KEY);
  window.dispatchEvent(new CustomEvent(AI_PROVIDER_OBSERVATION_EVENT));
}

function appendAIProviderExchanges(exchanges: readonly AIProviderExchangeView[]) {
  if (!storageAvailable() || !exchanges.length) return;
  try {
    const sanitized = exchanges.map((exchange) => safeValue(exchange) as AIProviderExchangeView);
    const next = [...sanitized.reverse(), ...readAIProviderExchanges()].slice(0, AI_PROVIDER_OBSERVATION_LIMIT);
    window.sessionStorage.setItem(AI_PROVIDER_OBSERVATION_STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(AI_PROVIDER_OBSERVATION_EVENT));
  } catch {
    // Observation must never break the product flow being observed.
  }
}

export async function captureAIProviderObservation(response: Response): Promise<Response> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  let parsed: unknown;
  try { parsed = JSON.parse(await response.clone().text()); }
  catch { return response; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return response;

  const object = parsed as Record<string, unknown>;
  const observation = object[DEBUG_KEY];
  if (!observation || typeof observation !== "object" || Array.isArray(observation)) return response;
  const exchanges = Reflect.get(observation, "exchanges");
  if (Array.isArray(exchanges)) appendAIProviderExchanges(exchanges.filter(isExchange));

  const clean = { ...object };
  delete clean[DEBUG_KEY];
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.set("content-type", "application/json; charset=utf-8");

  return new Response(JSON.stringify(clean), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
