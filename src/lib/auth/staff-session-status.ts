import { z } from "zod";

/** Authority comes from a caller-authenticated DB RPC, never user metadata. */
export const staffSessionStatusSchema = z.object({
  isManaged: z.boolean(),
  passwordChangeRequired: z.boolean(),
  sessionAllowed: z.boolean(),
  authRevision: z.string().uuid().nullable(),
  sessionId: z.string().uuid().nullable(),
}).strict().superRefine((value, context) => {
  if (value.isManaged && (!value.authRevision || !value.sessionId)) {
    context.addIssue({ code: "custom", message: "Managed staff session proof is incomplete." });
  }
});

export type StaffSessionStatus = z.infer<typeof staffSessionStatusSchema>;

export function isStaffBusinessReady(status: StaffSessionStatus): boolean {
  return status.sessionAllowed && !status.passwordChangeRequired;
}
