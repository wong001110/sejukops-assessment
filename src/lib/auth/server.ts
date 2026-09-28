import { redirect } from "next/navigation";
import type { AppRole, DemoIdentity } from "./types";

export async function getCurrentDemoIdentity(): Promise<DemoIdentity | undefined> {
  // The assessment-era selectable cookie is retired. Real Demo Auth is gated
  // on workspace-scoped services and provisioning; no cookie grants a role.
  return undefined;
}

export async function requireRole(role: AppRole): Promise<DemoIdentity> {
  const identity = await getCurrentDemoIdentity();
  if (!identity) redirect("/");
  if (identity.role !== role) redirect("/access-denied");
  return identity;
}
