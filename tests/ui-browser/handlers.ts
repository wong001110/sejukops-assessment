import { delay, http, HttpResponse, passthrough } from "msw";
import { setupWorker } from "msw/browser";
import { resetStaffMock, resolveStaffMock } from "./staff-handlers";
import { getMockOwnerPreview, resetOwnerPreviewMock, resolveOwnerPreviewMock } from "./owner-preview-handlers";
import type { AssignmentProposal } from "../../src/lib/services/workspace-orders/assignment-proposals";
import { createAIProviderSchema, updateAIProviderSchema, updateAIRoutingSchema, testSavedAIProviderSchema,
  testUnsavedAIProviderSchema, type AISettingsSnapshot } from "../../src/domain/ai-config/contracts";
import { ids, intakeFixture, knowledgeHit, optionsFixture, ordersFixture, reviewFixture,
  settingsFixture, techniciansFixture, timestamp, type MockOrder, type MockReview } from "../fixtures/ui/workspace";

export const scenarios = ["success", "empty", "delayed", "server-error", "quota-exhausted", "stale-write", "validation", "staff-partial", "staff-slow-import", "staff-preview-retry", "staff-import-retry", "preview-empty", "preview-error", "preview-expired", "preview-exit-error"] as const;
export type Scenario = (typeof scenarios)[number];
type Proposal = { id: string; status: AssignmentProposal["status"]; canonicalPayload: { orderId: string; technicianId: string; scheduledAt: string | null };
  targetUpdatedAt: string; expiresAt: string };
function initialStore() {
  return { orders: structuredClone(ordersFixture), reviews: [structuredClone(reviewFixture)], published: new Set([ids.version as string]),
    proposals: new Map<string, Proposal>(), settings: structuredClone(settingsFixture), counter: 10, revision: 0,
    generation: 1, budget: { used: 3, limit: 20, resetAt: "2026-10-01T00:00:00+08:00" } };
}
let store = initialStore();
let scenario: Scenario = "success";
export function resetMock(next: Scenario = scenario) {
  scenario = next; store = initialStore();
  resetStaffMock(next === "empty");
  resetOwnerPreviewMock(next);
  if (next === "empty") {
    store.orders = []; store.reviews = []; store.published.clear();
    store.settings = { ...store.settings, providers: [], settings: { ...store.settings.settings, defaultProviderConfigId: null } };
  }
  if (next === "quota-exhausted") store.budget.used = store.budget.limit;
}
export function getScenario() { return scenario; }
function generatedId(state: ReturnType<typeof initialStore>, kind: number) {
  return `${kind}0000000-0000-4000-8000-${String(++state.counter).padStart(12, "0")}`;
}
function notice(message: string) { window.dispatchEvent(new CustomEvent("mock-api-notice", { detail: message })); }
function safeRequestLocation(request: Request) {
  const url = new URL(request.url);
  // URL.origin excludes username/password; never include query, fragment, headers, or body.
  return `${url.origin}${url.pathname}`;
}
function failure(status: number, message: string, admin = false, fieldErrors?: Record<string, string[]>) {
  return HttpResponse.json(admin ? { error: { code: status === 400 ? "VALIDATION_ERROR" : "MOCK_FAILURE", message, ...(fieldErrors ? { fieldErrors } : {}) } }
    : { error: message }, { status });
}
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" ? value as Record<string, unknown> : {}; }
function text(input: Record<string, unknown>, key: string) { return typeof input[key] === "string" ? String(input[key]).trim() : ""; }
function resetDemoRecords(state: ReturnType<typeof initialStore>) {
  // Local fixture reseed only. Platform provider settings and daily allowance are preserved.
  state.generation += 1;
  state.orders = structuredClone(ordersFixture);
  state.proposals.clear();
  state.reviews = [structuredClone(reviewFixture)];
  state.published = new Set([ids.version as string]);
}

async function resolve(request: Request) {
  // Capture the scenario/store before awaiting so switching scenario cannot revive old state.
  const state = store;
  const selected = scenario;
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const previewResponse = await resolveOwnerPreviewMock(request, selected);
  if (previewResponse) return previewResponse;
  const staffResponse = await resolveStaffMock(request, selected);
  if (staffResponse) return staffResponse;
  const admin = path.startsWith("/api/admin/ai-settings");
  const demoReset = path === "/api/platform/demo/reset";
  const guestBudget = path === "/api/platform/guest-ai-budget";
  const base = `/api/workspaces/${ids.workspace}`;
  const suffix = path.startsWith(base + "/") ? path.slice(base.length) : "";
  const providerRoute = /^\/api\/admin\/ai-settings\/providers\/([^/]+)(\/test)?$/.exec(path);
  const proposalRoute = /^\/assignment-proposals\/([^/]+)$/.exec(suffix);
  const orderRoute = /^\/orders\/([^/]+)\/(assignment|schedule|status)$/.exec(suffix);
  const known = (path === "/api/admin/ai-settings" && method === "GET") ||
    ((demoReset || guestBudget) && ["GET", "POST"].includes(method)) ||
    (path === "/api/admin/ai-settings/providers" && method === "POST") ||
    (path === "/api/admin/ai-settings/test" && method === "POST") ||
    (path === "/api/admin/ai-settings/routing" && method === "PUT") ||
    (providerRoute && (providerRoute[2] ? method === "POST" : ["PATCH", "DELETE"].includes(method))) ||
    (suffix === "/orders" && ["GET", "POST"].includes(method)) ||
    (suffix === "/technicians" && method === "GET") ||
    (suffix === "/order-intake/options" && method === "GET") ||
    (["/agent/orders", "/agent/knowledge", "/order-intake/draft", "/order-intake/confirm", "/knowledge/pdf", "/assignment-proposals"].includes(suffix) && method === "POST") ||
    (suffix === "/knowledge" && ["GET", "POST"].includes(method)) ||
    (proposalRoute && ["GET", "POST"].includes(method)) || (orderRoute && method === "POST");
  if (!known) { const message = `Missing MOCK handler: ${method} ${path}`; notice(message); return failure(500, message, admin); }
  if (selected === "delayed") await delay(6000);
  if (request.signal.aborted) return failure(499, "MOCK request cancelled", admin);
  if (selected === "server-error") return failure(503, "MOCK server is unavailable. Retry after selecting success.", admin);
  let body: Record<string, unknown> = {};
  if (!["GET", "HEAD", "DELETE"].includes(method) && request.headers.get("Content-Type")?.includes("application/json")) {
    try { body = object(await request.json()); } catch { return failure(400, "Invalid request", admin); }
  }
  const paid = suffix.startsWith("/agent/") || suffix === "/order-intake/draft" ||
    (suffix === "/knowledge" && body.action === "index") || suffix === "/knowledge/pdf";
  if (selected === "quota-exhausted" && paid) return HttpResponse.json({
    error: "Today's Guest AI allowance is used up. Manual actions remain available.", resetAt: "2026-10-01T00:00:00+08:00",
  }, { status: 429 });
  const mutation = ["POST", "PATCH", "PUT", "DELETE"].includes(method);
  if (selected === "validation" && mutation) return failure(400, "MOCK validation rejected this input. Review the required fields.", admin,
    admin ? { model: ["MOCK model validation failure."] } : undefined);
  if (demoReset) {
    if (method === "GET") return HttpResponse.json({ generation: state.generation, orderCount: state.orders.length });
    if (body.confirm !== "RESET DEMO" || typeof body.expectedGeneration !== "number" ||
      !Number.isSafeInteger(body.expectedGeneration) || body.expectedGeneration < 1) return failure(400, "Invalid reset request");
    if (selected === "stale-write") {
      // Simulate another reset winning first; actual route reports unavailable, then the card reads current status.
      resetDemoRecords(state); return failure(503, "Demo reset unavailable");
    }
    if (body.expectedGeneration !== state.generation) return failure(503, "Demo reset unavailable");
    resetDemoRecords(state); return HttpResponse.json({ generation: state.generation });
  }
  if (guestBudget) {
    if (method === "GET") return HttpResponse.json({ ...state.budget, remaining: Math.max(0, state.budget.limit - state.budget.used) });
    if (typeof body.limit !== "number" || !Number.isSafeInteger(body.limit) || body.limit < 1 || body.limit > 1000) {
      return failure(400, "Daily limit must be an integer from 1 to 1000");
    }
    state.budget.limit = body.limit; return HttpResponse.json({ limit: state.budget.limit });
  }
  const staleWrite = mutation && (proposalRoute || orderRoute || suffix === "/orders" || suffix === "/order-intake/confirm" || suffix === "/knowledge");
  if (selected === "stale-write" && staleWrite) {
    if (proposalRoute) {
      const proposal = state.proposals.get(proposalRoute[1]);
      if (proposal) { proposal.status = "STALE"; return HttpResponse.json({ proposal }, { status: 409 }); }
    }
    return failure(409, "Workspace or order changed; refresh and review again.", admin);
  }
  if (suffix === "/orders" && method === "GET") {
    const preview = getMockOwnerPreview();
    const technician = preview?.role === "TECHNICIAN" ? techniciansFixture.find((item) => item.profile_id === preview.effectiveEmployeeProfileId) : null;
    const orders = preview?.role === "TECHNICIAN" ? state.orders.filter((item) => technician && item.assigned_technician_id === technician.id) : state.orders;
    return HttpResponse.json({ orders, generation: state.generation });
  }
  if (suffix === "/technicians") return HttpResponse.json({ technicians: selected === "empty" ? [] : techniciansFixture });
  if (suffix === "/order-intake/options") return HttpResponse.json({ ...optionsFixture, generation: state.generation });
  if (suffix === "/agent/orders") {
    const orders = body.focusOrderId ? state.orders.filter((order) => order.id === body.focusOrderId) : state.orders;
    return HttpResponse.json({ answer: orders.length ? "MOCK evidence: inspect airflow for MOCK-001; confirm access for the maintenance visit. No order was changed."
      : "No matching visible orders were found. Please clarify the request.", orders,
    activity: [{ type: body.focusOrderId ? "ORDER_READ" : "RECENT_ORDERS_READ", orderCount: orders.length }], traceId: "mock-orders-trace" });
  }
  const hits = state.reviews.filter((review) => state.published.has(review.versionId)).map((review) => knowledgeHit(review));
  if (suffix === "/agent/knowledge") return HttpResponse.json({ status: hits.length ? "EXCERPTS_FOUND" : "INSUFFICIENT",
    answer: hits.length ? "MOCK: review these original published excerpts before acting." : "Published evidence is insufficient. Confirm the unit model and inspect sources manually.",
    excerpts: hits.map((hit) => ({ text: hit.content, citation: hit.citation })),
    activity: [{ type: "KNOWLEDGE_SEARCH", hitCount: hits.length }], traceId: "mock-knowledge-trace" });
  if (suffix === "/order-intake/draft") {
    const file = (await request.formData()).get("file");
    if (!(file instanceof Blob) || !file.size || !["text/plain", "application/pdf"].includes(file.type)) return failure(400, "Invalid document");
    return HttpResponse.json({ ...intakeFixture, generation: state.generation });
  }
  if ((suffix === "/orders" && method === "POST") || suffix === "/order-intake/confirm") {
    if (body.expectedGeneration !== state.generation) return failure(409, "Workspace changed");
    const customer = object(body.customer);
    const validCustomer = suffix === "/orders" ? body.customerId === ids.customer : customer.mode === "EXISTING" ? customer.customerId === ids.customer :
      customer.mode === "NEW" && text(customer, "name") && text(customer, "address");
    if (!validCustomer || body.branchId !== ids.branch || !text(body, "orderNo") || !text(body, "serviceType") || !text(body, "problemDescription") ||
      (suffix === "/order-intake/confirm" && body.confirmed !== true)) return failure(400, "Invalid request");
    if (state.orders.some((order) => order.order_no === text(body, "orderNo"))) return failure(409, "Order number already exists");
    const order: MockOrder = { ...structuredClone(ordersFixture[0]), id: generatedId(state, 5), order_no: text(body, "orderNo"),
      service_type: text(body, "serviceType"), problem_description: text(body, "problemDescription") };
    state.orders.unshift(order); return HttpResponse.json({ order }, { status: 201 });
  }
  if (orderRoute) {
    const order = state.orders.find((item) => item.id === orderRoute[1]);
    if (!order) return failure(404, "Order unavailable");
    if (body.expectedGeneration !== state.generation || body.expectedUpdatedAt !== order.updated_at) return failure(409, "Order changed");
    if (orderRoute[2] === "assignment") {
      if (body.technicianId !== ids.technician) return failure(400, "Invalid technician");
      order.assigned_technician_id = ids.technician; order.status = "ASSIGNED";
    } else if (orderRoute[2] === "status") {
      const next = order.status === "ASSIGNED" ? "IN_PROGRESS" : order.status === "IN_PROGRESS" ? "COMPLETED" : null;
      if (!next || body.nextStatus !== next) return failure(409, "Job transition rejected");
      order.status = next;
    }
    if (orderRoute[2] !== "status") order.scheduled_at = text(body, "scheduledAt") || null;
    order.updated_at = new Date(Date.parse(timestamp) + (++state.revision * 1000)).toISOString();
    return HttpResponse.json({ order });
  }
  if (suffix === "/assignment-proposals") {
    const order = state.orders.find((item) => item.id === body.orderId);
    if (!order || body.technicianId !== ids.technician) return failure(400, "Invalid request");
    if (order.updated_at !== body.expectedUpdatedAt) return failure(409, "Order changed");
    const proposal: Proposal = { id: generatedId(state, 9), status: "PENDING", canonicalPayload: {
      orderId: order.id, technicianId: ids.technician, scheduledAt: text(body, "scheduledAt") || null },
    targetUpdatedAt: order.updated_at, expiresAt: "2030-01-01T00:00:00.000Z" };
    state.proposals.set(proposal.id, proposal); return HttpResponse.json({ proposal }, { status: 201 });
  }
  if (proposalRoute) {
    const proposal = state.proposals.get(proposalRoute[1]);
    if (!proposal) return failure(404, "Proposal unavailable");
    const previewToken = proposal.id.replaceAll("-", "").padEnd(64, "0");
    if (method === "GET") return HttpResponse.json({ proposal, previewToken });
    if (Object.keys(body).length !== 2 || body.confirm !== true || typeof body.previewToken !== "string" || body.previewToken.length !== 64) return failure(400, "Invalid request");
    if (body.previewToken !== previewToken) return failure(403, "Confirmation required");
    if (proposal.status === "EXECUTED") return HttpResponse.json({ proposal });
    const order = state.orders.find((item) => item.id === proposal.canonicalPayload.orderId);
    if (!order || order.updated_at !== proposal.targetUpdatedAt) { proposal.status = "STALE"; return HttpResponse.json({ proposal }, { status: 409 }); }
    order.assigned_technician_id = proposal.canonicalPayload.technicianId; order.scheduled_at = proposal.canonicalPayload.scheduledAt;
    order.status = "ASSIGNED"; order.updated_at = new Date(Date.parse(timestamp) + (++state.revision * 1000)).toISOString();
    proposal.status = "EXECUTED"; return HttpResponse.json({ proposal });
  }
  if (suffix === "/knowledge" && method === "GET") {
    if (url.searchParams.has("query")) return HttpResponse.json({ generation: state.generation, hits });
    if (url.searchParams.has("reviewDocumentId")) {
      const review = state.reviews.find((item) => item.documentId === url.searchParams.get("reviewDocumentId") && item.versionId === url.searchParams.get("reviewVersionId"));
      return review ? HttpResponse.json({ generation: state.generation, review }) : failure(404, "Review unavailable");
    }
    return HttpResponse.json({ generation: state.generation });
  }
  if (suffix === "/knowledge/pdf") {
    const form = await request.formData();
    const review = state.reviews.find((item) => item.documentId === form.get("documentId"));
    const file = form.get("file");
    if (!review || form.get("generation") !== String(state.generation) || !(file instanceof Blob) || file.type !== "application/pdf") return failure(400, "Invalid PDF");
    review.versionId = generatedId(state, 7); review.sourceKind = "PDF_TEXT"; review.indexState = "PENDING";
    review.sourceText = "MOCK extracted PDF text. Inspect filter with power disconnected. No real parser or embedding provider ran.";
    return HttpResponse.json({ versionId: review.versionId }, { status: 201 });
  }
  if (suffix === "/knowledge" && method === "POST") {
    if (body.generation !== state.generation) return failure(409, "Workspace changed");
    if (body.action === "create") {
      if (!text(body, "title") || !text(body, "sourceLabel")) return failure(400, "Invalid request");
      const review: MockReview = { ...structuredClone(reviewFixture), documentId: generatedId(state, 6), versionId: generatedId(state, 7),
        title: text(body, "title"), sourceLabel: text(body, "sourceLabel"), sourceText: "", indexState: "PENDING" };
      state.reviews.push(review); return HttpResponse.json({ documentId: review.documentId }, { status: 201 });
    }
    const review = state.reviews.find((item) => item.documentId === body.documentId);
    if (!review) return failure(404, "Knowledge unavailable");
    if (body.action === "stage") {
      if (!text(body, "sourceText")) return failure(400, "Invalid request");
      review.versionId = generatedId(state, 7); review.sourceText = text(body, "sourceText"); review.indexState = "PENDING"; review.sourceKind = "TEXT";
      return HttpResponse.json({ versionId: review.versionId }, { status: 201 });
    }
    if (body.versionId !== review.versionId) return failure(409, "Version changed");
    if (body.action === "index") review.indexState = "READY";
    else if (body.action === "retry") { review.indexState = "PENDING"; review.indexError = null; }
    else if (body.action === "publish") {
      if (review.indexState !== "READY") return failure(409, "Index is not READY");
      state.published.add(review.versionId);
    } else return failure(400, "Invalid request");
    return HttpResponse.json({ ok: true });
  }
  if (admin) {
    if (path === "/api/admin/ai-settings") return HttpResponse.json(state.settings);
    if (path === "/api/admin/ai-settings/routing") {
      const parsed = updateAIRoutingSchema.safeParse(body);
      if (!parsed.success) return failure(400, "Invalid routing", true);
      state.settings = { ...state.settings, settings: { ...state.settings.settings, routingMode: parsed.data.routingMode,
        ...(parsed.data.routingMode === "SINGLE_MODEL" ? { defaultProviderConfigId: parsed.data.defaultProviderConfigId } : {}) },
      ...(parsed.data.routingMode === "TASK_BASED" ? { routes: parsed.data.routes } : {}) };
      return HttpResponse.json(state.settings);
    }
    if (path === "/api/admin/ai-settings/test" || providerRoute?.[2]) {
      const parsed = providerRoute ? testSavedAIProviderSchema.safeParse(body) : testUnsavedAIProviderSchema.safeParse(body);
      return parsed.success ? HttpResponse.json({ ok: true, checkedAt: timestamp }) : failure(400, "Invalid test input", true);
    }
    if (method === "DELETE" && providerRoute) {
      state.settings = { ...state.settings, providers: state.settings.providers.filter((provider) => provider.id !== providerRoute[1]),
        settings: { ...state.settings.settings, defaultProviderConfigId: state.settings.settings.defaultProviderConfigId === providerRoute[1] ? null : state.settings.settings.defaultProviderConfigId },
        routes: Object.fromEntries(Object.entries(state.settings.routes).map(([key, value]) => [key, value === providerRoute[1] ? null : value])) as AISettingsSnapshot["routes"] };
      return HttpResponse.json({ ok: true });
    }
    const parsed = method === "POST" ? createAIProviderSchema.safeParse(body) : updateAIProviderSchema.safeParse(body);
    if (!parsed.success) return failure(400, "Invalid provider input", true, parsed.error.flatten().fieldErrors);
    const existing = providerRoute && state.settings.providers.find((provider) => provider.id === providerRoute[1]);
    if (providerRoute && !existing) return failure(404, "Provider unavailable", true);
    if (existing && body.baseUrl !== existing.baseUrl && !text(body, "apiKey")) return failure(400, "A replacement credential is required for a new URL.", true, { apiKey: ["Enter a replacement mock credential."] });
    // Intentionally exclude plaintext apiKey/requestKey from stored/returned profiles.
    const profile = { ...(existing || settingsFixture.providers[0]), id: existing ? existing.id : generatedId(state, 8),
      name: text(body, "name"), baseUrl: text(body, "baseUrl"), model: text(body, "model"),
      capabilities: body.capabilities as typeof settingsFixture.providers[0]["capabilities"], status: body.status as typeof settingsFixture.providers[0]["status"],
      credential: { configured: true, last4: "MOCK" }, updatedAt: timestamp };
    state.settings = { ...state.settings, providers: [...state.settings.providers.filter((provider) => provider.id !== profile.id), profile] };
    return HttpResponse.json({ provider: profile }, { status: method === "POST" ? 201 : 200 });
  }
  const message = `Missing MOCK response: ${method} ${path}`; notice(message); return failure(500, message, admin);
}

export const worker = setupWorker(
  http.all(/\/api(?:\/|$)/, async ({ request }) => {
    const url = new URL(request.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") return passthrough();
    if (url.origin !== window.location.origin) {
      notice(`MOCK blocked external API request: ${safeRequestLocation(request)}`); return failure(500, "MOCK blocks external network access");
    }
    const response = await resolve(request);
    notice(`${request.method} ${new URL(request.url).pathname} → ${response.status} (MOCK)`);
    return response;
  }),
  http.all("*", ({ request }) => {
    const url = new URL(request.url);
    // Browser-owned extension/blob schemes are outside application HTTP mocking.
    if (url.protocol !== "http:" && url.protocol !== "https:") return passthrough();
    if (url.origin !== window.location.origin) {
      notice(`MOCK blocked external network request: ${safeRequestLocation(request)}`); return failure(500, "MOCK blocks external network access");
    }
    // Same-origin Vite modules/styles/assets are served by Vite. No API falls through.
    return undefined;
  }),
);
