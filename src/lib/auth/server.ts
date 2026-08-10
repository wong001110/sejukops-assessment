import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEMO_IDENTITY_COOKIE, getDemoIdentity } from "./demo-identities";
import type { AppRole, DemoIdentity } from "./types";

export async function getCurrentDemoIdentity(): Promise<DemoIdentity | undefined> {
  const store = await cookies();
  return getDemoIdentity(store.get(DEMO_IDENTITY_COOKIE)?.value);
}

export async function requireRole(role: AppRole): Promise<DemoIdentity> {
  const identity = await getCurrentDemoIdentity();
  if (!identity) redirect("/");
  if (identity.role !== role) redirect("/access-denied");
  return identity;
}
