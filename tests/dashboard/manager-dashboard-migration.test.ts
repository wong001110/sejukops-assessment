import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL(
    "../../supabase/migrations/202608100007_manager_dashboard.sql",
    import.meta.url,
  )),
  "utf8",
);
const foundation = readFileSync(
  fileURLToPath(new URL(
    "../../supabase/migrations/202608100001_foundation.sql",
    import.meta.url,
  )),
  "utf8",
);

describe("Manager dashboard migration", () => {
  it("keeps the RPC service-role-only and verifies an active Manager actor", () => {
    expect(migration).toContain("security definer");
    expect(migration).toContain("p.role = 'MANAGER'");
    expect(migration).toContain("and p.active");
    expect(migration).toContain("revoke all on function public.manager_dashboard_metrics");
    expect(migration).toContain("from anon");
    expect(migration).toContain("from authenticated");
    expect(migration).toContain("grant execute on function public.manager_dashboard_metrics");
    expect(migration).toContain("to service_role");
  });

  it("uses MYT half-open natural periods and supports a verification-only clock", () => {
    expect(migration).toContain("p_as_of timestamptz default pg_catalog.now()");
    expect(migration).toContain("Asia/Kuala_Lumpur");
    expect(migration).toMatch(/completed_at >= v_current_start[\s\S]*completed_at < v_current_end/);
    expect(migration).toMatch(/created_at >= v_current_start[\s\S]*created_at < v_current_end/);
  });

  it("keeps zero buckets and includes a final partial monthly week", () => {
    expect(migration).toContain("v_current_end - interval '1 microsecond'");
    expect(migration).toContain("least(bucket_start + v_bucket_step, v_current_end)");
    expect(migration).toMatch(/left join \([\s\S]*service_reports sr[\s\S]*join public\.orders o/);
    expect(migration).not.toContain("where sr.id is null or o.id is not null");
  });

  it("counts canonical completed reports and all executed reschedule events", () => {
    expect(migration).toContain("o.status in ('JOB_DONE', 'REVIEWED', 'CLOSED')");
    expect(migration).toContain("from public.order_reschedules ors");
    expect(migration).not.toContain("from public.order_reschedule_requests");
    expect(migration).not.toMatch(/same_day\s*=\s*false/);
  });

  it("reuses the existing indexes for actual dashboard access paths", () => {
    expect(foundation).toContain(
      "create index service_reports_completed_at_idx on public.service_reports(completed_at)",
    );
    expect(foundation).toContain(
      "create index service_reports_technician_completed_idx on public.service_reports(technician_id, completed_at)",
    );
    expect(foundation).toContain(
      "create index order_reschedules_created_at_idx on public.order_reschedules(created_at)",
    );
  });
});

