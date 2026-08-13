import { z } from "zod";

import type { OrderStatus } from "@/domain/operations";

const requestKeySchema = z.string().uuid();

export const startTechnicianJobSchema = z.object({
  requestKey: requestKeySchema,
});

export const createTechnicianRescheduleRequestSchema = z.object({
  requestedSchedule: z.string().datetime({ offset: true }).optional(),
  reason: z.string().trim().min(1, "A reschedule reason is required").max(1000),
  requestKey: requestKeySchema,
});

export const technicianJobListQuerySchema = z.object({
  scope: z.enum(["active", "history"]).default("active"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(5).max(50).default(10),
});

export type StartTechnicianJobInput = z.infer<typeof startTechnicianJobSchema>;
export type CreateTechnicianRescheduleRequestInput = z.infer<
  typeof createTechnicianRescheduleRequestSchema
>;
export type TechnicianJobListQuery = z.infer<typeof technicianJobListQuerySchema>;

export type TechnicianPaginationMeta = Readonly<{
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}>;

export type TechnicianJobBranch = Readonly<{
  id: string;
  code: string;
  name: string;
}>;

export type TechnicianJobListItem = Readonly<{
  id: string;
  orderNo: string;
  status: Extract<OrderStatus, "ASSIGNED" | "IN_PROGRESS">;
  customerName: string;
  addressSummary: string;
  branch: TechnicianJobBranch;
  serviceType: string;
  quotedPrice: number;
  scheduledAt: string | null;
  createdAt: string;
}>;

export type TechnicianJobHistoryItem = Readonly<{
  id: string;
  orderNo: string;
  status: Extract<OrderStatus, "JOB_DONE" | "REVIEWED" | "CLOSED">;
  customerName: string;
  addressSummary: string;
  branch: TechnicianJobBranch;
  serviceType: string;
  quotedPrice: number;
  scheduledAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type TechnicianJobDetail = TechnicianJobListItem &
  Readonly<{
    customerPhone: string;
    customerAddress: string;
    problemDescription: string;
    adminNotes: string | null;
    updatedAt: string;
  }>;

export type TechnicianJobAuditEvent = Readonly<{
  id: string;
  eventType: string;
  actorName: string | null;
  metadata: Readonly<Record<string, unknown>>;
  createdAt: string;
}>;

export type TechnicianJobReschedule = Readonly<{
  id: string;
  previousSchedule: string | null;
  newSchedule: string;
  reason: string | null;
  source: "DIRECT_ADMIN" | "DIRECT_MANAGER" | "TECHNICIAN_REQUEST";
  sameDay: boolean;
  createdAt: string;
}>;

export type TechnicianRescheduleRequest = Readonly<{
  id: string;
  orderId: string;
  requestedSchedule: string | null;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  resolutionNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
}>;

export type TechnicianInternalNotification = Readonly<{
  id: string;
  title: string;
  message: string;
  status: "UNREAD" | "READ";
  createdAt: string;
  readAt: string | null;
}>;
