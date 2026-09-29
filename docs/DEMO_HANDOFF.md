# Demo and local development handoff

This guide describes the current rebuild branch against the **already prepared** Supabase `Test` project (`qobhjvrrpajoyvlgrkbx`). It is not a verified guide for creating a new Supabase project. [PROJECT_STATE.md](../PROJECT_STATE.md) is the current evidence record.

## Run the prepared Test environment

1. Use Node.js 20.9+ and pnpm 10.6.2. Run `pnpm install` in the repository.
2. Create a local `.env` from [.env.example](../.env.example). Set the public Supabase URL and anon key for the confirmed Test project, plus the server-only service role key. Set the AI configuration encryption and unlock secrets if using platform AI settings. Keep the real file and secret values out of Git and screenshots.
3. Run `pnpm dev` and open the printed local URL. The configured `NEXT_PUBLIC_APP_URL`, if set, must match the origin used for same-origin write requests.
4. Open `/demo`, choose **Continue as Guest**, and switch Admin, Manager, and Technician perspectives inside the Demo workspace. Demo operations use shared fictional records; ordinary browsing and manual changes do not consume the AI allowance.
5. Open `/owner/login` for the permanent Owner account. After sign-in, `/owner` links to AI settings, technical observations, and Demo management. Owner sign-in has not yet passed a real browser check; do not infer it from account creation.

The prepared Test project has one Demo workspace with four starter orders and one Owner workspace with no orders at the latest readback. Three server-only Demo principals supply role checks; a Guest never receives their credentials or an individual Supabase Auth account. The one-shot scripts [p1-create-demo-principals.mjs](../scripts/p1-create-demo-principals.mjs) and [p1-create-owner.mjs](../scripts/p1-create-owner.mjs) were already run for Test. Do not rerun them on that prepared project: both refuse an existing identity. They are intentionally pinned to this Test project and are not general bootstrap commands.

## Demo operations

- `/platform/ai-settings` shows the shared Guest paid-AI allowance and provider routing to a verified Super Admin. The allowance defaults to 20 paid model calls per Malaysia day; the current limit is read from Test. Normal Demo reads and writes are not quota-limited. Add or replace provider credentials only through the protected UI. A paid Guest provider call has not been verified.
- `/platform/demo` shows the current Demo generation and order count. A verified platform actor must type `RESET DEMO` and confirm again to call the Demo-only reset. The server submits the observed generation, rechecks platform authority, and the database rejects stale generation. Reset replaces shared Demo operational records with the fictional starter set and invalidates existing Guest visits. It does not reset Owner records or the daily AI allowance. The new UI has focused local tests; an authenticated browser reset has not been run.
- Guest data is shared and resettable. Use fictional inputs only. The existing Test Demo was not reset to verify this guide; earlier reset behavior and exact cleanup evidence are in the project state.

## Fresh installation boundary

The repository still contains the assessment-era migrations followed by rebuild migrations. The final old-schema retirement migration is guarded by the **exact inventory reviewed for Test** (253 old-table rows and specified audit counts), and the one-shot identity scripts are pinned to Test. Therefore running the migration directory and these scripts against an empty project is **not** a supported or verified clean setup. A portable baseline/migration path and a separate fresh-project verification remain required for `CLEAN-01`. Do not modify the applied Test cleanup migration or bypass its inventory guard merely to make a new installation pass.

Local typecheck, lint, tests, and build cover code behavior; they do not prove paid provider calls, permanent Owner sign-in, external MCP-host confirmed writes, accessibility, or Human UAT. The exact current results and pending gates are in [PROJECT_STATE.md](../PROJECT_STATE.md).
