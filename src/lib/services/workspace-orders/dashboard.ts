import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { hasActorPermission, type ActorContext } from "@/lib/auth/actor-policy";
import { dashboardActivitySchema, dashboardOrderSchema, dashboardPeriodSchema, type DashboardOrder, type DashboardPeriod } from "@/domain/operations-dashboard/contracts";
import { aggregateDashboard } from "@/domain/operations-dashboard/aggregate";
import { readWorkspaceGeneration } from "@/lib/services/workspaces/generation";
import { WorkspaceOrderAccessError } from "./listing";

const PROJECTION = "id,workspace_id,order_no,assigned_technician_id,service_type,status,scheduled_at,created_at";
const PAGE_SIZE = 1000;
const MAX_ORDERS = 50_000;

/** Complete role-visible reads, with explicit failure on truncation or reset. */
export async function readOperationsDashboard(actor: ActorContext, client: SupabaseClient, input: { workspaceId: string; period: DashboardPeriod }, guestProof: { visitId: string; tokenHash: string } | null = null) {
  const { workspaceId, period } = z.object({ workspaceId: z.string().uuid(), period: dashboardPeriodSchema }).strict().parse(input);
  if (actor.membership?.workspaceId !== workspaceId || !(
    hasActorPermission(actor, "order:view") || hasActorPermission(actor, "job:view_assigned"))) throw new WorkspaceOrderAccessError();
  const generation = await readWorkspaceGeneration(actor, client, workspaceId);
  const { data: activityData, error: activityError } = await client.rpc("workspace_dashboard_activity", {
    p_workspace_id: workspaceId, p_expected_generation: generation, p_period: period,
    p_guest_visit_id: guestProof?.visitId ?? null, p_guest_token_hash: guestProof?.tokenHash ?? null,
  });
  if (activityError) throw new Error("Dashboard activity unavailable");
  const activity = dashboardActivitySchema.parse(activityData);
  if (activity.generation !== generation) throw new Error("Dashboard generation changed");
  const now = new Date(activity.asOf);
  let technicianId: string | undefined;
  if (actor.membership.role === "TECHNICIAN") {
    const profileId = actor.preview ? actor.preview.effectiveEmployeeProfileId : actor.profileId;
    if (!profileId) return aggregateDashboard([], { workspaceId, period, generation, role: actor.membership.role, now, activity });
    const { data, error } = await client.from("workspace_technicians").select("id,branch_id").eq("workspace_id", workspaceId)
      .eq("profile_id", profileId).eq("active", true).maybeSingle();
    if (error) throw new Error("Dashboard mapping unavailable");
    if (!data) return aggregateDashboard([], { workspaceId, period, generation, role: actor.membership.role, now, activity });
    technicianId = z.string().uuid().parse(data.id);
    const branchId = z.string().uuid().parse(data.branch_id);
    const { data: branch, error: branchError } = await client.from("workspace_branches").select("id")
      .eq("workspace_id", workspaceId).eq("id", branchId).eq("active", true).maybeSingle();
    if (branchError) throw new Error("Dashboard branch unavailable");
    if (!branch) return aggregateDashboard([], { workspaceId, period, generation, role: actor.membership.role, now, activity });
  }
  const orders: DashboardOrder[] = [];
  const seen = new Set<string>();
  let total: number | null = null;
  while (total === null || orders.length < total) {
    let query = client.from("workspace_orders").select(PROJECTION, { count: "exact" }).eq("workspace_id", workspaceId);
    if (technicianId) query = query.eq("assigned_technician_id", technicianId);
    const { data, error, count } = await query.order("id", { ascending: true }).range(orders.length, orders.length + PAGE_SIZE - 1);
    if (error || !Array.isArray(data) || !Number.isSafeInteger(count) || count === null || count < 0 || count > MAX_ORDERS ||
      (total !== null && count !== total)) throw new Error("Complete dashboard data unavailable");
    total = count;
    if (!data.length && orders.length < total) throw new Error("Incomplete dashboard data");
    for (const item of data) {
      const row = dashboardOrderSchema.parse(item);
      if (row.workspace_id !== workspaceId || (technicianId && row.assigned_technician_id !== technicianId) || seen.has(row.id)) throw new Error("Dashboard scope changed");
      seen.add(row.id); orders.push(row);
    }
    if (orders.length > total) throw new Error("Dashboard count changed");
  }
  if (await readWorkspaceGeneration(actor, client, workspaceId) !== generation) throw new Error("Dashboard generation changed");
  return aggregateDashboard(orders, { workspaceId, period, generation, role: actor.membership.role, now, activity });
}
