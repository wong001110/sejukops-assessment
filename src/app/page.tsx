import Link from "next/link";

import { hasActorPermission } from "@/lib/auth/actor-policy";
import { getServerActorContext } from "@/lib/auth/server-actor";
import { malaysiaTimeZoneLabel } from "@/lib/time/malaysia";

export default async function Home() {
  const hasSupabaseConfig = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  const platformActor = hasSupabaseConfig
    ? await getServerActorContext().catch(() => null)
    : null;
  const canViewPlatform = Boolean(
    platformActor && hasActorPermission(platformActor, "diagnostics:view"),
  );

  return (
    <main className="landing">
      <section className="landing-hero">
        <h1>
          Sejuk<span className="brand-accent">Ops</span>
        </h1>
        <p>Workspace identity and operations are being rebuilt.</p>
        <Link className="landing-technical-review-link" href="/owner/login">
          Owner sign in →
        </Link>
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

      <section className="landing-technical-review" aria-label="Platform administration">
        <div>
          <h2>Platform administration</h2>
          <p>
            AI provider settings and technical observations require a platform
            Super Admin account.
          </p>
        </div>
        {canViewPlatform ? (
          <div>
            <Link className="landing-technical-review-link" href="/platform/ai-settings">
              Open AI settings →
            </Link>
            <Link className="landing-technical-review-link" href="/diagnostics/ai-observability">
              Open AI observability →
            </Link>
          </div>
        ) : (
          <span className="landing-technical-review-hint">
            Sign in as a platform Super Admin to manage these controls.
          </span>
        )}
      </section>

      {!hasSupabaseConfig && (
        <aside className="config-alert" role="status">
          <strong>Setup is incomplete.</strong> Supabase connection settings are
          not configured yet.
        </aside>
      )}
    </main>
  );
}
