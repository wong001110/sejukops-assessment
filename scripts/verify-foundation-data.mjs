import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationPath = new URL(
  "../supabase/migrations/202608100001_foundation.sql",
  import.meta.url,
);
const seedPath = new URL("../supabase/seed.sql", import.meta.url);
const clientPaths = [
  new URL("../src/lib/supabase/browser.ts", import.meta.url),
  new URL("../src/lib/supabase/server.ts", import.meta.url),
];

const [migration, seed, ...clients] = await Promise.all([
  readFile(migrationPath, "utf8"),
  readFile(seedPath, "utf8"),
  ...clientPaths.map((path) => readFile(path, "utf8")),
]);

for (const table of [
  "branches",
  "profiles",
  "technicians",
  "customers",
  "orders",
  "order_reschedule_requests",
  "order_reschedules",
  "service_reports",
  "service_attachments",
  "notifications",
  "audit_logs",
]) {
  assert.match(migration, new RegExp(`create table public\\.${table} \\(`));
}

assert.match(migration, /technicians[\s\S]*branch_id uuid not null references public\.branches/);
assert.match(migration, /orders[\s\S]*branch_id uuid not null references public\.branches/);
assert.match(migration, /service_reports[\s\S]*order_id uuid not null unique/);
assert.match(migration, /final_amount numeric\(12, 2\) generated always/);
assert.match(migration, /Asia\/Kuala_Lumpur/);
assert.match(migration, /create type public\.notification_status as enum \('READY', 'OPENED'\)/);
assert.match(migration, /unique \(order_id, channel, business_key\)/);
assert.match(migration, /service_attachments_enforce_limits/);
assert.match(migration, /at most 6 evidence files/);
assert.match(migration, /120 MB combined limit/);
assert.match(migration, /enable row level security/g);
assert.match(migration, /create policy orders_update_admin[\s\S]*current_actor_role\(\) = 'ADMIN'/);
assert.doesNotMatch(migration, /create policy orders_update_office/);

for (const code of ["BR-01", "BR-02", "BR-03", "BR-04", "BR-05"]) {
  assert.match(seed, new RegExp(`'${code}'`));
}

for (const name of ["Admin Demo", "Manager Demo", "Ali", "John", "Bala", "Yusoff"]) {
  assert.match(seed, new RegExp(`'${name}'`));
}

const orderDefinition = seed.match(/from \(values([\s\S]*?)\) as seeded\(/)?.[1];
assert.ok(orderDefinition, "seed order VALUES block should be discoverable");
const orderNumbers = [...orderDefinition.matchAll(/'ORD-2026-(\d{4})'/g)].map(
  ([match]) => match,
);
assert.equal(orderNumbers.length, 40, "seed should define exactly 40 orders");
assert.equal(new Set(orderNumbers).size, 40, "seed order numbers must be unique");

const orderRows = orderDefinition
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.startsWith("(") && line.includes("'ORD-2026-"));
for (const row of orderRows) {
  const valuesOnly = row.replace(/^\(/, "").replace(/\),?$/, "");
  assert.equal(
    valuesOnly.split(",").length,
    12,
    `every seeded order row must match the 12-column VALUES alias: ${row}`,
  );
}

for (const orderNo of ["ORD-2026-0012", "ORD-2026-0017", "ORD-2026-0020"]) {
  assert.match(orderDefinition, new RegExp(`'${orderNo}'[^\\n]*Golden Ali last-week fixture`));
}

assert.match(seed, /current_setting\('sejukops\.seed_reference_now', true\)/);
assert.match(seed, /2026-08-14T12:00:00\+08:00/);
assert.match(seed, /delete from public\.orders[\s\S]*0000000040%/);
assert.match(seed, /on conflict \(order_id\) do update/);
assert.match(seed, /on conflict \(order_id, channel, business_key\) do update/);
assert.match(seed, /source = excluded\.source/);

for (const client of clients) {
  assert.doesNotMatch(client, /SERVICE_ROLE/i);
  assert.match(client, /anonKey/);
}

console.log("Foundation data static verification passed.");
