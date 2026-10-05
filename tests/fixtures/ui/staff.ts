import type { StaffAccountList, StaffAccountSummary, StaffImportRow } from "../../../src/domain/staff/contracts";

/** All values in this file are fictional browser-only fixtures. */
export const staffFixture: StaffAccountList = {
  branches: [{ code: "MOCK_NORTH", name: "Synthetic North workshop" }, { code: "MOCK_SOUTH", name: "Synthetic South workshop" }],
  accounts: [
    { profileId: "mock-admin", name: "Synthetic Alex", email: "alex@example.invalid", role: "ADMIN", branchCode: null, active: true, passwordChangeRequired: false, authRevision: "2026-10-01T00:00:00.000Z" },
    { profileId: "mock-technician", name: "Synthetic Technician with a deliberately long employee name for narrow layouts", email: "synthetic.technician.with.a.long.email@example.invalid", role: "TECHNICIAN", branchCode: "MOCK_NORTH", active: true, passwordChangeRequired: true, authRevision: "2026-10-01T00:00:00.000Z" },
    { profileId: "mock-disabled", name: "Synthetic Disabled Manager", email: "disabled@example.invalid", role: "MANAGER", branchCode: null, active: false, passwordChangeRequired: false, authRevision: "2026-10-01T00:00:00.000Z" },
  ],
};

export function mockStaffAccount(input: { name: string; email: string; role: StaffAccountSummary["role"]; branchCode: string | null }, sequence: number): StaffAccountSummary {
  return { ...input, profileId: `mock-created-${sequence}`, active: true, passwordChangeRequired: true, authRevision: `2026-10-01T00:00:${String(sequence).padStart(2, "0")}.000Z` };
}
export function mockStaffImportRows(count = 2): StaffImportRow[] {
  return Array.from({ length: count }, (_, index) => ({ row: index + 2, input: { name: `Synthetic Import Employee ${index + 1}`, email: `import-${index + 1}@example.invalid`, role: index % 2 ? "MANAGER" : "ADMIN", branchCode: null }, errors: [] }));
}
