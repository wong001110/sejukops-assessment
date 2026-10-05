import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";

import { hasActorPermission, type ActorContext } from "@/lib/auth/actor-policy";
import { isSameOriginRequest } from "@/lib/auth/demo-entry";
import { getServerActorContext } from "@/lib/auth/server-actor";
import {
  approveWorkspaceOrderAssignmentFromWeb,
  AssignmentProposalError,
  executeWorkspaceOrderAssignmentProposal,
  parseAssignmentProposal,
  type AssignmentProposal,
} from "@/lib/services/workspace-orders/assignment-proposals";
import { matchesProposalPreviewToken, proposalPreviewToken } from "@/lib/services/workspace-orders/proposal-preview";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ workspaceId: string; proposalId: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const confirmBody = z.object({ confirm: z.literal(true), previewToken: z.string().length(64) }).strict();

function allowed(actor: ActorContext, proposal: AssignmentProposal, workspaceId: string, proposalId: string) {
  return actor.membership?.workspaceId === workspaceId && actor.membership.role === "ADMIN" &&
    hasActorPermission(actor, "order:assign") && proposal.workspaceId === workspaceId &&
    proposal.id === proposalId && proposal.initiatorProfileId === actor.profileId &&
    (proposal.approverProfileId === null || proposal.approverProfileId === actor.profileId);
}

async function currentProposal(workspaceId: string, proposalId: string) {
  const session = await createServerSupabaseClient();
  const { data, error } = await session.from("workspace_assignment_proposals").select("*")
    .eq("workspace_id", workspaceId).eq("id", proposalId).maybeSingle();
  if (error || !data) return null;
  return { session, proposal: parseAssignmentProposal(data) };
}

function secret() { return process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || null; }
function unavailable() { return NextResponse.json({ error: "Proposal unavailable" }, { status: 503 }); }
function forbidden() { return NextResponse.json({ error: "Forbidden" }, { status: 403 }); }

export async function GET(_request: Request, context: RouteContext) {
  const { workspaceId, proposalId } = await context.params;
  if (!UUID.test(workspaceId) || !UUID.test(proposalId)) return forbidden();
  try {
    const actor = await getServerActorContext(workspaceId);
    if (!actor) return forbidden();
    const current = await currentProposal(workspaceId, proposalId);
    if (!current || !allowed(actor, current.proposal, workspaceId, proposalId)) return forbidden();
    const key = secret();
    if (!key) return unavailable();
    return NextResponse.json({
      proposal: current.proposal,
      previewToken: proposalPreviewToken(actor, current.proposal, key),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Proposal unavailable" }, { status: 500 });
  }
}

export async function POST(request: Request, context: RouteContext) {
  if (!isSameOriginRequest(request)) return forbidden();
  const { workspaceId, proposalId } = await context.params;
  if (!UUID.test(workspaceId) || !UUID.test(proposalId)) return forbidden();
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const parsed = confirmBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  try {
    // This resolves Auth with getUser() on every confirmation, not from the
    // preview response, caller-supplied identity, or a model tool argument.
    const actor = await getServerActorContext(workspaceId);
    if (!actor) return forbidden();
    const current = await currentProposal(workspaceId, proposalId);
    if (!current || !allowed(actor, current.proposal, workspaceId, proposalId)) return forbidden();
    const key = secret();
    if (!key) return unavailable();
    if (!matchesProposalPreviewToken(parsed.data.previewToken, actor, current.proposal, key)) return forbidden();
    if (current.proposal.status === "EXECUTED") {
      return NextResponse.json({ proposal: current.proposal }, { headers: { "Cache-Control": "no-store" } });
    }
    if (Date.parse(current.proposal.expiresAt) <= Date.now() ||
        !["PENDING", "APPROVED"].includes(current.proposal.status)) {
      return NextResponse.json({ error: "Proposal is stale" }, { status: 409 });
    }
    if (current.proposal.status === "PENDING") {
      const { url } = getSupabasePublicConfig();
      const privileged = createClient(url, key, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const approved = await approveWorkspaceOrderAssignmentFromWeb(actor, privileged, { workspaceId, proposalId });
      if (approved.status !== "APPROVED") {
        return NextResponse.json({ proposal: approved }, { status: 409, headers: { "Cache-Control": "no-store" } });
      }
    }
    const executed = await executeWorkspaceOrderAssignmentProposal(actor, current.session, { workspaceId, proposalId });
    return NextResponse.json({ proposal: executed }, {
      status: executed.status === "EXECUTED" ? 200 : 409,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof AssignmentProposalError) {
      return NextResponse.json({ error: error.code === "FORBIDDEN" ? "Forbidden" : "Proposal rejected" }, {
        status: error.code === "FORBIDDEN" ? 403 : 409,
      });
    }
    return NextResponse.json({ error: "Proposal unavailable" }, { status: 500 });
  }
}
