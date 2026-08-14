import { z } from "zod";

import { ORDER_STATUSES, type OrderStatus } from "@/domain/operations";

const uuid = z.string().uuid();
const requiredText = (label: string, maximum: number) =>
  z.string().trim().min(1, `${label} is required`).max(maximum);
const optionalText = (maximum: number) =>
  z.string().trim().max(maximum).optional().transform((value) => value || undefined);
const pageSchema = z.coerce.number().int().min(1).max(10_000).default(1);
const pageSizeSchema = z.coerce.number().int().min(5).max(100).default(8);

export const requestKeySchema = uuid;

export const customerInputSchema = z.object({
  id: uuid.optional(),
  name: requiredText("Customer name", 160),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9][0-9 -]{6,20}$/, "Enter a valid customer phone number"),
  address: requiredText("Customer address", 800),
});

export const createAdminOrderSchema = z.object({
  customer: customerInputSchema,
  branchId: uuid,
  technicianId: uuid.optional(),
  scheduledAt: z.string().datetime({ offset: true }).optional(),
  problemDescription: requiredText("Problem description", 4000),
  serviceType: requiredText("Service type", 120),
  quotedPrice: z
    .number()
    .finite()
    .min(0, "Quoted price cannot be negative")
    .max(9_999_999_999.99)
    .refine((value) => Number.isInteger(value * 100), "Use no more than two decimal places"),
  adminNotes: optionalText(4000),
  requestKey: requestKeySchema,
});

export const directRescheduleSchema = z.object({
  scheduledAt: z.string().datetime({ offset: true }),
  reason: optionalText(1000),
  requestKey: requestKeySchema,
});

export const resolveRescheduleRequestSchema = z
  .object({
    decision: z.enum(["APPROVE", "REJECT"]),
    resolutionNote: optionalText(1000),
    newSchedule: z.string().datetime({ offset: true }).optional(),
    requestKey: requestKeySchema,
  })
  .superRefine((value, context) => {
    if (value.decision === "REJECT" && value.newSchedule) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["newSchedule"],
        message: "A rejected request cannot execute a new schedule",
      });
    }
  });

export const adminOrderListQuerySchema = z.object({
  search: z.string().trim().max(160).optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  branchId: uuid.optional(),
  technicianId: uuid.optional(),
  page: pageSchema,
  pageSize: pageSizeSchema,
});

export const adminOrderFilterQuerySchema = z.object({
  kind: z.enum(["branches", "technicians", "statusSummary"]),
  q: z.string().trim().max(120).optional(),
  search: z.string().trim().max(160).optional(),
  branchId: uuid.optional(),
  technicianId: uuid.optional(),
  selectedId: uuid.optional(),
});

export type CreateAdminOrderInput = z.infer<typeof createAdminOrderSchema>;
export type DirectRescheduleInput = z.infer<typeof directRescheduleSchema>;
export type ResolveRescheduleRequestInput = z.infer<
  typeof resolveRescheduleRequestSchema
>;
export type AdminOrderListQuery = z.infer<typeof adminOrderListQuerySchema>;
export type AdminOrderFilterQuery = z.infer<typeof adminOrderFilterQuerySchema>;

export type PaginationMeta = Readonly<{
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}>;

export type AdminOrderStatusSummary = Readonly<{
  total: number;
  counts: Readonly<Record<OrderStatus, number>>;
}>;

export type AdminBranchOption = Readonly<{
  id: string;
  code: string;
  name: string;
}>;

export type AdminTechnicianOption = Readonly<{
  id: string;
  name: string;
  branchId: string;
  branchCode: string;
}>;

export type AdminOrderListItem = Readonly<{
  id: string;
  orderNo: string;
  status: OrderStatus;
  customerName: string;
  customerPhone: string;
  branch: AdminBranchOption;
  technician: AdminTechnicianOption | null;
  serviceType: string;
  quotedPrice: number;
  scheduledAt: string | null;
  createdAt: string;
}>;

export type AdminOrderDetail = AdminOrderListItem &
  Readonly<{
    customerId: string;
    customerAddress: string;
    problemDescription: string;
    adminNotes: string | null;
    updatedAt: string;
  }>;

export type AdminAuditEvent = Readonly<{
  id: string;
  eventType: string;
  actorProfileId: string | null;
  actorName: string | null;
  metadata: Readonly<Record<string, unknown>>;
  createdAt: string;
}>;

export type AdminReschedule = Readonly<{
  id: string;
  previousSchedule: string | null;
  newSchedule: string;
  reason: string | null;
  source: "DIRECT_ADMIN" | "DIRECT_MANAGER" | "TECHNICIAN_REQUEST";
  sourceRequestId: string | null;
  sameDay: boolean;
  createdAt: string;
}>;

export type AdminRescheduleRequest = Readonly<{
  id: string;
  orderId: string;
  requestedByProfileId: string;
  requestedByName: string;
  requestedSchedule: string | null;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  resolvedByProfileId: string | null;
  resolutionNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
}>;

export type OrderSubmissionSummary = Readonly<{
  orderNo: string;
  customerName: string;
  branchName: string;
  technicianName: string | null;
  scheduledAt: string | null;
  status: OrderStatus;
}>;
