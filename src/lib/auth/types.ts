export type AppRole = "ADMIN" | "TECHNICIAN" | "MANAGER";

export type DemoIdentity = {
  id: string;
  profileId: string;
  name: string;
  role: AppRole;
  label: string;
  primaryBranch?: string;
};
