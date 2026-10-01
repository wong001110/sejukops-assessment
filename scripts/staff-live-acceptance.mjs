// One human-authorized Test batch. Main must review this runner before execution.
// No video, traces, HAR, Auth snapshots, password screenshots or secret files.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { TEST_REF, id, literal, sql, baselineSql, newLedger, persistLedger, ledgerPath, setupSql, reconcileSql, cleanupSql, validateLedger } from "./staff-live-fixtures.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const origin = "http://127.0.0.1:3000";
const usage = "node scripts/staff-live-acceptance.mjs --allow-live --project-ref qobhjvrrpajoyvlgrkbx --allow-temporary-owner --reviewed-commit <reviewed-commit> [--cleanup-ledger .agent/staff-live-UUID.local.json | --reuse-cleaned-owner .agent/staff-live-UUID.local.json]";
const option = (name) => args[args.indexOf(name) + 1];
const check = (condition, label) => { if (!condition) throw new Error(label); };
const allowedFlags = new Set(["--allow-live", "--project-ref", "--allow-temporary-owner", "--reviewed-commit", "--cleanup-ledger", "--reuse-cleaned-owner", "--describe"]);
if (args.includes("--describe")) {
  console.log(JSON.stringify({ execution: "NOT RUN", projectRef: TEST_REF, origin, required: usage, budget: { authUsers: 7, orders: 4, branches: 2, customers: 2, hardStopMinutes: 30 }, evidence: "sanitized SSR/API/JWT status traces + safe workspace screenshots", limitations: "No AI, MCP, Demo reset, existing account/config mutations, email, or production" }, null, 2));
  process.exit(0);
}
check(args.includes("--allow-live") && args.includes("--allow-temporary-owner") && option("--project-ref") === TEST_REF && /^[0-9a-f]{7,40}$/.test(option("--reviewed-commit") ?? ""), "Runner requires reviewed commit and explicit one-batch Test authorization flags");
check(!(args.includes("--cleanup-ledger") && args.includes("--reuse-cleaned-owner")), "Choose one recovery mode");
for (let index = 0; index < args.length; index++) { check(allowedFlags.has(args[index]), "Unknown runner option"); if (["--project-ref", "--reviewed-commit", "--cleanup-ledger", "--reuse-cleaned-owner"].includes(args[index])) { check(Boolean(args[index + 1]), "Missing runner option value"); index++; } }
const environment = {};
for (const line of (await fs.readFile(path.join(root, ".env"), "utf8")).split(/\r?\n/)) { const match = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line); if (match) environment[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2"); }
let targetMatches = false; try { targetMatches = new URL(environment.NEXT_PUBLIC_SUPABASE_URL).href === `https://${TEST_REF}.supabase.co/`; } catch { /* safe fixed diagnostic below */ }
check(targetMatches && environment.NEXT_PUBLIC_SUPABASE_ANON_KEY && environment.SUPABASE_SERVICE_ROLE_KEY && environment.SUPABASE_DB_PASSWORD, "Exact Test credentials are required internally");
const gitOptions = { cwd: root, encoding: "utf8", windowsHide: true };
const candidate = execFileSync("git", ["rev-parse", "--verify", `${option("--reviewed-commit")}^{commit}`], gitOptions).trim();
const actualHead = execFileSync("git", ["rev-parse", "HEAD"], gitOptions).trim(); check(actualHead === candidate, "Checkout differs from reviewed candidate");
check(execFileSync("git", ["status", "--porcelain", "--", "src", "supabase/migrations", "package.json", "pnpm-lock.yaml", "next.config.*", "tsconfig*.json"], gitOptions).trim() === "", "Executable application/migration/dependency changes require fresh review");
const cloud = `https://${TEST_REF}.supabase.co`;
const require = createRequire(import.meta.url);
const evidence = { candidateCommit: candidate, actualHead, runnerHash: createHash("sha256").update(await fs.readFile(fileURLToPath(import.meta.url))).digest("hex"), helperHash: createHash("sha256").update(await fs.readFile(path.join(root, "scripts", "staff-live-fixtures.mjs"))).digest("hex"), projectRef: TEST_REF, budget: { maxAuthUsers: 7, maxOrders: 4, maxBranches: 2, maxCustomers: 2, maxMinutes: 30 }, scope: "real Test Auth + browser SSR + signed application APIs + RLS/JWT negatives", authorization: "One human-authorized temporary SUPER_ADMIN batch, Main-reviewed execution required", startedAt: new Date().toISOString(), result: "RUNNING", cleanup: "PENDING", cases: [], traces: [], screenshots: [], runtimeErrors: 0, blockedRequests: 0, consoleWarnings: 0, expectedHttpErrors: 0 };
let ledger; let ledgerFile; let reportFile; let browser; let currentStep = "preflight"; let hardTimer; let softTimer;
const contexts = [];
const passwords = new Map();
const tokens = new Map();
const identities = new Map();
const abort = new AbortController();
const cleanupAbort = new AbortController();
let lockOwned = false;
let cleanupEligible = false;
let cleanupDeadline;
const record = (label, status) => { evidence.traces.push({ kind: label, status }); };
const pass = (name) => { evidence.cases.push({ name, result: "PASS" }); console.log(`PASS ${name}`); };
const setStep = (name) => { check(!abort.signal.aborted, "Acceptance time budget exhausted"); currentStep = name; };
const save = async () => persistLedger(ledgerFile, ledger);
async function remote(pathname, { method = "GET", body, token, admin = false, cleanup = false } = {}) {
  if (cleanup) check(Date.now() < cleanupDeadline && !cleanupAbort.signal.aborted, "Cleanup time budget exhausted");
  const signal = cleanup ? AbortSignal.any([cleanupAbort.signal, AbortSignal.timeout(20_000)]) : AbortSignal.any([abort.signal, AbortSignal.timeout(20_000)]);
  const response = await fetch(`${cloud}${pathname}`, { method, signal, headers: { apikey: admin ? environment.SUPABASE_SERVICE_ROLE_KEY : environment.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${admin ? environment.SUPABASE_SERVICE_ROLE_KEY : token ?? environment.NEXT_PUBLIC_SUPABASE_ANON_KEY}`, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  record(admin ? "Auth admin exact fixture" : pathname.startsWith("/rest/") ? "signed JWT/RLS" : "Auth session proof", response.status);
  const data = await response.json().catch(() => null); return { status: response.status, ok: response.ok, data };
}
async function reconcile() {
  const result = JSON.parse(await sql(environment, reconcileSql(ledger), { readOnly: true }));
  for (const row of result.provisioning) {
    const user = ledger.users.find((item) => item.email === row.email);
    check(user && ledger.operations.includes(row.operationId), "Untracked provisioning identity");
    user.authUserId = id(row.authUserId); user.profileId = id(row.profileId); user.operationId = id(row.operationId);
  }
  for (const row of result.orders) { const planned = ledger.orders.find((item) => item.orderNo === row.orderNo); check(planned && planned.createdByProfileId === row.createdByProfileId && (!planned.id || planned.id === row.id), "Untracked order identity or creator"); planned.id = id(row.id); }
  await save();
}
async function cleanup() {
  if (!ledger) return;
  cleanupDeadline = Date.now() + 4 * 60_000;
  evidence.cleanup = "RUNNING"; ledger.state = "CLEANUP"; await save();
  // Preview IDs are server-generated. Recover drafts by the exact temporary
  // Owner/profile/workspace pair, validate each row against planned identities,
  // then use only the returned exact draft IDs for every subsequent operation.
  const drafts = JSON.parse(await sql(environment, `select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'inputs',(select coalesce(jsonb_agg(r.input),'[]') from private.staff_import_rows r where r.import_id=i.id))),'[]') from private.staff_imports i where i.owner_profile_id=${literal(ledger.owner.profileId)}::uuid and i.workspace_id=${literal(ledger.workspaceId)}::uuid and i.created_at>=${literal(ledger.startedAt)}::timestamptz;`, { readOnly: true }));
  check(drafts.length <= 4, "Unexpected number of fixture imports");
  for (const draft of drafts) { check(draft.inputs.length > 0 && draft.inputs.length <= 2 && draft.inputs.every((row) => ledger.users.some((user) => ["import-a", "import-b"].includes(user.label) && user.email === row.email && row.name === `${ledger.marker} ${user.label}`)), "Cleanup import identity mismatch"); if (!ledger.imports.includes(draft.id)) ledger.imports.push(id(draft.id)); } await save();
  // Capture exact row operation UUIDs even if the confirm HTTP response was lost.
  const operations = JSON.parse(await sql(environment, `select coalesce(jsonb_agg(operation_id),'[]') from private.staff_import_rows where import_id=any(array[${ledger.imports.map((value) => `${literal(id(value))}::uuid`).join(",")}]::uuid[]);`, { readOnly: true }));
  for (const value of operations) if (!ledger.operations.includes(value)) ledger.operations.push(id(value));
  await reconcile();
  // Closing a browser does not cancel an already-running server Auth mutation.
  // Wait for bounded server provisioning/reset leases before deleting identities.
  for (let attempt = 0; attempt < 24; attempt++) {
    const pending = Number(await sql(environment, `select (select count(*) from private.staff_provisioning where id=any(array[${ledger.operations.map((value) => `${literal(value)}::uuid`).join(",")}]::uuid[]) and state='RESERVED' and claim_expires_at>clock_timestamp())+(select count(*) from private.staff_password_resets where id=any(array[${ledger.resets.map((value) => `${literal(value)}::uuid`).join(",")}]::uuid[]) and state='RESERVED' and claim_expires_at>clock_timestamp());`, { readOnly: true }));
    if (!pending) break;
    check(attempt < 23 && Date.now() + 5000 < cleanupDeadline && !cleanupAbort.signal.aborted, "Outstanding server fixture operation requires manual cleanup"); await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  await reconcile();
  // No fixture Auth delete is issued until same-transaction SQL identity checks
  // have accepted email, Owner run marker, operation UUID and workspace ownership.
  await sql(environment, cleanupSql(ledger), { timeout: 60_000 });
  for (const user of ledger.users.filter((item) => item.authUserId)) {
    const found = await remote(`/auth/v1/admin/users/${id(user.authUserId)}`, { admin: true, cleanup: true });
    if (found.status === 404) continue;
    check(found.ok && found.data?.id === user.authUserId && found.data.email === user.email, "Cleanup exact Auth readback mismatch");
    check(user.label !== "owner" || found.data.app_metadata?.sejukops_acceptance_run === ledger.runId, "Cleanup Owner run marker mismatch");
    check(user.label === "owner" || found.data.app_metadata?.sejukops_staff_operation === user.operationId, "Cleanup staff operation marker mismatch");
    const deleted = await remote(`/auth/v1/admin/users/${id(user.authUserId)}`, { method: "DELETE", admin: true, cleanup: true }); check(deleted.ok, "Exact fixture Auth deletion failed");
    const absent = await remote(`/auth/v1/admin/users/${id(user.authUserId)}`, { admin: true, cleanup: true }); check(absent.status === 404, "Fixture Auth still exists");
  }
  const after = JSON.parse(await sql(environment, baselineSql, { readOnly: true, timeout: 60_000 }));
  check(JSON.stringify(after) === JSON.stringify(ledger.baseline), "Cleanup baseline differs; do not broaden deletion");
  evidence.cleanup = "PASS"; ledger.state = "CLEANED"; ledger.cleanedAt = new Date().toISOString(); await save(); pass("exact fixture cleanup and original four Auth users/config/business baseline preserved");
}
async function newPage(label) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, acceptDownloads: true }); contexts.push(context);
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if ((![origin, cloud].includes(url.origin) && ["http:", "https:"].includes(url.protocol)) || /\/api\/.*(?:agent|ai-settings|demo\/reset|mcp)/.test(url.pathname)) { evidence.blockedRequests++; await route.abort("blockedbyclient"); return; }
    if (url.origin === origin && url.pathname === "/api/platform/staff" && route.request().method() === "POST") {
      const body = route.request().postDataJSON(); check(ledger.users.some((item) => item.email === body.input?.email), "Unplanned staff creation blocked");
      if (!ledger.operations.includes(body.requestKey)) ledger.operations.push(id(body.requestKey)); await save();
    }
    if (url.origin === origin && /\/api\/platform\/staff\/[^/]+\/password$/.test(url.pathname) && route.request().method() === "POST") { const body = route.request().postDataJSON(); if (!ledger.resets.includes(body.requestKey)) ledger.resets.push(id(body.requestKey)); await save(); }
    await route.continue();
  });
  const page = await context.newPage(); page.setDefaultTimeout(20_000); page.setDefaultNavigationTimeout(30_000);
  page.on("pageerror", () => evidence.runtimeErrors++);
  page.on("console", (message) => { if (message.type() === "warning") evidence.consoleWarnings++; if (message.type() === "error") { if (/Failed to load resource/.test(message.text())) evidence.expectedHttpErrors++; else evidence.runtimeErrors++; } });
  page.on("response", (response) => { const url = new URL(response.url()); if (url.origin === origin && (url.pathname.startsWith("/api/") || response.request().isNavigationRequest())) evidence.traces.push({ kind: "browser SSR/API", actor: label, path: url.pathname, status: response.status() }); });
  return page;
}
const pause = (page) => page.waitForTimeout(700);
const click = async (page, locator) => { await locator.click(); await pause(page); };
const fill = async (page, locator, value) => { await locator.fill(value); await pause(page); };
async function choose(page, label, option) { await click(page, page.getByLabel(label, { exact: true }).locator('xpath=ancestor::div[contains(@class,"ant-select-selector")][1]')); await click(page, page.locator(".ant-select-item-option-content").getByText(option, { exact: true })); }
async function session(page, label) {
  const cookies = await page.context().cookies(); const name = `sb-${TEST_REF}-auth-token`;
  const fragments = cookies.filter((cookie) => cookie.name === name || cookie.name.startsWith(name + ".")).sort((a, b) => Number(a.name.split(".")[1] ?? 0) - Number(b.name.split(".")[1] ?? 0));
  let value = decodeURIComponent(fragments.map((cookie) => cookie.value).join("")); if (value.startsWith("base64-")) value = Buffer.from(value.slice(7), "base64url").toString("utf8");
  const parsed = JSON.parse(value); check(typeof parsed.access_token === "string", "Signed browser session unavailable");
  const claims = JSON.parse(Buffer.from(parsed.access_token.split(".")[1], "base64url").toString("utf8")); check(claims.iss === `${cloud}/auth/v1` && claims.session_id, "Browser JWT project/session mismatch");
  const user = await remote("/auth/v1/user", { token: parsed.access_token }); check(user.ok && user.data.id === ledger.users.find((item) => item.label === label).authUserId, "Browser actual UID mismatch"); identities.set(label, { authUserId: user.data.id, sessionId: claims.session_id }); tokens.set(label, parsed.access_token); return parsed.access_token;
}
async function api(page, pathname, { method = "GET", data } = {}) { const response = await page.context().request.fetch(`${origin}${pathname}`, { method, timeout: 20_000, headers: { Origin: origin, ...(data === undefined ? {} : { "Content-Type": "application/json" }) }, ...(data === undefined ? {} : { data }) }); record("signed application API", response.status()); return { status: response.status(), ok: response.ok(), data: await response.json().catch(() => null) }; }
async function login(page, label, password, owner = false) { await page.goto(`${origin}${owner ? "/owner/login" : "/login"}`); const user = ledger.users.find((item) => item.label === label); await fill(page, page.getByLabel("Email", { exact: true }), user.email); await fill(page, page.getByLabel("Password", { exact: true }), password); await click(page, page.getByRole("button", { name: "Sign in", exact: true })); }
async function credentials(page) {
  const modal = page.getByRole("dialog", { name: "Temporary login credentials", exact: true }); await modal.waitFor();
  const blocks = modal.locator(".ant-descriptions"); const count = await blocks.count(); check(count > 0 && count <= 2, "Credential batch exceeds fixture budget");
  for (let index = 0; index < count; index++) { const block = blocks.nth(index); const email = (await block.locator(".ant-descriptions-item-content").nth(0).innerText()).trim(); const password = await block.locator("code").innerText(); check(ledger.users.some((item) => item.email === email), "Unexpected credential identity"); passwords.set(email, password); }
  await click(page, modal.getByRole("button", { name: "Close and clear passwords", exact: true })); await modal.waitFor({ state: "hidden" }); check(await page.locator(".ant-modal code").count() === 0, "Credential DOM not cleared");
}
async function screenshot(page, name) { check(!/\/login|\/password/.test(new URL(page.url()).pathname) && await page.getByRole("dialog").count() === 0 && await page.locator('input[type="password"],.ant-modal code').count() === 0, "Secret-bearing screenshot forbidden"); const file = `${name}.png`; await page.screenshot({ path: path.join(path.dirname(reportFile), file), fullPage: true }); evidence.screenshots.push(file); }
async function onboarding(label) {
  setStep(`staff onboarding ${label}`); const page = await newPage(label); const user = ledger.users.find((item) => item.label === label); const temporary = passwords.get(user.email); check(temporary, "One-time UI credential unavailable"); await login(page, label, temporary); await page.getByRole("heading", { name: "Set your own password", exact: true }).waitFor(); const old = await session(page, label);
  check((await api(page, `/api/workspaces/${ledger.workspaceId}/orders`)).status === 403, "Onboarding application data not denied");
  const rows = await remote(`/rest/v1/workspace_orders?workspace_id=eq.${ledger.workspaceId}&select=id`, { token: old }); check(rows.ok && rows.data.length === 0, "Onboarding RLS data not denied");
  const password = randomBytes(24).toString("base64url"); passwords.set(label, password); await fill(page, page.getByLabel("Current password", { exact: true }), temporary); await fill(page, page.getByLabel("New password", { exact: true }), password); await fill(page, page.getByLabel("Confirm new password", { exact: true }), password); await click(page, page.getByRole("button", { name: "Change password", exact: true })); await page.getByText("Password changed. Sign in again to open your workspace.", { exact: true }).waitFor(); passwords.delete(user.email);
  const oldStatus = await remote("/rest/v1/rpc/staff_session_status", { method: "POST", body: {}, token: old }); check(oldStatus.ok && oldStatus.data.sessionAllowed === false, "Old onboarding JWT remains allowed");
  await login(page, label, password); await page.getByRole("heading", { name: "Orders", exact: true }).waitFor(); await session(page, label); check((await api(page, `/api/workspaces/${ledger.workspaceId}/orders`)).ok, "Staff SSR/API entry failed"); check((await api(page, `/api/platform/staff?workspaceId=${ledger.workspaceId}`)).status === 403, "Staff platform access allowed"); pass(`${label} real UI login, first-password gate, old JWT denial, reauthentication and no platform access`); return page;
}

try {
  const baseline = JSON.parse(await sql(environment, baselineSql, { readOnly: true, timeout: 60_000 })); if (!args.includes("--cleanup-ledger")) check(baseline.authIds.length === 4 && baseline.ownerWorkspaces.length === 1, "Starting Test baseline changed; Main must inspect");
  const cleanupOption = args.includes("--cleanup-ledger") ? path.resolve(root, option("--cleanup-ledger")) : null;
  if (cleanupOption) { check(path.dirname(cleanupOption) === path.join(root, ".agent") && /^staff-live-[0-9a-f-]{36}\.local\.json$/.test(path.basename(cleanupOption)), "Cleanup ledger path unsafe"); ledger = JSON.parse(await fs.readFile(cleanupOption, "utf8")); validateLedger(ledger); ledgerFile = cleanupOption; cleanupEligible = true; }
  else if (args.includes("--reuse-cleaned-owner")) {
    const reuseFile = path.resolve(root, option("--reuse-cleaned-owner"));
    check(path.dirname(reuseFile) === path.join(root, ".agent") && /^staff-live-[0-9a-f-]{36}\.local\.json$/.test(path.basename(reuseFile)), "Reuse ledger path unsafe");
    ledger = JSON.parse(await fs.readFile(reuseFile, "utf8")); validateLedger(ledger); ledgerFile = reuseFile;
    check(ledger.state === "CLEANED" && JSON.stringify(ledger.baseline) === JSON.stringify(baseline)
      && ledger.operations.length === 0 && ledger.resets.length === 0 && ledger.imports.length === 0 && ledger.orders.length === 0
      && ledger.users.filter(user => user.authUserId).every(user => user.label === "owner")
      && Number.isInteger(ledger.attempt ?? 1) && (ledger.attempt ?? 1) >= 1 && (ledger.attempt ?? 1) < 3, "Only a fully cleaned pre-staff attempt can reuse its one authorized Owner identity");
    ledger.attempt = (ledger.attempt ?? 1) + 1; ledger.state = "PLANNED";
    ledger.startedAt = JSON.parse(await sql(environment, "select to_json(clock_timestamp());", {readOnly: true}));
    const lock = await fs.open(path.join(root, ".agent", "staff-live-acceptance.local.lock"), "wx", 0o600); lockOwned = true; await lock.writeFile(ledger.runId); await lock.close(); await save();
  } else {
    ledger = newLedger(randomUUID(), baseline.ownerWorkspaces[0].id); ledger.baseline = baseline; ledgerFile = ledgerPath(root, ledger.runId);
    ledger.startedAt = JSON.parse(await sql(environment, "select to_json(clock_timestamp());", { readOnly: true }));
    await fs.mkdir(path.join(root, ".agent"), { recursive: true });
    const lock = await fs.open(path.join(root, ".agent", "staff-live-acceptance.local.lock"), "wx", 0o600); lockOwned = true; await lock.writeFile(ledger.runId); await lock.close();
    for (const label of ["owner", "admin", "manager", "tech-a", "tech-b", "import-a", "import-b"]) ledger.users.push({ label, email: `${ledger.marker}-${label}@example.invalid`, ...(label === "owner" ? ledger.owner : {}) });
    ledger.branches = ["A", "B"].map((letter) => ({ id: randomUUID(), code: `AC_${ledger.runId.slice(0, 8)}_${letter}`, name: `${ledger.marker} Branch ${letter}` }));
    ledger.customers = ["A", "B"].map((letter) => ({ id: randomUUID(), name: `${ledger.marker} Customer ${letter}` })); await save();
  }
  const output = path.join(root, "reports", "artifacts", `2026-10-01-staff-real-${ledger.runId}`); await fs.mkdir(output, { recursive: true }); reportFile = path.join(output, (ledger.attempt ?? 1) === 1 ? "result.json" : `result-attempt-${ledger.attempt}.json`); evidence.runId = ledger.runId; evidence.attempt = ledger.attempt ?? 1;
  hardTimer = setTimeout(() => { evidence.result = "FAIL"; evidence.failedStep = "30 minute hard budget"; abort.abort(); cleanupAbort.abort(); void browser?.close().catch(() => {}); writeFileSync(reportFile, JSON.stringify(evidence, null, 2)); }, 30 * 60_000);
  softTimer = setTimeout(() => { evidence.result = "FAIL"; evidence.failedStep = "25 minute acceptance budget; cleanup reserved"; abort.abort(); void browser?.close().catch(() => {}); }, 25 * 60_000);
  if (cleanupOption) { evidence.result = "CLEANUP_ONLY"; }
  else {
    setStep("temporary Owner exact identity"); const ownerPassword = randomBytes(24).toString("base64url"); passwords.set("owner", ownerPassword);
    ledger.state = "AUTH_CREATE_ATTEMPTED"; await save(); cleanupEligible = true; const owner = ledger.users[0]; const created = await remote("/auth/v1/admin/users", { method: "POST", admin: true, body: { id: owner.authUserId, email: owner.email, password: ownerPassword, email_confirm: true, app_metadata: { sejukops_acceptance_run: ledger.runId } } }); check(created.ok && created.data.id === owner.authUserId, "Temporary Owner Auth creation failed"); await sql(environment, setupSql(ledger)); ledger.state = "CREATED"; await save();
    const { chromium } = require("C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"); browser = await chromium.launch({ headless: true, executablePath: "C:/Users/user/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe" });
    const ownerPage = await newPage("owner"); await login(ownerPage, "owner", ownerPassword, true); await ownerPage.getByRole("heading", { name: "Owner account", exact: true }).waitFor(); await session(ownerPage, "owner"); const originalOwnerIdentity = { ...identities.get("owner") }; await ownerPage.goto(`${origin}/platform/staff`);
    const staffBase = "/api/platform/staff"; const workspaceBase = `/api/workspaces/${ledger.workspaceId}`; const rows = await api(ownerPage, `${staffBase}?workspaceId=${ledger.workspaceId}`); check(rows.ok && ledger.branches.every((branch) => rows.data.branches.some((item) => item.code === branch.code)), "Application and SQL Test project binding mismatch"); pass("temporary confirmed no-email Owner uses real SSR login and exact Test staff workspace");
    for (const [label, role, branchIndex] of [["admin", "Admin", null], ["manager", "Manager", null], ["tech-a", "Technician", 0], ["tech-b", "Technician", 1]]) {
      setStep(`Owner UI create ${label}`); await click(ownerPage, ownerPage.getByRole("button", { name: "Create staff account", exact: true })); const dialog = ownerPage.getByRole("dialog", { name: "Create staff account", exact: true }); const user = ledger.users.find((item) => item.label === label); await fill(ownerPage, dialog.getByLabel("Employee name", { exact: true }), `${ledger.marker} ${label}`); await fill(ownerPage, dialog.getByLabel("Employee email", { exact: true }), user.email); await choose(ownerPage, "Business role", role); if (branchIndex !== null) await choose(ownerPage, "Technician branch", `${ledger.branches[branchIndex].name} (${ledger.branches[branchIndex].code})`);
      await click(ownerPage, dialog.getByRole("button", { name: "Create account", exact: true })); await credentials(ownerPage); await reconcile(); check(user.authUserId && user.profileId, "UI-created identity not reconciled");
    }
    pass("Owner creates Admin, Manager and two branch-mapped Technicians in real UI; one-time passwords clear");
    const technicians = JSON.parse(await sql(environment, `select coalesce(jsonb_agg(jsonb_build_object('id',id,'profileId',profile_id,'branchId',branch_id)),'[]') from public.workspace_technicians where workspace_id=${literal(ledger.workspaceId)}::uuid and profile_id=any(array[${ledger.users.filter((item) => ["tech-a", "tech-b"].includes(item.label)).map((item) => `${literal(item.profileId)}::uuid`).join(",")}]::uuid[]);`, { readOnly: true }));
    // Two exact-ID SQL seed orders make every onboarding RLS denial meaningful:
    // there is real assigned fixture data available if readiness enforcement fails.
    for (let index = 0; index < 2; index++) ledger.orders.push({ id: randomUUID(), orderNo: `${ledger.marker}-GATE-${index}`, createdByProfileId: ledger.owner.profileId }); await save();
    await sql(environment, `begin; insert into public.workspace_orders(workspace_id,id,order_no,branch_id,customer_id,assigned_technician_id,status,problem_description,service_type,created_by_profile_id) values ${ledger.orders.map((row, index) => `(${literal(ledger.workspaceId)}::uuid,${literal(row.id)}::uuid,${literal(row.orderNo)},${literal(ledger.branches[index].id)}::uuid,${literal(ledger.customers[index].id)}::uuid,${literal(technicians.find((item) => item.branchId === ledger.branches[index].id).id)}::uuid,'ASSIGNED','Fictional onboarding fence','Acceptance seed',${literal(ledger.owner.profileId)}::uuid)`).join(",")}; commit;`);
    const staffPages = {}; for (const label of ["admin", "manager", "tech-a", "tech-b"]) staffPages[label] = await onboarding(label);
    const adminPage = staffPages.admin; const generation = (await api(adminPage, `${workspaceBase}/orders`)).data.generation;
    for (let index = 0; index < 2; index++) {
      setStep(`real core order ${index}`); const orderNo = `${ledger.marker}-${index}`; ledger.orders.push({ orderNo, createdByProfileId: ledger.users.find((item) => item.label === "admin").profileId }); await save();
      const create = await api(adminPage, `${workspaceBase}/orders`, { method: "POST", data: { expectedGeneration: generation, orderNo, branchId: ledger.branches[index].id, customerId: ledger.customers[index].id, problemDescription: "Fictional acceptance maintenance", serviceType: "Acceptance inspection" } }); await reconcile(); check(create.status === 201 && ledger.orders[index + 2].id === create.data.order.id, "Real order creation failed");
      const technician = technicians.find((item) => item.branchId === ledger.branches[index].id); check(technician, "Actual technician mapping missing"); const assigned = await api(adminPage, `${workspaceBase}/orders/${ledger.orders[index + 2].id}/assignment`, { method: "POST", data: { expectedGeneration: generation, expectedUpdatedAt: create.data.order.updated_at, technicianId: technician.id, scheduledAt: "2026-10-02T03:00:00Z" } }); check(assigned.ok, "Admin assignment failed");
    }
    const orderId = ledger.orders[2].id; const current = (await api(staffPages.manager, `${workspaceBase}/orders`)).data.orders.find((item) => item.id === orderId);
    check((await api(staffPages.manager, `${workspaceBase}/orders/${orderId}/schedule`, { method: "POST", data: { expectedGeneration: generation, expectedUpdatedAt: current.updated_at, scheduledAt: "2026-10-02T04:00:00Z" } })).ok, "Manager schedule failed");
    for (const [label, index] of [["tech-a", 0], ["tech-b", 1]]) {
      const visible = await api(staffPages[label], `${workspaceBase}/orders`); const expectedOrders = [ledger.orders[index].id, ledger.orders[index + 2].id].sort(); check(visible.ok && JSON.stringify(visible.data.orders.map((item) => item.id).sort()) === JSON.stringify(expectedOrders), "Technician application assignment isolation failed");
      for (const [table, expected] of [["workspace_orders", expectedOrders], ["workspace_customers", [ledger.customers[index].id]], ["workspace_branches", [ledger.branches[index].id]]]) { const allowed = await remote(`/rest/v1/${table}?workspace_id=eq.${ledger.workspaceId}&select=id`, { token: tokens.get(label) }); check(allowed.ok && JSON.stringify(allowed.data.map((item) => item.id).sort()) === JSON.stringify(expected), "Technician direct JWT read scope failed"); }
    }
    for (const nextStatus of ["IN_PROGRESS", "COMPLETED"]) { const current = (await api(staffPages["tech-a"], `${workspaceBase}/orders`)).data.orders.find((item) => item.id === orderId); check((await api(staffPages["tech-a"], `${workspaceBase}/orders/${orderId}/status`, { method: "POST", data: { expectedGeneration: generation, expectedUpdatedAt: current.updated_at, nextStatus } })).ok, "Technician progress failed"); }
    pass("real Admin create/assign, Manager schedule, Technician start/complete and two-employee order/customer/branch isolation");
    setStep("Owner read-only perspectives"); await ownerPage.goto(`${origin}/owner`);
    for (const data of [{ workspaceId: ledger.workspaceId, role: "TECHNICIAN", employeeProfileId: ledger.owner.profileId }, { workspaceId: randomUUID(), role: "ADMIN", employeeProfileId: null }]) check((await api(ownerPage, "/api/platform/owner-preview", { method: "POST", data })).status === 409, "Forged/cross-workspace preview not denied");
    for (const [role, label] of [["Admin", null], ["Manager", null], ["Technician", "tech-a"], ["Technician", "tech-b"]]) {
      await choose(ownerPage, "Business perspective", role); if (label) await choose(ownerPage, "Technician employee", `${ledger.marker} ${label} (${ledger.branches[label === "tech-a" ? 0 : 1].code})`); await click(ownerPage, ownerPage.getByRole("button", { name: "Open read-only preview", exact: true })); await ownerPage.getByText(new RegExp(`^Read-only ${role} preview`)).waitFor(); await session(ownerPage, "owner"); check(identities.get("owner").authUserId === originalOwnerIdentity.authUserId && identities.get("owner").sessionId === originalOwnerIdentity.sessionId, "Preview changed actual signed Owner UID/session");
      const visible = await api(ownerPage, `${workspaceBase}/orders`); check(visible.ok, "Preview read failed"); if (label) { const index = label === "tech-a" ? 0 : 1; check(JSON.stringify(visible.data.orders.map((item) => item.id).sort()) === JSON.stringify([ledger.orders[index].id, ledger.orders[index + 2].id].sort()), "Selected actual employee preview isolation failed"); }
      else check(JSON.stringify(visible.data.orders.map((item) => item.id).sort()) === JSON.stringify(ledger.orders.map((item) => item.id).sort()), "Admin/Manager preview fixture visibility incomplete");
      const target = visible.data.orders.find((item) => item.id === ledger.orders[label === "tech-b" ? 3 : 2].id); const tech = technicians.find((item) => item.branchId === target.branch_id);
      for (const [suffix, data] of [[`/orders/${target.id}/assignment`, { expectedGeneration: generation, expectedUpdatedAt: target.updated_at, technicianId: tech.id, scheduledAt: null }], [`/orders/${target.id}/schedule`, { expectedGeneration: generation, expectedUpdatedAt: target.updated_at, scheduledAt: "2026-10-03T03:00:00Z" }], [`/orders/${target.id}/status`, { expectedGeneration: generation, expectedUpdatedAt: target.updated_at, nextStatus: "IN_PROGRESS" }], ["/assignment-proposals", { orderId: target.id, technicianId: tech.id, expectedUpdatedAt: target.updated_at, scheduledAt: null, idempotencyKey: randomUUID() }]]) check((await api(ownerPage, `${workspaceBase}${suffix}`, { method: "POST", data })).status === 403, "Preview representative mutation route not denied");
      const denial = await api(ownerPage, `${workspaceBase}/orders`, { method: "POST", data: { expectedGeneration: generation, orderNo: `${ledger.marker}-DENIED`, branchId: ledger.branches[0].id, customerId: ledger.customers[0].id, problemDescription: "Denied fixture", serviceType: "Denied fixture" } }); check(denial.status === 403, "Preview application write allowed");
      const deniedRpc = await remote("/rest/v1/rpc/workspace_order_create", { method: "POST", token: tokens.get("owner"), body: { p_workspace_id: ledger.workspaceId, p_expected_generation: generation, p_order_no: `${ledger.marker}-DENIED`, p_branch_id: ledger.branches[0].id, p_customer_id: ledger.customers[0].id, p_problem_description: "Denied fixture", p_service_type: "Denied fixture", p_guest_visit_id: null, p_guest_token_hash: null } }); check(deniedRpc.status === 403 && deniedRpc.data?.code === "42501", "Preview direct JWT did not return permission denial");
      await screenshot(ownerPage, `preview-${label ?? role.toLowerCase()}`); if (label === "tech-b") { await ownerPage.setViewportSize({ width: 390, height: 844 }); check(await ownerPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), "Narrow preview overflow"); await screenshot(ownerPage, "preview-technician-narrow"); await ownerPage.setViewportSize({ width: 1280, height: 720 }); }
      await click(ownerPage, ownerPage.getByRole("button", { name: "Return to Owner", exact: true })); await ownerPage.getByRole("heading", { name: "Owner account", exact: true }).waitFor();
    }
    pass("real persisted Admin/Manager/actual Technician previews preserve Owner UID, scoped reads, deny API/JWT writes and explicitly exit");
    setStep("Owner role disable and reset"); await ownerPage.goto(`${origin}/platform/staff`); const manager = ledger.users.find((item) => item.label === "manager");
    const patch = async (role, active) => { const list = await api(ownerPage, `${staffBase}?workspaceId=${ledger.workspaceId}`); const row = list.data.accounts.find((item) => item.profileId === manager.profileId); const result = await api(ownerPage, `${staffBase}/${manager.profileId}`, { method: "PATCH", data: { workspaceId: ledger.workspaceId, expectedRevision: row.authRevision, role, branchCode: null, active } }); check(result.ok, "Owner role/active change failed"); };
    const oldManager = tokens.get("manager");
    const oldManagerDenied = async () => { const status = await remote("/rest/v1/rpc/staff_session_status", { method: "POST", body: {}, token: oldManager }); check(status.ok && status.data.sessionAllowed === false, "Old Manager JWT session remains allowed"); const rows = await remote(`/rest/v1/workspace_orders?workspace_id=eq.${ledger.workspaceId}&select=id`, { token: oldManager }); check(rows.ok && rows.data.length === 0, "Old Manager JWT can still read orders"); };
    await patch("ADMIN", true); check((await api(staffPages.manager, `${workspaceBase}/orders`)).status === 403, "Old session remains after role change"); await oldManagerDenied(); await patch("MANAGER", false); check((await api(staffPages.manager, `${workspaceBase}/orders`)).status === 403, "Disabled old session still reads"); await patch("MANAGER", true); check((await api(staffPages.manager, `${workspaceBase}/orders`)).status === 403, "Reenable revived the old session before reset"); await oldManagerDenied();
    await ownerPage.reload(); await ownerPage.getByRole("button", { name: `Reset temporary password for ${ledger.marker} manager`, exact: true }).waitFor();
    await click(ownerPage, ownerPage.getByRole("button", { name: `Reset temporary password for ${ledger.marker} manager`, exact: true })); const resetDialog = ownerPage.getByRole("dialog", { name: `Reset temporary password for ${ledger.marker} manager?`, exact: true }); await resetDialog.getByText(/All previous sessions become invalid/).waitFor(); await click(ownerPage, resetDialog.getByRole("button", { name: "Reset password", exact: true })); await credentials(ownerPage);
    const oldManagerStatus = await remote("/rest/v1/rpc/staff_session_status", { method: "POST", body: {}, token: oldManager }); check(oldManagerStatus.ok && oldManagerStatus.data.sessionAllowed === false, "Old Manager JWT reset denial failed"); await onboarding("manager"); pass("Owner role change, disable/reenable and explicit temporary reset revoke old API/JWT sessions");
    setStep("real XLSX template and imports"); const ExcelJS = require("exceljs"); const template = await ownerPage.context().request.get(`${origin}${staffBase}/import/template?workspaceId=${ledger.workspaceId}`, { timeout: 20_000 }); check(template.ok() && template.headers()["content-type"]?.includes("spreadsheetml"), "Actual XLSX template failed"); const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await template.body()); check(workbook.getWorksheet("Staff"), "Actual XLSX Staff sheet missing");
    const makeWorkbook = async (rows) => { const book = new ExcelJS.Workbook(); const sheet = book.addWorksheet("Staff"); sheet.addRow(["name", "email", "role", "branchCode"]); for (const row of rows) sheet.addRow(row); return Buffer.from(await book.xlsx.writeBuffer()); };
    const upload = async (bytes) => { const pending = ownerPage.waitForResponse((response) => new URL(response.url()).pathname === `${staffBase}/import/preview` && response.request().method() === "POST"); await ownerPage.getByLabel("Staff workbook (.xlsx)", { exact: true }).setInputFiles({ name: "acceptance.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: bytes }); const response = await pending; check(response.ok(), "Real XLSX preview failed"); const draft = await response.json(); if (draft.invalidCount === 0) { ledger.imports.push(id(draft.importId)); await save(); } await ownerPage.getByRole("dialog", { name: "Review staff import", exact: true }).waitFor(); return draft; };
    const invalid = await upload(await makeWorkbook([[`${ledger.marker} duplicate`, ledger.users.find((item) => item.label === "admin").email, "ADMIN", ""]])); check(invalid.invalidCount === 1, "Existing-email import was not rejected"); await click(ownerPage, ownerPage.getByRole("button", { name: "Cancel import", exact: true }));
    const importedA = ledger.users.find((item) => item.label === "import-a"); const importedB = ledger.users.find((item) => item.label === "import-b"); const draft = await upload(await makeWorkbook([[`${ledger.marker} import-a`, importedA.email, "ADMIN", ""], [`${ledger.marker} import-b`, importedB.email, "TECHNICIAN", ledger.branches[1].code]])); check(draft.validCount === 2 && draft.invalidCount === 0, "Two-row import invalid");
    const operations = JSON.parse(await sql(environment, `select jsonb_agg(operation_id) from private.staff_import_rows where import_id=${literal(draft.importId)}::uuid;`, { readOnly: true })); for (const value of operations) ledger.operations.push(id(value)); await save();
    await sql(environment, `update public.workspace_branches set active=false where id=${literal(ledger.branches[1].id)}::uuid and workspace_id=${literal(ledger.workspaceId)}::uuid and code=${literal(ledger.branches[1].code)};`); await click(ownerPage, ownerPage.getByRole("button", { name: "Confirm import", exact: true })); await credentials(ownerPage); await ownerPage.getByText("Import finished: 1 successful · 1 failed.", { exact: true }).waitFor(); await reconcile();
    await sql(environment, `update public.workspace_branches set active=true where id=${literal(ledger.branches[1].id)}::uuid and workspace_id=${literal(ledger.workspaceId)}::uuid and code=${literal(ledger.branches[1].code)};`); await click(ownerPage, ownerPage.getByRole("button", { name: "Retry failed rows", exact: true })); await credentials(ownerPage); await ownerPage.getByText("Import finished: 2 successful · 0 failed.", { exact: true }).waitFor(); await reconcile();
    const repeated = await api(ownerPage, `${staffBase}/import/confirm`, { method: "POST", data: { workspaceId: ledger.workspaceId, importId: draft.importId } }); check(repeated.ok && repeated.data.complete && repeated.data.results.every((row) => !row.credential), "Real import retry replays password or remains incomplete"); await click(ownerPage, ownerPage.getByRole("button", { name: "Close import", exact: true })); await screenshot(ownerPage, "staff-final-safe"); pass("actual XLSX template/parser, existing-email validation, partial import, explicit failed-row retry and credential-free idempotent confirm");
    check(evidence.runtimeErrors === 0 && evidence.blockedRequests === 0 && !abort.signal.aborted, "Runtime error, unauthorized network attempt or expired budget"); evidence.result = "PASS";
  }
} catch (cause) { evidence.result = "FAIL"; evidence.failedStep = currentStep; evidence.failureKind = ["TimeoutError", "Error", "TypeError"].includes(cause?.name) ? cause.name : "Other"; console.log(`FAIL ${currentStep}; details intentionally withheld from logs`); process.exitCode = 1; }
finally {
  clearTimeout(softTimer); for (const context of contexts) await context.close().catch(() => {}); await browser?.close().catch(() => {});
  if (cleanupEligible) { try { await cleanup(); } catch { evidence.cleanup = "FAILED_MANUAL_EXACT_LEDGER_REQUIRED"; evidence.result = "FAIL"; process.exitCode = 1; if (ledgerFile) await save().catch(() => {}); } }
  passwords.clear(); tokens.clear(); identities.clear(); clearTimeout(hardTimer); evidence.finishedAt = new Date().toISOString();
  if (reportFile) await fs.writeFile(reportFile, JSON.stringify(evidence, null, 2));
  if (evidence.cleanup === "PASS" || (lockOwned && ledger?.state === "PLANNED")) { const lockPath = path.join(root, ".agent", "staff-live-acceptance.local.lock"); if ((await fs.readFile(lockPath, "utf8").catch(() => "")) === ledger.runId) await fs.unlink(lockPath).catch(() => {}); }
  console.log(`RESULT ${evidence.result}; CLEANUP ${evidence.cleanup}; ${evidence.cases.length} bounded checks`);
}
