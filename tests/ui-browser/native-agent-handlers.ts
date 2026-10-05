import { HttpResponse } from "msw";
import { nativeAgentRequestSchema, nativeWorkspaceSchema, type NativeActivity, type NativeAgentEvent, type NativeProposal, type NativeWorkspace } from "../../src/domain/agent-workspace/contracts";
import { ids, knowledgeHit, ordersFixture, reviewFixture, timestamp, techniciansFixture } from "../fixtures/ui/workspace";
import { nativeFailureMessage } from "../../src/lib/ai/runtime/workspace-native-diagnostics";
import { presentNativeSources } from "../../src/lib/ai/runtime/workspace-native-presentation";

type Scenario = "success" | "empty" | "delayed" | "server-error" | "quota-exhausted" | "stale-write" | string;
type ProposalRecord = { proposal: NativeProposal; previewToken: string };

const nativeProposalId = "a0000000-0000-4000-8000-000000000001";
let runCounter = 0;
const proposals = new Map<string, ProposalRecord>();

export function resetNativeAgentMock() {
  runCounter = 0;
  proposals.clear();
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function jsonBody(request: Request) {
  try { return object(await request.json()); } catch { return {}; }
}

function uuid(counter: number) {
  return `b0000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
}

function viewFor(prompt: string): NativeWorkspace["type"] {
  const forced = /\[\[view:(focus|investigation|comparison|knowledge|clarification)\]\]/i.exec(prompt)?.[1]?.toLowerCase();
  if (forced) return forced as NativeWorkspace["type"];
  // Test control markers must not alter the natural-language view decision.
  const value = prompt.replace(/\[\[[^\]]+\]\]/g, "").toLowerCase();
  if (/\[\[view:knowledge\]\]|\b(knowledge|guide|manual|source)\b/.test(value)) return "knowledge";
  if (/\[\[view:comparison\]\]|\b(compare|comparison|versus|\bvs\b)\b/.test(value)) return "comparison";
  if (/\[\[view:clarification\]\]|\b(clarify|unclear|unknown|missing information)\b/.test(value)) return "clarification";
  if (/\[\[view:investigation\]\]|\b(investigate|review (?:this order|mock-\d+)|inspect (?:this order|mock-\d+)|details for)\b/.test(value)) return "investigation";
  return "focus";
}

function citation() {
  const hit = knowledgeHit(reviewFixture);
  return { workspaceId: ids.workspace, ...hit.citation };
}

function projectedOrder(order: typeof ordersFixture[number], interpretation: string) {
  const { id, order_no, branch_id, status, problem_description, service_type, scheduled_at, assigned_technician_id, updated_at } = order;
  return { order: { id, order_no, branch_id, status, problem_description, service_type, scheduled_at, assigned_technician_id, updated_at }, interpretation };
}

function makeWorkspace(prompt: string, workspaceId: string, scenario: Scenario, requestBody: Record<string, unknown>, runId: string): NativeWorkspace {
  const view = viewFor(prompt);
  const history = Array.isArray(requestBody.conversation) ? requestBody.conversation : [];
  const contextIds = Array.isArray(requestBody.contextOrderIds) ? requestBody.contextOrderIds.filter((id): id is string => typeof id === "string") : [];
  const requested = contextIds.map((id) => ordersFixture.find((order) => order.id === id)).filter((order): order is typeof ordersFixture[number] => Boolean(order));
  const explicitOrderNumbers = [...prompt.matchAll(/MOCK-\d{3}/gi)].map((match) => match[0].toUpperCase());
  const namedOrders = explicitOrderNumbers.map((number) => ordersFixture.find((order) => order.order_no === number)).filter((order): order is typeof ordersFixture[number] => Boolean(order));
  const contextualFollowUp = contextIds.length === 1 && history.length > 0 && /\b(that|this) order\b|\bfollow[- ]?up\b/i.test(prompt);
  const contextualView = contextualFollowUp ? "investigation" as const : view;
  const explicitThenContext = [...namedOrders, ...requested.filter((order) => !namedOrders.some((named) => named.id === order.id))];
  const sourceOrders = scenario === "empty" ? [] : explicitThenContext.length ? explicitThenContext : ordersFixture;
  const selected = contextualView === "comparison" ? sourceOrders.slice(0, 2) : sourceOrders.slice(0, 1);
  const followUp = history.length > 0;
  const malicious = prompt.includes("[[hostile-text]]");
  const long = prompt.includes("[[long-text]]");
  const invalidRef = prompt.includes("[[invalid-ref]]");
  const clarification = scenario === "empty" || view === "clarification";
  const proposalRequested = /\[\[prepare-assignment\]\]|\bprepare (an )?assignment\b/i.test(prompt);
  const proposal = proposalRequested && selected.length ? {
    id: nativeProposalId,
    status: "PENDING" as const,
    canonicalPayload: { orderId: selected[0].id, technicianId: techniciansFixture[0].id, scheduledAt: null },
    targetUpdatedAt: selected[0].updated_at,
    expiresAt: "2030-01-01T00:00:00.000Z",
    orderNo: selected[0].order_no,
    technicianLabel: "Demo technician (MOCK)",
  } : null;

  if (proposal) {
    const previewToken = "mock-native-agent-preview-token".padEnd(64, "0").slice(0, 64);
    proposals.set(proposal.id, { proposal, previewToken });
  }

  const answer = malicious ? "<img src=x onerror=alert(1)> & <script>window.__nativeAgentXss=1</script>" :
    long ? `MOCK source summary. ${"Fictional detail. ".repeat(34)}` :
    followUp ? "MOCK follow-up: re-read the selected order and its published evidence for this turn." :
    "MOCK result: these fictional workspace records were read for this request.";
  const items = clarification || contextualView === "knowledge" ? [] : selected.map((order) => projectedOrder(order,
    malicious ? answer : "Synthetic interpretation; verify against the order and cited evidence."));
  const excerpts = contextualView === "knowledge" && scenario !== "empty" ? [{
    text: malicious ? answer : knowledgeHit(reviewFixture).content.slice(0, 500),
    citation: { ...citation(), ...(invalidRef ? { workspaceId: "c0000000-0000-4000-8000-000000000001" } : {}) },
  }] : [];
  const workspace = {
    runId,
    workspaceId,
    mode: "mock" as const,
    type: clarification ? "clarification" as const : contextualView,
    title: malicious ? "<img src=x onerror=alert(1)>" : `MOCK ${contextualView} workspace`,
    summary: clarification ? "No matching synthetic order was found. Which order should I inspect?" : answer,
    status: prompt.includes("[[source-only]]") ? "SOURCE_ONLY" as const : "COMPLETE" as const,
    items: items.slice(0, 5), excerpts,
    proposal,
    missingInformation: clarification ? ["Order number or service visit needed."] : [],
    followUps: clarification ? ["Review recent orders", "Search published maintenance guidance"] : ["Open the cited order", "Ask a follow-up about this result"],
    scope: { ordersRead: scenario === "empty" ? 0 : selected.length, knowledgeHits: excerpts.length, checkedAt: timestamp },
  };

  if (invalidRef) {
    // Deliberately bypass server-contract parsing only for this adversarial fixture;
    // the browser must not render a citation whose workspace is foreign.
    return workspace as unknown as NativeWorkspace;
  }
  if (prompt.includes("[[grounded]]")) {
    const presentation = presentNativeSources(workspace.type, workspace.items.map(({ order }) => order), workspace.excerpts.length, proposal !== null, workspace.status === "SOURCE_ONLY");
    Object.assign(workspace, { title: presentation.title, summary: presentation.summary,
      missingInformation: presentation.missingInformation, followUps: presentation.followUps });
    workspace.items.forEach((item, index) => { item.interpretation = presentation.interpretations[index]; });
  }
  return nativeWorkspaceSchema.parse(workspace);
}

function stream(events: Array<NativeAgentEvent | string>, options: { gapMs?: number; abortSignal?: AbortSignal } = {}) {
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const event of events) {
        if (options.abortSignal?.aborted) { controller.close(); return; }
        const line = typeof event === "string" ? event : JSON.stringify(event);
        controller.enqueue(encoder.encode(`${line}\n`));
        if (options.gapMs) await new Promise<void>((resolve) => { timer = setTimeout(resolve, options.gapMs); });
      }
      controller.close();
    },
    cancel() { if (timer) clearTimeout(timer); },
  });
  return new HttpResponse(body, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}

function activity(id: string, tool: NativeActivity["tool"], status: "running" | "succeeded" = "succeeded", count = 1): NativeAgentEvent {
  return { type: "activity", activity: { id, tool, status, count } } as NativeAgentEvent;
}

async function runRequest(request: Request, workspaceId: string, scenario: Scenario) {
  const parsed = nativeAgentRequestSchema.safeParse(await jsonBody(request));
  if (!parsed.success) return HttpResponse.json({ error: "MOCK request did not match the native agent contract." }, { status: 400 });
  const body = parsed.data;
  const runId = uuid(++runCounter);
  if (scenario === "server-error") return HttpResponse.json({ error: "MOCK agent service unavailable. Retry the request." }, { status: 503 });
  if (scenario === "quota-exhausted") return stream([
    { type: "started", runId },
    { type: "error", message: "Today's Guest AI allowance is used up. Manual actions remain available.", code: "QUOTA_EXHAUSTED", resetAt: "2026-10-06T00:00:00+08:00" },
  ]);

  const prompt = body.prompt;
  if (prompt.includes("[[provider-request-rejected]]")) return stream([
    { type: "started", runId },
    { type: "error", code: "UNAVAILABLE", message: nativeFailureMessage({ providerStatusCode: 400, failureStage: "PROVIDER_REQUEST" }) },
  ]);
  if (prompt.includes("[[malformed]]")) return stream(["{not-json"]);
  const start: NativeAgentEvent = { type: "started", runId };
  const interrupted = prompt.includes("[[truncated]]");
  const view = viewFor(prompt);
  const tool = view === "knowledge" ? "searchKnowledge" : "recentOrders";
  const activityId = uuid(1_000_000 + runCounter * 2);
  const events: Array<NativeAgentEvent | string> = [start, activity(activityId, tool, "running"), activity(activityId, tool, "succeeded", scenario === "empty" ? 0 : 2)];
  if (interrupted) return stream(events.slice(0, 2));
  if (prompt.includes("[[missing-fields]]")) {
    const malformedWorkspace = { type: "workspace", workspace: { runId, workspaceId, mode: "mock", type: "focus", title: "Missing scope" } };
    return stream([...events, malformedWorkspace as unknown as NativeAgentEvent]);
  }
  if (scenario === "delayed" || prompt.includes("[[delay]]")) return stream([...events, { type: "workspace", workspace: makeWorkspace(prompt, workspaceId, scenario, body, runId) }], { gapMs: 1_400, abortSignal: request.signal });
  const workspace = makeWorkspace(prompt, workspaceId, scenario, body, runId);
  if (prompt.includes("[[invalid-ref]]")) {
    // Contract-valid data with a foreign reference. The Agent UI must reject it before display.
    workspace.excerpts = [{ text: knowledgeHit(reviewFixture).content, citation: { ...citation(), workspaceId: "c0000000-0000-4000-8000-000000000001" } }];
  }
  events.push({ type: "workspace", workspace });
  return stream(events);
}

function proposalRoute(path: string, workspaceId: string) {
  return new RegExp(`^/api/workspaces/${workspaceId}/assignment-proposals(?:/([^/]+))?$`).exec(path);
}

async function proposalRequest(request: Request, match: RegExpExecArray, scenario: Scenario) {
  const id = match[1];
  const method = request.method;
  const stored = id ? proposals.get(id) : undefined;
  if (!stored) return HttpResponse.json({ error: "MOCK native proposal unavailable." }, { status: 404 });
  if (method === "GET") return HttpResponse.json({ proposal: stored.proposal, previewToken: stored.previewToken });
  if (method === "POST") {
    const body = await jsonBody(request);
    if (body.confirm !== true || body.previewToken !== stored.previewToken) return HttpResponse.json({ error: "MOCK confirmation requires the current preview token." }, { status: 403 });
    if (scenario === "stale-write") {
      stored.proposal = { ...stored.proposal, status: "STALE" };
      return HttpResponse.json({ proposal: stored.proposal }, { status: 409 });
    }
    stored.proposal = { ...stored.proposal, status: "EXECUTED" };
    return HttpResponse.json({ proposal: stored.proposal });
  }
  return HttpResponse.json({ error: "MOCK method unavailable." }, { status: 405 });
}

/** Resolve only the Agent Workspace NDJSON route and proposals created by this adapter. */
export async function resolveNativeAgentMock(request: Request, scenario: Scenario) {
  const path = new URL(request.url).pathname;
  const prefix = `/api/workspaces/${ids.workspace}`;
  if (!path.startsWith(`${prefix}/`)) return null;
  if (path === `${prefix}/agent/run` && request.method === "POST") return runRequest(request, ids.workspace, scenario);
  const proposal = proposalRoute(path, ids.workspace);
  if (proposal && proposal[1] && proposals.has(proposal[1]) && (request.method === "GET" || request.method === "POST")) {
    return proposalRequest(request, proposal, scenario);
  }
  return null;
}
