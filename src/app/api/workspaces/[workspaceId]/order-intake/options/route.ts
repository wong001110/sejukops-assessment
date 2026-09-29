import { NextResponse } from "next/server";

import { hasActorPermission } from "@/lib/auth/actor-policy";
import { getServerActorContext } from "@/lib/auth/server-actor";
import { readWorkspaceGeneration } from "@/lib/services/workspaces/generation";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ workspaceId: string }> };

/** Fixed, bounded option lists under the caller's RLS session. */
export async function GET(_request: Request, context: RouteContext) {
  const { workspaceId } = await context.params;
  try {
    const actor = await getServerActorContext(workspaceId);
    if (!actor || actor.membership?.workspaceId !== workspaceId ||
        actor.membership.role !== "ADMIN" || !hasActorPermission(actor, "order:create")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const supabase = await createServerSupabaseClient();
    const [generation, branches, customers] = await Promise.all([
      readWorkspaceGeneration(actor, supabase, workspaceId),
      supabase.from("workspace_branches").select("id,code,name")
        .eq("workspace_id", workspaceId).eq("active", true).order("code").limit(100),
      supabase.from("workspace_customers").select("id,name,address")
        .eq("workspace_id", workspaceId).order("name").limit(100),
    ]);
    if (branches.error || customers.error) throw new Error("Option read failed");
    return NextResponse.json({ generation, branches: branches.data ?? [], customers: customers.data ?? [] },
      { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Options unavailable" }, { status: 503 });
  }
}
