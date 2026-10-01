import { z } from "zod";
import { STAFF_ROLES } from "./contracts";

export const ownerPreviewStatusSchema = z.object({
  previewId: z.string().uuid(),
  role: z.enum(STAFF_ROLES),
  effectiveEmployeeProfileId: z.string().uuid().nullable(),
  effectiveEmployeeName: z.string().min(1).max(100).nullable(),
  readOnly: z.literal(true),
}).strict().superRefine((value, context) => {
  if ((value.role === "TECHNICIAN") !== (value.effectiveEmployeeProfileId !== null)) {
    context.addIssue({ code: "custom", path: ["effectiveEmployeeProfileId"], message: "Technician preview requires an actual employee." });
  }
});
export const ownerPreviewOptionsSchema = z.object({ technicians: z.array(z.object({
  profileId: z.string().uuid(), name: z.string().min(1).max(100), branchCode: z.string().min(1).max(32),
}).strict()).max(1000) }).strict();
export const ownerPreviewInputSchema = z.object({
  workspaceId: z.string().uuid(), role: z.enum(STAFF_ROLES), employeeProfileId: z.string().uuid().nullable(),
}).strict().superRefine((value, context) => {
  if ((value.role === "TECHNICIAN") !== (value.employeeProfileId !== null)) {
    context.addIssue({ code: "custom", path: ["employeeProfileId"], message: "Choose an employee for Technician preview only." });
  }
});
export type OwnerPreviewStatus = z.infer<typeof ownerPreviewStatusSchema>;
export type OwnerPreviewOptions = z.infer<typeof ownerPreviewOptionsSchema>;
export type OwnerPreviewInput = z.infer<typeof ownerPreviewInputSchema>;
export type OwnerPreviewDisplay = Omit<OwnerPreviewStatus, "previewId">;
