import { describe, expect, it } from "vitest";
import { nativeWorkspaceSchema } from "@/domain/agent-workspace/contracts";
import { readNativeAgentStream } from "./native-agent-stream";

const runId = "10000000-0000-4000-8000-000000000001";
const workspaceId = "10000000-0000-4000-8000-000000000002";
const workspace = {
  runId, workspaceId, mode: "live", type: "focus", title: "Sources", summary: "No matching records.", status: "COMPLETE",
  items: [], excerpts: [], proposal: null, missingInformation: [], followUps: [],
  scope: { ordersRead: 0, knowledgeHits: 0, checkedAt: "2026-10-05T00:00:00.000Z" },
};
function response(lines: unknown[]) {
  return new Response(lines.map((value) => typeof value === "string" ? value : JSON.stringify(value)).join("\n") + "\n");
}
const start = { type: "started", runId };
const complete = { type: "workspace", workspace };

describe("native agent transport", () => {
  it("accepts split UTF-8 chunks and delivers activity before the final workspace", async () => {
    const data = new TextEncoder().encode([start, { type: "activity", activity: { id: runId, tool: "recentOrders", status: "succeeded", count: 0 } },
      { ...complete, workspace: { ...workspace, title: "来源记录" } }].map((event) => JSON.stringify(event)).join("\n"));
    const stream = new ReadableStream({ start(controller) { for (const byte of data) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
    const events: string[] = [];
    await readNativeAgentStream(new Response(stream), (event) => events.push(event.type), new AbortController().signal);
    expect(events).toEqual(["started", "activity", "workspace"]);
  });
  it.each([
    [[start], "stopped before"],
    [[start, "{invalid"], "incomplete"],
    [[complete], "invalid"],
    [[start, start, complete], "invalid"],
    [[start, { ...complete, workspace: { ...workspace, runId: workspaceId } }], "match this run"],
    [[start, { ...complete, workspace: { ...workspace, html: "<script>" } }], "could not be verified"],
    [[start, complete, complete], "invalid"],
  ])("rejects an invalid or incomplete run %j", async (events, message) => {
    await expect(readNativeAgentStream(response(events as unknown[]), () => undefined, new AbortController().signal)).rejects.toThrow(String(message));
  });
  it("returns a controlled error as a terminal event", async () => {
    const events: string[] = [];
    await readNativeAgentStream(response([start, { type: "error", code: "EXHAUSTED", message: "Allowance exhausted." }]),
      (event) => events.push(event.type), new AbortController().signal);
    expect(events).toEqual(["started", "error"]);
  });
  it("aborts a stream with no terminal result", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(readNativeAgentStream(response([start, complete]), () => undefined, controller.signal)).rejects.toThrow();
  });
  it("rejects citation scope, duplicate sources, and impossible layout cardinality", () => {
    const citation = { workspaceId: runId, documentId: runId, versionId: runId, title: "Source", sourceLabel: "Text", section: "1", page: 1, ordinal: 0 };
    expect(nativeWorkspaceSchema.safeParse({ ...workspace, excerpts: [{ text: "Source", citation }] }).success).toBe(false);
    expect(nativeWorkspaceSchema.safeParse({ ...workspace, type: "comparison" }).success).toBe(false);
    expect(nativeWorkspaceSchema.safeParse({ ...workspace, type: "investigation" }).success).toBe(false);
    expect(nativeWorkspaceSchema.safeParse({ ...workspace, excerpts: [1, 2].map(() => ({ text: "Source", citation: { ...citation, workspaceId } })) }).success).toBe(false);
  });
});
