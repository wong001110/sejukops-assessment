import { TechnicianShell } from "@/components/technician-shell";
import { requireRole } from "@/lib/auth/server";
export default async function TechnicianLayout({ children }: { children: React.ReactNode }) { const identity = await requireRole("TECHNICIAN"); return <TechnicianShell identityId={identity.id} name={identity.name}>{children}</TechnicianShell>; }
