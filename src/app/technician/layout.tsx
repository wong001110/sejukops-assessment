import { TechnicianShell } from "@/components/technician-shell";
import { requireRole } from "@/lib/auth/server";
import { Suspense } from "react";
export default async function TechnicianLayout({ children }: { children: React.ReactNode }) { const identity = await requireRole("TECHNICIAN"); return <Suspense><TechnicianShell identityId={identity.id}>{children}</TechnicianShell></Suspense>; }
