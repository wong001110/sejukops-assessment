import { delay, http, HttpResponse } from "msw";
import { aiSessionDetailResponseSchema, aiSessionListResponseSchema, type AiSessionSummary } from "../../src/domain/ai-sessions/contracts";
import { ids, ordersFixture, timestamp } from "../fixtures/ui/workspace";

// Synthetic browser-only records. No real Auth identity or journal persistence.
const demoWorkspaceId = "10000000-0000-4000-8000-000000000002";
const savedId = "d1000000-0000-4000-8000-000000000001";
const sparseId = "d1000000-0000-4000-8000-000000000002";
const demoId = "d1000000-0000-4000-8000-000000000003";
const workspaces = [{ id: ids.workspace, kind: "OWNER", name: "MOCK Private workspace" }, { id: demoWorkspaceId, kind: "DEMO", name: "MOCK Fictional Demo" }];
const summaries: AiSessionSummary[] = [
  { id: savedId, workspaceId: ids.workspace, workspaceKind: "OWNER", title: "MOCK Owner saved inspection", surface: "WORKSPACE", role: "ADMIN", createdAt: timestamp, updatedAt: timestamp, turnCount: 1 },
  { id: sparseId, workspaceId: ids.workspace, workspaceKind: "OWNER", title: "MOCK Owner incomplete investigation", surface: "WORKSPACE", role: "ADMIN", createdAt: timestamp, updatedAt: timestamp, turnCount: 1 },
  { id: demoId, workspaceId: demoWorkspaceId, workspaceKind: "DEMO", title: "MOCK Demo read-only question", surface: "CHATBOT", role: "MANAGER", createdAt: timestamp, updatedAt: timestamp, turnCount: 1 },
];
const sourceOrder = ordersFixture[0];
const { id, order_no, branch_id, status, problem_description, service_type, scheduled_at, assigned_technician_id, updated_at } = sourceOrder;
const snapshot = { workspaceId: ids.workspace, runId: "d2000000-0000-4000-8000-000000000001", mode: "mock", type: "focus", title: "MOCK recorded inspection snapshot",
  summary: "This fictional saved result records the filter inspection request. It is historical and cannot execute a change.", status: "COMPLETE",
  items: [{ order: { id, order_no, branch_id, status, problem_description, service_type, scheduled_at, assigned_technician_id, updated_at }, interpretation: "Fictional source record." }],
  excerpts: [], proposal: { id: "d3000000-0000-4000-8000-000000000001", status: "PENDING", orderNo: order_no, technicianLabel: "MOCK Technician",
    canonicalPayload: { orderId: id, technicianId: ids.technician, scheduledAt: null }, targetUpdatedAt: timestamp, expiresAt: "2030-01-01T00:00:00.000Z" },
  missingInformation: [], followUps: [], scope: { ordersRead: 1, knowledgeHits: 0, checkedAt: timestamp } };
const turns = [
  { id: "d4000000-0000-4000-8000-000000000001", question: "Review MOCK-001 and prepare a saved inspection proposal.", status: "COMPLETED", answer: "MOCK recorded answer: inspect the fictional filter and review the saved proposal in the current workspace.", createdAt: timestamp, completedAt: timestamp,
    workspace: snapshot, activity: [{ id: "d5000000-0000-4000-8000-000000000001", tool: "readOrder", status: "succeeded", count: 1 }] },
  { id: "d4000000-0000-4000-8000-000000000002", question: "Inspect the fictional request with missing evidence.", status: "INTERRUPTED", answer: null, createdAt: timestamp, completedAt: null,
    workspace: { ...snapshot, runId: "d2000000-0000-4000-8000-000000000002", type: "clarification", title: "MOCK incomplete source snapshot", status: "SOURCE_ONLY", items: [], proposal: null,
      summary: "The recorded request has insufficient evidence.", missingInformation: ["Fictional unit model is missing."] },
    activity: [{ id: "d5000000-0000-4000-8000-000000000002", tool: "searchKnowledge", status: "running" }] },
  { id: "d4000000-0000-4000-8000-000000000003", question: "What do the fictional Demo records show?", status: "COMPLETED", answer: "MOCK Demo answer uses only fictional records.", createdAt: timestamp, completedAt: timestamp, workspace: null, activity: [] },
];
let listAttempts = 0;
let detailAttempts = 0;
export function resetOwnerConsoleHistoryMock() { listAttempts = 0; detailAttempts = 0; }
export function createOwnerConsoleHistoryHandlers(getScenario: () => string) {
  return [http.post(/\/api\/workspaces\/[^/]+\/agent\/run$/, async ({ request }) => {
    // Dedicated local control for the product's explicit history-save warning.
    // Ordinary runs keep using the existing native-agent Mock handler.
    if (new URLSearchParams(window.location.search).get("ownerHistory") !== "warning") return;
    const events = [{ type: "started", runId: snapshot.runId }, { type: "workspace", workspace: { ...snapshot, proposal: null }, historySaved: false }];
    if (request.signal.aborted) return HttpResponse.json({ error: "MOCK request cancelled" }, { status: 499 });
    return new HttpResponse(events.map((event) => JSON.stringify(event)).join("\n") + "\n", { headers: { "Content-Type": "application/x-ndjson" } });
  }), http.get(/\/api\/(?:owner|workspaces\/[^/]+)\/ai-sessions(?:\/[^/?]+)?$/, async ({ request }) => {
    const url = new URL(request.url);
    if (url.origin !== window.location.origin) return HttpResponse.json({ error: "MOCK external request denied" }, { status: 500 });
    const control = new URLSearchParams(window.location.search).get("ownerHistory");
    const scenario = getScenario();
    const requestedId = /\/ai-sessions\/([^/]+)$/.exec(url.pathname)?.[1];
    if (scenario === "delayed" || control === "slow") await delay(1200);
    if (request.signal.aborted) return HttpResponse.json({ error: "MOCK request cancelled" }, { status: 499 });
    const attempts = requestedId ? ++detailAttempts : ++listAttempts;
    if (scenario === "server-error" || attempts === 1 && control === (requestedId ? "detail-error-once" : "list-error-once")) {
      return HttpResponse.json({ error: "MOCK history temporarily unavailable" }, { status: 503 });
    }
    const selectedWorkspace = url.searchParams.get("workspaceId") ?? /^\/api\/workspaces\/([^/]+)\//.exec(url.pathname)?.[1];
    const selectedSurface = url.searchParams.get("surface");
    const records = summaries.filter((record) => (!selectedWorkspace || record.workspaceId === selectedWorkspace) && (!selectedSurface || record.surface === selectedSurface));
    if (!requestedId) return HttpResponse.json(aiSessionListResponseSchema.parse({
      sessions: scenario === "empty" || control === "empty" ? [] : records, nextCursor: null, workspaces,
    }));
    const index = summaries.findIndex((record) => record.id === requestedId && records.some(({ id }) => id === record.id));
    if (index < 0) return HttpResponse.json({ error: "MOCK session unavailable" }, { status: 404 });
    return HttpResponse.json(aiSessionDetailResponseSchema.parse({ session: summaries[index], turns: [turns[index]] }));
  })];
}
