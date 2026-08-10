import { DesktopShell } from "@/components/desktop-shell";
import { requireRole } from "@/lib/auth/server";
export default async function AdminLayout({ children }: { children: React.ReactNode }) { const identity = await requireRole("ADMIN"); return <DesktopShell role="ADMIN" identityId={identity.id}>{children}</DesktopShell>; }
