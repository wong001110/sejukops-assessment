import Link from "next/link";

import { RoleSwitcher } from "@/components/role-switcher";
import { getCurrentDemoIdentity } from "@/lib/auth/server";
import { malaysiaTimeZoneLabel } from "@/lib/time/malaysia";

export default async function Home() {
  const current = await getCurrentDemoIdentity();
  const hasSupabaseConfig = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  const canViewDiagnostics =
    current?.role === "ADMIN" || current?.role === "MANAGER";

  return (
    <main className="landing">
      <section className="landing-hero">
        <h1>
          Sejuk<span className="brand-accent">Ops</span>
        </h1>
        <p>One workspace for service operations, field teams, and reviews.</p>
        <RoleSwitcher currentIdentityId={current?.id} />
        <p className="timezone-copy">
          All schedules are presented in {malaysiaTimeZoneLabel()}.
        </p>
      </section>

      <section className="portal-cards">
        <article>
          <h2>Admin</h2>
          <p>Create, assign and coordinate service work.</p>
        </article>
        <article>
          <h2>Technician</h2>
          <p>A mobile-first field workspace for assigned jobs.</p>
        </article>
        <article>
          <h2>Manager</h2>
          <p>Review completed work and operational performance.</p>
        </article>
      </section>

      <section className="landing-technical-review" aria-label="Technical review">
        <div>
          <h2>Technical review</h2>
          <p>
            AI observability is assessment tooling, not a fourth business role.
            It shows centralized execution traces for the implemented AI features.
          </p>
        </div>
        {canViewDiagnostics ? (
          <Link
            className="landing-technical-review-link"
            href="/diagnostics/ai-observability"
          >
            Open AI observability →
          </Link>
        ) : (
          <span className="landing-technical-review-hint">
            Select an Admin or Manager demo session to inspect traces.
          </span>
        )}
      </section>

      {!hasSupabaseConfig && (
        <aside className="config-alert" role="status">
          <strong>Demo mode is active.</strong> Supabase connection settings are
          not configured yet. Portal foundations remain available; live data
          integration is pending environment configuration.
        </aside>
      )}
    </main>
  );
}
