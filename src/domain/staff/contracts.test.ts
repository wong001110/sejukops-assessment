import { describe, expect, it } from "vitest";
import { staffAccountInputSchema, staffPasswordChangeSchema } from "./contracts";

describe("staff account inputs", () => {
  it("canonicalizes identity and requires a Technician branch only", () => {
    expect(staffAccountInputSchema.parse({ name: " Demo Admin ", email: "ADMIN@EXAMPLE.TEST", role: "ADMIN" }))
      .toEqual({ name: "Demo Admin", email: "admin@example.test", role: "ADMIN", branchCode: null });
    expect(staffAccountInputSchema.safeParse({ name: "Demo Tech", email: "tech@example.test", role: "TECHNICIAN" }).success).toBe(false);
    expect(staffAccountInputSchema.safeParse({ name: "Demo Admin", email: "admin@example.test", role: "ADMIN", branchCode: "BRANCH" }).success).toBe(false);
  });
  it("rejects platform-role escalation and spreadsheet passwords", () => {
    const input = { name: "Demo Admin", email: "admin@example.test", role: "ADMIN" };
    expect(staffAccountInputSchema.safeParse({ ...input, role: "SUPER_ADMIN" }).success).toBe(false);
    expect(staffAccountInputSchema.safeParse({ ...input, password: "synthetic-password-canary" }).success).toBe(false);
  });
  it("requires a different confirmed strong password", () => {
    expect(staffPasswordChangeSchema.safeParse({ currentPassword: "old-password-demo", newPassword: "new-password-demo", confirmPassword: "new-password-demo" }).success).toBe(true);
    expect(staffPasswordChangeSchema.safeParse({ currentPassword: "old-password-demo", newPassword: "old-password-demo", confirmPassword: "old-password-demo" }).success).toBe(false);
    expect(staffPasswordChangeSchema.safeParse({ currentPassword: "old", newPassword: "short", confirmPassword: "short" }).success).toBe(false);
  });
});
