import { TechnicianPlaceholder } from "@/components/technician/placeholder";
import { JobWorkspace } from "@/components/technician/job-workspace";

export default async function TechnicianPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  if (tab === "history") return <TechnicianPlaceholder title="Job history" description="Your completed service history will appear here once completion reporting is available." />;
  if (tab === "profile") return <TechnicianPlaceholder title="Profile" description="Your field profile and preferences will be available in a later workflow step." />;
  return <JobWorkspace />;
}
