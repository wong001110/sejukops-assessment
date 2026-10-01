import { z } from "zod";

export const STAFF_ROLES = ["ADMIN", "MANAGER", "TECHNICIAN"] as const;
export const STAFF_IMPORT_MAX_ROWS = 100;
export const STAFF_IMPORT_MAX_BYTES = 1024 * 1024;

const displayName = z.string().trim().min(1).max(100);
const email = z.string().trim().toLowerCase().email().max(254);
const branchCode = z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9_-]+$/);

/** Passwords are generated on the server; never accepted in an import row. */
export const staffAccountInputSchema = z.object({
  name: displayName,
  email,
  role: z.enum(STAFF_ROLES),
  branchCode: branchCode.nullable().optional().transform((value) => value ?? null),
}).strict().superRefine((value, context) => {
  if (value.role === "TECHNICIAN" && !value.branchCode) {
    context.addIssue({ code: "custom", path: ["branchCode"], message: "Technicians need a branch code." });
  }
  if (value.role !== "TECHNICIAN" && value.branchCode !== null) {
    context.addIssue({ code: "custom", path: ["branchCode"], message: "Only Technicians have a branch mapping." });
  }
});

export type StaffAccountInput = z.infer<typeof staffAccountInputSchema>;
export type StaffRole = StaffAccountInput["role"];
export type StaffImportRow = Readonly<{
  row: number;
  input: StaffAccountInput | null;
  errors: readonly string[];
}>;
export type StaffImportPreview = Readonly<{
  rows: readonly StaffImportRow[];
  validCount: number;
  invalidCount: number;
}>;
export type StaffAccountSummary = Readonly<{
  profileId: string;
  name: string;
  email: string;
  role: StaffRole;
  branchCode: string | null;
  active: boolean;
  passwordChangeRequired: boolean;
  authRevision: string;
}>;
export type StaffBranch = Readonly<{ code: string; name: string }>;
export type StaffAccountList = Readonly<{ accounts: readonly StaffAccountSummary[]; branches: readonly StaffBranch[] }>;
export type StaffCredential = Readonly<{ email: string; password: string }>;
export type StaffCreateResult = Readonly<{
  status: "CREATED" | "ALREADY_CREATED";
  account: StaffAccountSummary;
  credential: StaffCredential | null;
}>;
export type StaffImportDraft = StaffImportPreview & Readonly<{ importId: string; expiresAt: string }>;
export type StaffImportResult = StaffRowResult & Readonly<{ credential?: StaffCredential }>;
export type StaffRowResult = Readonly<{
  row: number;
  status: "CREATED" | "ALREADY_CREATED" | "FAILED";
  profileId?: string;
  error?: string;
}>;

export const staffPasswordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(12).max(128),
  confirmPassword: z.string().min(12).max(128),
}).strict().superRefine((value, context) => {
  if (value.newPassword !== value.confirmPassword) {
    context.addIssue({ code: "custom", path: ["confirmPassword"], message: "Passwords must match." });
  }
  if (value.newPassword === value.currentPassword) {
    context.addIssue({ code: "custom", path: ["newPassword"], message: "Choose a different password." });
  }
});
