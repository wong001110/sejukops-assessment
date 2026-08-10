import { RoleSwitcher } from "@/components/role-switcher";
import { getCurrentDemoIdentity } from "@/lib/auth/server";
import { malaysiaTimeZoneLabel } from "@/lib/time/malaysia";

export default async function Home() {
  const current = await getCurrentDemoIdentity();
  const hasSupabaseConfig = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  return <main className="landing"><section className="landing-hero"><h1>Sejuk<span className="brand-accent">Ops</span></h1><p>One workspace for service operations, field teams, and reviews.</p><RoleSwitcher currentIdentityId={current?.id} /><p className="timezone-copy">All schedules are presented in {malaysiaTimeZoneLabel()}.</p></section><section className="portal-cards"><article><h2>Admin</h2><p>Create, assign and coordinate service work.</p></article><article><h2>Technician</h2><p>A mobile-first field workspace for assigned jobs.</p></article><article><h2>Manager</h2><p>Review completed work and operational performance.</p></article></section>{!hasSupabaseConfig && <aside className="config-alert" role="status"><strong>Demo mode is active.</strong> Supabase connection settings are not configured yet. Portal foundations remain available; live data integration is pending environment configuration.</aside>}</main>;
}
