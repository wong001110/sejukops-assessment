import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { hasActorPermission, type ActorContext } from "@/lib/auth/actor-policy";
import { createWorkspaceOrder, WorkspaceOrderCommandError } from "@/lib/services/workspace-orders/commands";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type IntakeCustomer =
  | { mode: "EXISTING"; customerId: string }
  | { mode: "NEW"; name: string; phone: string | null; address: string };
export type ConfirmWorkspaceOrderIntakeInput = Readonly<{
  workspaceId: string;
  expectedGeneration: number;
  orderNo: string;
  branchId: string;
  customer: IntakeCustomer;
  problemDescription: string;
  serviceType: string;
}>;

function validText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maximum;
}

/** Explicit confirmation; a new customer and order commit atomically in one RPC. */
export async function confirmWorkspaceOrderIntake(
  actor: ActorContext,
  supabase: SupabaseClient,
  input: ConfirmWorkspaceOrderIntakeInput,
) {
  if (!UUID.test(input.workspaceId) || actor.membership?.workspaceId !== input.workspaceId ||
      actor.membership.role !== "ADMIN" || !hasActorPermission(actor, "order:create")) {
    throw new WorkspaceOrderCommandError("FORBIDDEN");
  }
  if (!Number.isSafeInteger(input.expectedGeneration) || input.expectedGeneration < 1 ||
      !UUID.test(input.branchId) || !validText(input.orderNo, 80) ||
      !validText(input.problemDescription, 4000) || !validText(input.serviceType, 120)) {
    throw new WorkspaceOrderCommandError("INVALID_INPUT");
  }

  if (input.customer.mode === "EXISTING") {
    return createWorkspaceOrder(actor, supabase, {
      workspaceId: input.workspaceId,
      expectedGeneration: input.expectedGeneration,
      orderNo: input.orderNo,
      branchId: input.branchId,
      customerId: input.customer.customerId,
      problemDescription: input.problemDescription,
      serviceType: input.serviceType,
    });
  }
  if (!validText(input.customer.name, 160) ||
      !validText(input.customer.address, 800) ||
      (input.customer.phone !== null &&
       !/^\+?[0-9][0-9 -]{6,20}$/.test(input.customer.phone))) {
    throw new WorkspaceOrderCommandError("INVALID_INPUT");
  }
  const { data, error } = await supabase.rpc("workspace_order_create_with_customer", {
    p_workspace_id: input.workspaceId,
    p_expected_generation: input.expectedGeneration,
    p_order_no: input.orderNo.trim(),
    p_branch_id: input.branchId,
    p_customer_name: input.customer.name.trim(),
    p_customer_phone: input.customer.phone,
    p_customer_address: input.customer.address.trim(),
    p_problem_description: input.problemDescription.trim(),
    p_service_type: input.serviceType.trim(),
    p_guest_visit_id: null,
    p_guest_token_hash: null,
  });
  if (error || !data) throw new WorkspaceOrderCommandError("COMMAND_FAILED");
  return data;
}
