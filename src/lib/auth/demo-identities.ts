import type { AppRole, DemoIdentity } from "./types";

export const DEMO_IDENTITIES: readonly DemoIdentity[] = [
  { id: "admin-demo", profileId: "00000000-0000-4000-8000-000000001001", name: "Admin Demo", role: "ADMIN", label: "Admin" },
  { id: "manager-demo", profileId: "00000000-0000-4000-8000-000000001002", name: "Manager Demo", role: "MANAGER", label: "Manager" },
  { id: "tech-ali", profileId: "00000000-0000-4000-8000-000000001003", name: "Ali", role: "TECHNICIAN", label: "Technician · BR-01", primaryBranch: "BR-01" },
  { id: "tech-john", profileId: "00000000-0000-4000-8000-000000001004", name: "John", role: "TECHNICIAN", label: "Technician · BR-02", primaryBranch: "BR-02" },
  { id: "tech-bala", profileId: "00000000-0000-4000-8000-000000001005", name: "Bala", role: "TECHNICIAN", label: "Technician · BR-03", primaryBranch: "BR-03" },
  { id: "tech-yusoff", profileId: "00000000-0000-4000-8000-000000001006", name: "Yusoff", role: "TECHNICIAN", label: "Technician · BR-04", primaryBranch: "BR-04" },
];

export const DEMO_IDENTITY_COOKIE = "sejukops_demo_identity";

export function getDemoIdentity(id: string | undefined): DemoIdentity | undefined {
  return DEMO_IDENTITIES.find((identity) => identity.id === id);
}

export function portalPathForRole(role: AppRole): "/admin" | "/technician" | "/manager" {
  if (role === "ADMIN") return "/admin";
  if (role === "MANAGER") return "/manager";
  return "/technician";
}
