import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { ActorContext } from "@/lib/auth/actor-policy";
import { assignWorkspaceOrder, createWorkspaceOrder } from "./commands";
import { rescheduleManagerOrder } from "./manager-reschedule";
import { transitionAssignedJob } from "./technician-transition";
import { createKnowledgeDocument, stageKnowledgeText, issueKnowledgePdfAttestation } from "../workspace-knowledge/service";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const timestamp = "2026-10-01T00:00:00Z";
function owner(role: "ADMIN" | "MANAGER" | "TECHNICIAN"): ActorContext { return { authUserId: id, profileId: id, isAnonymous: false, platformRole: "SUPER_ADMIN", sessionId: id, businessReady: true, membership: { workspaceId, kind: "OWNER", role }, preview: { readOnly: true, effectiveEmployeeProfileId: role === "TECHNICIAN" ? id : null } }; }
describe("Owner read-only preview business command boundary", () => {
  it("denies Admin creation and assignment before any RPC", async () => {
    const rpc = vi.fn(); const client = { rpc } as unknown as SupabaseClient;
    await expect(createWorkspaceOrder(owner("ADMIN"), client, { workspaceId, expectedGeneration: 1, orderNo: "MOCK-1", branchId: id, customerId: id, problemDescription: "Synthetic problem", serviceType: "Synthetic service" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(assignWorkspaceOrder(owner("ADMIN"), client, { workspaceId, expectedGeneration: 1, orderId: id, technicianId: id, expectedUpdatedAt: timestamp, scheduledAt: null })).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(rpc).not.toHaveBeenCalled();
  });
  it("denies Manager reschedule before any RPC", async () => {
    const rpc = vi.fn(); await expect(rescheduleManagerOrder(owner("MANAGER"), { rpc } as unknown as SupabaseClient, { workspaceId, expectedGeneration: 1, orderId: id, expectedUpdatedAt: timestamp, scheduledAt: "2026-10-02T00:00:00Z" }, null)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(rpc).not.toHaveBeenCalled();
  });
  it.each(["IN_PROGRESS", "COMPLETED"] as const)("denies Technician %s before any RPC", async (nextStatus) => {
    const rpc = vi.fn(); await expect(transitionAssignedJob(owner("TECHNICIAN"), { rpc } as unknown as SupabaseClient, { workspaceId, expectedGeneration: 1, orderId: id, expectedUpdatedAt: timestamp, nextStatus }, null)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(rpc).not.toHaveBeenCalled();
  });
  it.each(["ADMIN", "MANAGER"] as const)("denies %s knowledge writes and service-role PDF issuance before privileged access", async (role) => {
    const rpc = vi.fn(); const client = { rpc } as unknown as SupabaseClient;
    await expect(createKnowledgeDocument(owner(role), client, { workspaceId, generation: 1, title: "Synthetic", sourceLabel: "Synthetic" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(stageKnowledgeText(owner(role), client, { workspaceId, generation: 1, documentId: id, sourceText: "Synthetic source" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(issueKnowledgePdfAttestation(owner(role), { workspaceId, generation: 1, documentId: id, pages: ["Synthetic"] })).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(rpc).not.toHaveBeenCalled();
  });
});
