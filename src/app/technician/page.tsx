import { JobWorkspace } from "@/components/technician/job-workspace";
import { TechnicianHistory } from "@/components/technician/history";
import { TechnicianProfile } from "@/components/technician/profile";
import { requireRole } from "@/lib/auth/server";

export default async function TechnicianPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  if (tab === "history") return <TechnicianHistory />;
  if (tab === "profile") {
    const identity = await requireRole("TECHNICIAN");
    return <TechnicianProfile name={identity.name} branch={identity.primaryBranch ?? "Not assigned"} />;
  }
  return <JobWorkspace />;
}
