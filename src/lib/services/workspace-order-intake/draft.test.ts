import { describe, expect, it, vi } from "vitest";

import type { ActorContext } from "@/lib/auth/actor-policy";

vi.mock("@/lib/auth/workspace-request-context", () => ({ getWorkspaceRequestContext: vi.fn() }));

import { prepareWorkspaceOrderDraft, WorkspaceOrderIntakeError } from "./draft";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const actor: ActorContext = {
  authUserId: "22222222-2222-4222-8222-222222222222",
  profileId: "33333333-3333-4333-8333-333333333333",
  platformRole: "USER", isAnonymous: false,
  membership: { workspaceId, kind: "OWNER", role: "ADMIN" },
};
const draft = {
  customerName: { value: "A", confidence: "high" as const, issues: [] },
  serviceType: { value: "Repair", confidence: "high" as const, issues: [] },
  serviceDetails: { value: "Unit leaks", confidence: "medium" as const, issues: [] },
  amount: { value: null, confidence: "missing" as const, issues: [] },
  date: { value: null, confidence: "missing" as const, issues: [] },
};

describe("workspace document-to-order draft", () => {
  it("preserves a denied Guest allowance instead of hiding it as provider failure", async () => {
    const exhausted = new WorkspaceOrderIntakeError("AI_ALLOWANCE_EXHAUSTED", "2026-09-30T16:00:00Z");
    const extract = vi.fn().mockRejectedValue(exhausted);
    await expect(prepareWorkspaceOrderDraft(actor, {} as never,
      { workspaceId, mimeType: "text/plain", bytes: new TextEncoder().encode("Customer: A") }, {
        readGeneration: vi.fn().mockResolvedValue(2),
        resolveProvider: vi.fn().mockResolvedValue({}), extract,
      })).rejects.toBe(exhausted);
  });

  it("never calls a provider for a wrong workspace or role", async () => {
    const resolveProvider = vi.fn();
    const input = { workspaceId, mimeType: "text/plain" as const, bytes: new TextEncoder().encode("Customer: A") };
    await expect(prepareWorkspaceOrderDraft({ ...actor, membership: { ...actor.membership!, role: "TECHNICIAN" } },
      {} as never, input, { resolveProvider })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(prepareWorkspaceOrderDraft(actor, {} as never,
      { ...input, workspaceId: "44444444-4444-4444-8444-444444444444" },
      { resolveProvider })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(resolveProvider).not.toHaveBeenCalled();
  });

  it("rejects malformed PDFs before any provider call", async () => {
    const resolveProvider = vi.fn();
    await expect(prepareWorkspaceOrderDraft(actor, {} as never, {
      workspaceId, mimeType: "application/pdf", bytes: new TextEncoder().encode("not pdf"),
    }, { resolveProvider })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(resolveProvider).not.toHaveBeenCalled();
  });

  it("returns review-only fields and rejects a generation changed during extraction", async () => {
    const readGeneration = vi.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(3);
    const extract = vi.fn().mockResolvedValue(draft);
    const resolveProvider = vi.fn().mockResolvedValue({});
    const input = { workspaceId, mimeType: "text/plain" as const, bytes: new TextEncoder().encode("Customer: A") };
    await expect(prepareWorkspaceOrderDraft(actor, {} as never, input,
      { readGeneration, resolveProvider, extract })).rejects.toBeInstanceOf(WorkspaceOrderIntakeError);
    expect(extract).toHaveBeenCalledOnce();
    expect(readGeneration).toHaveBeenCalledTimes(2);
    readGeneration.mockReset().mockResolvedValue(3);
    const result = await prepareWorkspaceOrderDraft(actor, {} as never, input,
      { readGeneration, resolveProvider, extract });
    expect(result).toMatchObject({ draft, generation: 3, sourceSha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });

  it("converts bounded PDF pages to plain text before the model sees them", async () => {
    const extractPdfPages = vi.fn().mockResolvedValue(["Customer: A", "Service: Repair"]);
    const extract = vi.fn().mockResolvedValue(draft);
    const bytes = new TextEncoder().encode("%PDF-fake-for-parser-stub");
    await prepareWorkspaceOrderDraft(actor, {} as never,
      { workspaceId, mimeType: "application/pdf", bytes }, {
        readGeneration: vi.fn().mockResolvedValue(2),
        resolveProvider: vi.fn().mockResolvedValue({}), extractPdfPages, extract,
      });
    expect(extractPdfPages).toHaveBeenCalledWith(bytes);
    expect(extract.mock.calls[0][1]).toBe("text/plain");
    expect(new TextDecoder().decode(extract.mock.calls[0][2])).toContain("Service: Repair");
  });
});
