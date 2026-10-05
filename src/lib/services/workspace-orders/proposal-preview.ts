import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import type { ActorContext } from "@/lib/auth/actor-policy";

import type { AssignmentProposal } from "./assignment-proposals";

/** A short lived proof that this actor fetched these persisted fields. */
export function proposalPreviewToken(
  actor: ActorContext,
  proposal: AssignmentProposal,
  secret: string,
): string {
  const canonical = JSON.stringify({
    workspaceId: proposal.workspaceId,
    proposalId: proposal.id,
    initiatorProfileId: proposal.initiatorProfileId,
    actorAuthUserId: actor.authUserId,
    payload: proposal.canonicalPayload,
    targetUpdatedAt: proposal.targetUpdatedAt,
    datasetGeneration: proposal.datasetGeneration,
    expiresAt: proposal.expiresAt,
  });
  return createHmac("sha256", secret).update("assignment-preview-v1\0").update(canonical).digest("hex");
}

export function matchesProposalPreviewToken(
  supplied: string,
  actor: ActorContext,
  proposal: AssignmentProposal,
  secret: string,
): boolean {
  if (!/^[a-f0-9]{64}$/.test(supplied)) return false;
  const expected = proposalPreviewToken(actor, proposal, secret);
  return timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(expected, "hex"));
}
