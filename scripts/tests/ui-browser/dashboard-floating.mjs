import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium } = require("C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const origin = "http://localhost:3200";
const output = path.resolve("reports/workspace-dashboard-floating-2026-10-05/operations-mock");
await fs.mkdir(output, { recursive: true });
const result = { scope: "Actual React components, isolated headless browser, fictional MSW data only. No Supabase/provider calls or Auth verification.", viewport: "1536x864", cases: [], errors: [], externalRequests: [] };
const browser = await chromium.launch({ headless: true, executablePath: "C:/Users/user/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe" });
const context = await browser.newContext({ viewport: { width: 1536, height: 864 } });
await context.route("**/*", async route => { const url = new URL(route.request().url()); if (["http:", "https:"].includes(url.protocol) && url.origin !== origin) { result.externalRequests.push(url.origin + url.pathname); await route.abort(); } else await route.continue(); });
const page = await context.newPage(); page.setDefaultTimeout(12000);
page.on("pageerror", e => result.errors.push(e.message));
const pass = name => { result.cases.push({ name, result: "PASS" }); console.log(`PASS ${name}`); };
const scenario = value => page.getByLabel("Mock scenario").selectOption(value);
async function screenshot(name) {
  await page.waitForTimeout(500);
  await page.addStyleTag({ content: '.mock-controls,.mock-footer{display:none!important}body::after{content:"MOCK DATA · fictional responses";position:fixed;left:12px;bottom:8px;padding:5px 10px;background:#fff4cc;color:#60440d;font:12px system-ui;z-index:3000}' });
  await page.screenshot({ path: path.join(output, name), fullPage: true });
  await page.locator("style").last().evaluate(el => el.remove());
}
try {
  await page.goto(`${origin}/workspaces/10000000-0000-4000-8000-000000000001/overview`, { waitUntil: "networkidle" });
  for (const role of ["admin", "manager", "technician"]) {
    await page.getByLabel("Mock persona").selectOption(`staff-${role}`);
    await page.getByRole("heading", { name: "Dashboard", exact: true }).waitFor();
    await page.getByText("Completion trend", { exact: true }).waitFor();
    await page.getByText("Service distribution", { exact: true }).waitFor();
    assert.equal(await page.getByText("All orders visible to your role.", { exact: false }).count(), 1);
    assert.equal(await page.getByRole("button", { name: "View AI Insight", exact: true }).count(), 1);
    assert.equal(await page.getByRole("menuitem", { name: "Document import", exact: true }).count(), 0);
    assert.equal(await page.locator(".dashboard-stat-card").count(), 4);
    pass(`${role} full Dashboard, trend/distribution/AI entry and removed import menu`);
    const total = await page.locator(".operations-dashboard-highlights").innerText();
    assert.match(total, role === "technician" ? /24/ : /32/);
    pass(`${role} aggregate exceeds old 20-record cap with assigned-only Technician fixture`);
    await screenshot(`${role}-dashboard.png`);
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await page.getByRole("img", { name: /Completed jobs/ }).waitFor();
    await page.getByRole("button", { name: "This Month", exact: true }).click();
    await page.getByRole("img", { name: /Completed jobs/ }).waitFor();
    pass(`${role} MYT Today/Month period switch`);
    await page.getByRole("button", { name: "View AI Insight", exact: true }).click();
    await page.getByRole("button", { name: "Generate AI Insight", exact: true }).click();
    await page.getByRole("region", { name: "Dashboard AI highlights", exact: true }).waitFor();
    pass(`${role} on-demand mocked AI Insight with deterministic source highlights`);
    await screenshot(`${role}-insight.png`);
    await page.getByRole("dialog", { name: "Dashboard AI Insight", exact: true }).getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Open Operations Ask AI", exact: true }).click();
    const drawer = page.getByRole("dialog", { name: "Operations · Ask AI", exact: true }); await drawer.waitFor();
    if (role !== "technician") await drawer.getByText("Knowledge", { exact: true }).click();
    else assert.equal(await drawer.getByText("Orders", { exact: true }).count(), 0);
    await drawer.getByRole("textbox", { name: "Question", exact: true }).fill("How should a fictional filter be cleaned?");
    await drawer.getByRole("button", { name: "Find cited excerpts", exact: true }).click();
    await drawer.getByRole("region", { name: "Cited knowledge excerpts", exact: true }).waitFor();
    pass(`${role} floating cited Knowledge; Technician has no order/native assistant`);
    await screenshot(`${role}-ask-ai.png`);
    await drawer.getByRole("button", { name: "Close", exact: true }).click();
  }
  await scenario("empty"); await page.getByText("No orders are visible.", { exact: true }).waitFor(); pass("Empty Dashboard renders truthful zeros and empty sections");
  await scenario("server-error"); await page.getByText("Overview could not be loaded.", { exact: true }).waitFor(); pass("Dashboard server failure is visible without mock fallback");
  await scenario("success"); await page.getByText("Completion trend", { exact: true }).waitFor(); pass("Dashboard retry/recovery");
  await scenario("quota-exhausted"); await page.getByText("Completion trend", { exact: true }).waitFor();
  await page.getByRole("button", { name: "View AI Insight", exact: true }).click(); await page.getByRole("button", { name: "Generate AI Insight", exact: true }).click();
  await page.getByText("Today's Guest AI allowance is used up. Manual actions remain available.", { exact: true }).waitFor(); pass("AI quota exhaustion keeps dashboard available");
  await page.getByRole("dialog", { name: "Dashboard AI Insight", exact: true }).getByRole("button", { name: "Close", exact: true }).click();
  await scenario("success"); await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open Operations Ask AI", exact: true }).click(); await page.getByRole("dialog", { name: "Operations · Ask AI", exact: true }).waitFor(); await page.waitForTimeout(500);
  const bounds = await page.getByRole("dialog", { name: "Operations · Ask AI", exact: true }).boundingBox(); assert(bounds && bounds.width <= 390 && bounds.x >= 0);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); pass("390px floating panel stays within viewport above Technician navigation");
  await screenshot("technician-mobile-assistant.png");
  assert.deepEqual(result.errors, []); assert.deepEqual(result.externalRequests, []); result.result = "PASS";
} catch (error) { result.result = "FAIL"; result.failure = error.message; console.error(error); await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true }); process.exitCode = 1; }
finally { await fs.writeFile(path.join(output, "results.json"), JSON.stringify(result, null, 2)); await browser.close(); }
