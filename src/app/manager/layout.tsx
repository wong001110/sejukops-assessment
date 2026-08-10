import { DesktopShell } from "@/components/desktop-shell";
import { requireRole } from "@/lib/auth/server";
export default async function ManagerLayout({ children }: { children: React.ReactNode }) { const identity = await requireRole("MANAGER"); return <DesktopShell role="MANAGER" identityId={identity.id}>{children}</DesktopShell>; }
