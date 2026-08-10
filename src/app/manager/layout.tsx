import { DesktopShell } from "@/components/desktop-shell";
import { ManagerQueryProvider } from "@/components/manager/manager-query-provider";
import { requireRole } from "@/lib/auth/server";
export default async function ManagerLayout({ children }: { children: React.ReactNode }) { const identity = await requireRole("MANAGER"); return <ManagerQueryProvider><DesktopShell role="MANAGER" identityId={identity.id}>{children}</DesktopShell></ManagerQueryProvider>; }
