import "server-only";

import type { AppPermission } from "@/lib/auth/permissions";
import { createAuthorizedDataContext } from "@/lib/supabase/privileged-server";
import type {
  WhatsAppNotification,
  WhatsAppOpenInput,
} from "@/domain/manager-review/contracts";
import { ManagerReviewError } from "@/domain/manager-review/errors";

import {
  completionNotificationAdapter,
  type CompletionNotificationRecord,
} from "./whatsapp-adapter";

type DataRecord = Record<string, unknown>;
type NotificationRole = "ADMIN" | "MANAGER" | "TECHNICIAN";

function asRecord(value: unknown): DataRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ManagerReviewError(
      "MANAGER_REVIEW_DATA_ACCESS_FAILED",
      "Notification data could not be read.",
      503,
    );
  }
  return value as DataRecord;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : text(value);
}

function rpcRow(value: unknown): DataRecord {
  if (Array.isArray(value)) {
    if (!value[0]) return throwNotificationDataError(null);
    return asRecord(value[0]);
  }
  return asRecord(value);
}

function throwNotificationDataError(
  error: { message: string; code?: string } | null,
): never {
  const message = error?.message ?? "Unknown notification error";
  if (
    message.includes("IDEMPOTENCY_KEY_CONFLICT") ||
    message.includes("COMPLETION_NOTIFICATION_NOT_READY") ||
    message.includes("NOTIFICATION_NOT_CURRENT")
  ) {
    throw new ManagerReviewError(
      "MANAGER_REVIEW_CONFLICT",
      "The completion notification is not ready for this job.",
      409,
    );
  }
  if (
    message.includes("INVALID_NOTIFICATION_ACTOR") ||
    message.includes("NOTIFICATION_SCOPE_DENIED")
  ) {
    throw new ManagerReviewError(
      "MANAGER_REVIEW_PERMISSION_DENIED",
      "You cannot access this completion notification.",
      403,
    );
  }
  if (message.includes("INVALID_WHATSAPP_RECIPIENT")) {
    throw new ManagerReviewError(
      "MANAGER_REVIEW_VALIDATION_FAILED",
      "The customer phone number cannot be used for a WhatsApp action. Update it before retrying.",
      400,
    );
  }
  if (
    error?.code === "PGRST116" ||
    message.includes("ORDER_NOT_FOUND") ||
    message.includes("NOTIFICATION_NOT_FOUND")
  ) {
    throw new ManagerReviewError(
      "MANAGER_REVIEW_NOT_FOUND",
      "The completion notification was not found.",
      404,
    );
  }
  throw new ManagerReviewError(
    "MANAGER_REVIEW_DATA_ACCESS_FAILED",
    "The completion notification is temporarily unavailable.",
    503,
    { cause: error ?? undefined },
  );
}

function mapRecord(value: unknown): CompletionNotificationRecord {
  const row = asRecord(value);
  return {
    id: text(row.notification_id ?? row.id),
    orderId: text(row.order_id),
    recipient: text(row.recipient),
    message: text(row.message),
    status: text(row.notification_status ?? row.status) as "READY" | "OPENED",
    generatedAt: text(row.generated_at),
    openedAt: nullableText(row.opened_at),
  };
}

function mapNotification(value: unknown): WhatsAppNotification {
  try {
    return completionNotificationAdapter.toNotification(mapRecord(value));
  } catch (error) {
    throw new ManagerReviewError(
      "MANAGER_REVIEW_DATA_ACCESS_FAILED",
      "The customer phone number cannot be used for a WhatsApp action.",
      503,
      { cause: error },
    );
  }
}

async function createNotificationContext(
  permission: AppPermission,
  allowedRoles: readonly NotificationRole[],
) {
  const context = await createAuthorizedDataContext(permission);
  if (!allowedRoles.includes(context.identity.role)) {
    throw new ManagerReviewError(
      "MANAGER_REVIEW_PERMISSION_DENIED",
      "This notification action is not available to the current role.",
      403,
    );
  }
  const { data: profile, error } = await context.supabase
    .from("profiles")
    .select("id,role,active")
    .eq("id", context.identity.profileId)
    .eq("role", context.identity.role)
    .eq("active", true)
    .maybeSingle();
  if (error) throwNotificationDataError(error);
  if (!profile) {
    throw new ManagerReviewError(
      "MANAGER_REVIEW_PERMISSION_DENIED",
      "The current profile is inactive or unavailable.",
      403,
    );
  }
  return context;
}

export async function prepareCompletionWhatsApp(
  orderId: string,
  permission: AppPermission,
  allowedRoles: readonly NotificationRole[],
): Promise<WhatsAppNotification> {
  const context = await createNotificationContext(permission, allowedRoles);
  const { data, error } = await context.supabase.rpc("prepare_completion_whatsapp", {
    p_actor_profile_id: context.identity.profileId,
    p_order_id: orderId,
  });
  if (error) throwNotificationDataError(error);
  return mapNotification(rpcRow(data));
}

export async function getCompletionWhatsApp(
  orderId: string,
  permission: AppPermission,
  allowedRoles: readonly NotificationRole[],
): Promise<WhatsAppNotification | null> {
  const context = await createNotificationContext(permission, allowedRoles);

  // The privileged client is always paired with explicit application and
  // record-scope checks because assessment auth does not produce a Supabase JWT.
  if (context.identity.role === "TECHNICIAN") {
    const { data: technician, error: technicianError } = await context.supabase
      .from("technicians")
      .select("id")
      .eq("profile_id", context.identity.profileId)
      .eq("active", true)
      .maybeSingle();
    if (technicianError) throwNotificationDataError(technicianError);
    const technicianId = technician ? text(asRecord(technician).id) : "";
    const { data: order, error: orderError } = await context.supabase
      .from("orders")
      .select("id")
      .eq("id", orderId)
      .eq("assigned_technician_id", technicianId)
      .maybeSingle();
    if (orderError) throwNotificationDataError(orderError);
    if (!order) {
      throw new ManagerReviewError(
        "MANAGER_REVIEW_PERMISSION_DENIED",
        "This job is not assigned to the current Technician.",
        403,
      );
    }
  }

  const { data, error } = await context.supabase
    .from("notifications")
    .select("id,order_id,recipient,message,status,generated_at,opened_at")
    .eq("order_id", orderId)
    .eq("channel", "WHATSAPP")
    .like("business_key", "completion:%")
    .order("generated_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throwNotificationDataError(error);
  return data ? mapNotification(data) : null;
}

export async function openCompletionWhatsApp(
  orderId: string,
  input: WhatsAppOpenInput,
  permission: AppPermission,
  allowedRoles: readonly NotificationRole[],
): Promise<WhatsAppNotification> {
  const context = await createNotificationContext(permission, allowedRoles);

  // A missing record means the post-completion secondary side effect failed.
  // The user-click POST doubles as the explicit, duplicate-safe manual retry.
  const { data: preparedData, error: prepareError } = await context.supabase.rpc(
    "prepare_completion_whatsapp",
    {
      p_actor_profile_id: context.identity.profileId,
      p_order_id: orderId,
    },
  );
  if (prepareError) throwNotificationDataError(prepareError);
  const prepared = mapRecord(rpcRow(preparedData));
  // Validate the usable deep link before recording the observable OPENED state.
  completionNotificationAdapter.toNotification(prepared);

  const { data, error } = await context.supabase.rpc("open_completion_whatsapp", {
    p_actor_profile_id: context.identity.profileId,
    p_order_id: orderId,
    p_notification_id: prepared.id,
    p_request_key: input.requestKey,
  });
  if (error) throwNotificationDataError(error);
  return mapNotification(rpcRow(data));
}
