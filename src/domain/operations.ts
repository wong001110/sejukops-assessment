export const APP_ROLES = ["ADMIN", "TECHNICIAN", "MANAGER"] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const ORDER_STATUSES = [
  "NEW",
  "ASSIGNED",
  "IN_PROGRESS",
  "JOB_DONE",
  "REVIEWED",
  "CLOSED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_TRANSITIONS = {
  NEW: ["ASSIGNED"],
  ASSIGNED: ["IN_PROGRESS"],
  IN_PROGRESS: ["JOB_DONE"],
  JOB_DONE: ["REVIEWED", "IN_PROGRESS"],
  REVIEWED: ["CLOSED"],
  CLOSED: [],
} as const satisfies Record<OrderStatus, readonly OrderStatus[]>;

export const RESCHEDULE_REQUEST_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
] as const;
export type RescheduleRequestStatus =
  (typeof RESCHEDULE_REQUEST_STATUSES)[number];

export const RESCHEDULE_SOURCES = [
  "DIRECT_ADMIN",
  "DIRECT_MANAGER",
  "TECHNICIAN_REQUEST",
] as const;
export type RescheduleSource = (typeof RESCHEDULE_SOURCES)[number];

// A deep link proves only preparation/opening, never delivery or reading.
export const CUSTOMER_NOTIFICATION_STATUSES = ["READY", "OPENED"] as const;
export type CustomerNotificationStatus =
  (typeof CUSTOMER_NOTIFICATION_STATUSES)[number];

export const SERVICE_EVIDENCE_POLICY = {
  bucket: "service-evidence",
  maximumFileCount: 6,
  maximumTotalBytes: 120 * 1024 * 1024,
  mimeMaximumBytes: {
    "image/jpeg": 12 * 1024 * 1024,
    "image/png": 12 * 1024 * 1024,
    "image/webp": 12 * 1024 * 1024,
    "video/mp4": 75 * 1024 * 1024,
    "video/quicktime": 75 * 1024 * 1024,
    "video/webm": 75 * 1024 * 1024,
    "application/pdf": 15 * 1024 * 1024,
  },
} as const;

export function isAllowedOrderTransition(
  from: OrderStatus,
  to: OrderStatus,
): boolean {
  return (ORDER_STATUS_TRANSITIONS[from] as readonly OrderStatus[]).includes(to);
}
