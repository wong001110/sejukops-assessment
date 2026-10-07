import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

// Portable read-only adapter. Secrets remain in ignored local inputs and memory.
// Importing this module opens no browser/session/network connection.
export const TEST_REF = "qobhjvrrpajoyvlgrkbx";
export const origin = "http://127.0.0.1:3100";
export const cloud = `https://${TEST_REF}.supabase.co`;
const root = fileURLToPath(new URL("../../", import.meta.url));
export const privateFile = path.join(root, "evals/ai/.local/staff.json");
const require = createRequire(import.meta.url);
const fail = (code) => { throw new Error(code); };
let publicUrl, anonKey, ledger;
try {
  const parsed = parseEnv(await fs.readFile(path.join(root, ".env"), "utf8"));
  publicUrl = parsed.NEXT_PUBLIC_SUPABASE_URL;
  anonKey = parsed.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // No service-role/database credentials are exported, used or retained.
  ledger = JSON.parse(await fs.readFile(privateFile, "utf8"));
} catch { fail("LIVE_LOCAL_INPUT_UNAVAILABLE"); }
let configured;
try { configured = new URL(publicUrl); } catch { fail("LIVE_TEST_URL_INVALID"); }
if (configured.origin !== cloud || configured.pathname !== "/" || configured.search || configured.hash ||
    configured.username || configured.password || typeof anonKey !== "string" || !anonKey || /[\r\n]/.test(anonKey)) fail("LIVE_TEST_CONFIG_MISMATCH");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (ledger.projectRef !== TEST_REF || !uuid.test(ledger.workspaceId) || ledger.prepared !== true || !Array.isArray(ledger.staff)) fail("LIVE_STAFF_RESOURCE_MISMATCH");
for (const [label, role] of [["admin", "ADMIN"], ["manager", "MANAGER"], ["tech-a", "TECHNICIAN"]]) {
  const accounts = ledger.staff.filter((account) => account.label === label);
  const account = accounts[0];
  if (accounts.length !== 1 || account.role !== role || account.onboarded !== true ||
      typeof account.email !== "string" || !account.email || typeof account.password !== "string" || !account.password ||
      (role === "TECHNICIAN" && !uuid.test(account.technicianId))) fail("LIVE_STAFF_INPUT_INVALID");
}
export const ws = ledger.workspaceId;
export const apiBase = `/api/workspaces/${ws}`;
ledger = undefined;

function chromiumRuntime() {
  for (const location of ["playwright", "C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"]) {
    try { const runtime = require(location); if (runtime.chromium) return runtime.chromium; } catch { /* Try the next installed runtime. */ }
  }
  fail("LIVE_PLAYWRIGHT_UNAVAILABLE");
}
export async function browser() {
  const chromium = chromiumRuntime();
  try { return await chromium.launch({ headless: true }); } catch { /* Try the verified local bundled browser, then installed Edge. */ }
  const executablePath = "C:/Users/user/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe";
  try { await fs.access(executablePath); return await chromium.launch({ headless: true, executablePath }); } catch { /* No visible window is opened. */ }
  try { return await chromium.launch({ headless: true, channel: "msedge" }); } catch { fail("LIVE_BROWSER_UNAVAILABLE"); }
}
export async function context(instance) {
  let created;
  try {
    created = await instance.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, timezoneId: "Asia/Kuala_Lumpur" });
    await created.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (["http:", "https:"].includes(url.protocol) && ![origin, cloud].includes(url.origin)) return route.abort();
      const method = route.request().method();
      if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
        // Page traffic may log in/refresh; AI API requests use the runner's fixed
        // allowlist and budget. No page business/admin/storage mutation is allowed.
        const login = url.origin === origin && url.pathname === "/login" && method === "POST";
        const refresh = url.origin === cloud && url.pathname === "/auth/v1/token" && method === "POST";
        if (!login && !refresh) return route.abort();
      }
      return route.continue();
    });
    return created;
  } catch { await created?.close().catch(() => {}); fail("LIVE_CONTEXT_UNAVAILABLE"); }
}
export async function login(page, account) {
  if (!account || !["ADMIN", "MANAGER", "TECHNICIAN"].includes(account.role) || account.onboarded !== true ||
      typeof account.email !== "string" || typeof account.password !== "string") fail("LIVE_LOGIN_INPUT_INVALID");
  try {
    await page.goto(`${origin}/login`);
    await page.getByLabel("Email", { exact: true }).fill(account.email);
    await page.getByLabel("Password", { exact: true }).fill(account.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  } catch { fail("LIVE_LOGIN_UNAVAILABLE"); }
}
export async function session(page) {
  try {
    const name = `sb-${TEST_REF}-auth-token`;
    const cookies = await page.context().cookies(origin);
    const plain = cookies.find((cookie) => cookie.name === name);
    const chunks = cookies.filter((cookie) => new RegExp(`^${name}\\.\\d+$`).test(cookie.name))
      .sort((a, b) => Number(a.name.slice(name.length + 1)) - Number(b.name.slice(name.length + 1)));
    if (!plain && (!chunks.length || chunks.some((cookie, index) => cookie.name !== `${name}.${index}`))) fail("LIVE_SESSION_COOKIE_INVALID");
    let encoded = decodeURIComponent(plain ? plain.value : chunks.map((cookie) => cookie.value).join(""));
    if (encoded.startsWith("base64-")) encoded = Buffer.from(encoded.slice(7), "base64url").toString("utf8");
    const token = JSON.parse(encoded).access_token;
    if (typeof token !== "string" || token.length > 16_384 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) fail("LIVE_SESSION_TOKEN_INVALID");
    return token;
  } catch { fail("LIVE_SESSION_UNAVAILABLE"); }
}
export async function auth(url, options = {}) {
  if (url !== "/auth/v1/logout?scope=local" || options.method !== "POST" || options.admin || options.body !== undefined ||
      typeof options.token !== "string" || !options.token || /[\r\n]/.test(options.token)) fail("LIVE_AUTH_PATH_DENIED");
  try {
    const response = await fetch(cloud + url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: { apikey: anonKey, Authorization: `Bearer ${options.token}`, "Content-Type": "application/json" } });
    return { status: response.status, ok: response.ok, data: null };
  } catch { fail("LIVE_LOCAL_LOGOUT_UNAVAILABLE"); }
}
