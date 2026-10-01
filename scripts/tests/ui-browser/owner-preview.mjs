// Explicit isolated browser run: actual UI, fictional MSW responses, no Auth or DB.
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium } = require("C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const origin = "http://localhost:3200";
const technicianOnly = process.argv.includes("--technician-only");
const output = path.resolve("reports/artifacts/2026-10-01-owner-preview-mock");
await fs.mkdir(output, { recursive: true });
const evidence = { scope: "Actual Owner preview panel and read-only Orders UI, synthetic MSW API", runtime: "Playwright 1.62.1 isolated headless Chromium", cases: [], screenshots: [], viewports: [], runtimeErrors: [], consoleErrors: [], consoleWarnings: [], externalRequests: [] };
const browser = await chromium.launch({ headless: true, executablePath: "C:/Users/user/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe" });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: "allow" });
await context.route("**/*", async (route) => { const url = new URL(route.request().url()); if (["http:", "https:"].includes(url.protocol) && url.origin !== origin) { evidence.externalRequests.push(`${url.origin}${url.pathname}`); await route.abort("blockedbyclient"); } else await route.continue(); });
const page = await context.newPage(); page.setDefaultTimeout(15000);
page.on("pageerror", (error) => evidence.runtimeErrors.push(error.message));
page.on("console", (message) => { if (message.type() === "error") evidence.consoleErrors.push(message.text()); if (message.type() === "warning") evidence.consoleWarnings.push(message.text()); });
await page.addInitScript(() => { window.__previewNotices = []; window.addEventListener("mock-api-notice", (event) => window.__previewNotices.push(String(event.detail))); });
const pause = () => page.waitForTimeout(1000);
const click = async (locator) => { await locator.click(); await pause(); };
const choose = async (label, value) => { await click(page.getByRole("combobox", { name: label, exact: true }).locator('xpath=ancestor::div[contains(@class,"ant-select-selector")][1]')); await click(page.locator(".ant-select-item-option-content").getByText(value, { exact: true })); };
const pass = (name) => { evidence.cases.push({ name, result: "PASS" }); console.log(`PASS ${name}`); };
const shot = async (name) => { assert.equal(await page.getByRole("dialog", { name: /credentials/i }).count(), 0); const file = `${name}.png`; await page.screenshot({ path: path.join(output, file), fullPage: true }); evidence.screenshots.push(file); };
const layout = async (label) => { const state = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth })); evidence.viewports.push({ label, ...state }); assert.ok(state.document <= state.viewport + 2, `${label} page overflow`); };
const countSets = () => page.evaluate(() => window.__previewNotices.filter((line) => line.startsWith("POST /api/platform/owner-preview →")).length);
const scenario = async (value) => { await page.getByLabel("Mock scenario", { exact: true }).selectOption(value); await pause(); };
const readOnlyOrders = async () => {
  await page.getByRole("heading", { name: "Orders", exact: true }).waitFor();
  await click(page.getByRole("button", { name: "View details", exact: true }).first());
  assert.equal(await page.getByRole("link", { name: /Prepare an assignment|Agent Workspace/ }).count(), 0);
  assert.equal(await page.getByRole("button", { name: /Start assigned job|Complete job|Create order|Reschedule|Confirm import/ }).count(), 0);
  assert.equal(await page.getByRole("heading", { name: "Manual order", exact: true }).count(), 0);
  assert.equal(await page.getByText("AI Assist", { exact: true }).count(), 0);
};
try {
  await page.goto(`${origin}/owner`); await page.getByRole("heading", { name: "Owner account — MOCK", exact: true }).waitFor(); await pause();
  for (const [width, height, size] of [[1280, 720, "desktop"], [390, 844, "narrow"]]) {
    await page.setViewportSize({ width, height }); await pause();
    for (const role of technicianOnly ? ["Technician"] : ["Manager", "Technician", "Admin"]) {
      await choose("Business perspective", role);
      if (role === "Technician") { assert.equal(await page.getByRole("button", { name: "Open read-only preview", exact: true }).isDisabled(), true); await choose("Technician employee", "Synthetic Preview Technician (MOCK_NORTH)"); }
      const before = await countSets(); await page.getByRole("button", { name: "Open read-only preview", exact: true }).dblclick(); await pause();
      await page.getByText(`Read-only ${role} preview${role === "Technician" ? " · Synthetic Preview Technician" : ""}`, { exact: true }).waitFor(); assert.equal(await countSets(), before + 1);
      await readOnlyOrders(); await layout(`${size} ${width}x${height} ${role}`); await shot(`${size}-${role.toLowerCase()}-read-only`);
      if (role === "Technician") { await page.locator(".ant-descriptions").getByText("Synthetic Preview Technician", { exact: true }).waitFor(); assert.equal(await page.getByText("MOCK-001", { exact: true }).count(), 0, "Synthetic Technician fixture must contain only mapped assigned work"); }
      await click(page.getByRole("button", { name: "Return to Owner", exact: true })); await page.getByRole("heading", { name: "Owner account — MOCK", exact: true }).waitFor(); assert.equal(await page.getByText(/^Read-only .* preview/).count(), 0); pass(`${size} ${role} explicit selection, double-submit once, persisted banner, readable orders, no business/AI controls, explicit Owner return`);
    }
    if (technicianOnly) continue;
    await scenario("preview-empty"); await choose("Business perspective", "Technician"); await page.getByText("No active Technicians are available.", { exact: true }).waitFor(); assert.equal(await page.getByRole("button", { name: "Open read-only preview", exact: true }).isDisabled(), true); await layout(`${size} empty Technicians`); pass(`${size} empty actual Technician choices prevents start`);
    await scenario("preview-expired"); await page.getByText("MOCK preview unavailable or expired. Return to Owner and try again.", { exact: true }).waitFor(); await page.getByText("Read-only Technician preview · Synthetic Preview Technician", { exact: true }).waitFor(); await shot(`${size}-expired-recovery`); await click(page.getByRole("button", { name: "Return to Owner", exact: true })); assert.equal(await page.getByText("Read-only Technician preview · Synthetic Preview Technician", { exact: true }).count(), 0); pass(`${size} expired options retain read-only banner and allow explicit exit`);
    await scenario("preview-exit-error"); await choose("Business perspective", "Manager"); await click(page.getByRole("button", { name: "Open read-only preview", exact: true })); await page.getByText("Read-only Manager preview", { exact: true }).waitFor(); await click(page.getByRole("button", { name: "Return to Owner", exact: true })); await page.getByText("MOCK exit interrupted. Retry Return to Owner.", { exact: true }).waitFor(); assert.equal(await page.getByText("Read-only Manager preview", { exact: true }).count(), 1); await click(page.getByRole("button", { name: "Return to Owner", exact: true })); await page.getByRole("heading", { name: "Owner account — MOCK", exact: true }).waitFor(); pass(`${size} failed exit preserves preview until successful explicit retry`);
    await scenario("success");
  }
  assert.equal(evidence.externalRequests.length, 0); assert.equal(evidence.runtimeErrors.length, 0); assert.equal(evidence.consoleWarnings.length, 0);
  assert.ok(evidence.consoleErrors.every((line) => /Failed to load resource:.*status of (409|503)/.test(line)), "Only deliberate fixture HTTP failures expected");
  const missing = await page.evaluate(() => window.__previewNotices.filter((line) => line.includes("Missing MOCK") || line.includes("MOCK blocked"))); assert.equal(missing.length, 0);
  evidence.result = "PASS";
} catch (error) { evidence.result = "FAIL"; evidence.error = error.message; process.exitCode = 1; console.log(`FAIL ${error.message}`); }
finally { evidence.limitations = ["Actual browser Mock only; synthetic options/session/expiry and presentation flags", "No actual Auth identity, database filtering, session expiration, business-write guard, or RLS validated by this browser", "No cloud, paid AI, existing user browser, video, credentials, or deployment"]; await context.close(); await browser.close(); await fs.writeFile(path.join(output, technicianOnly ? "result-technician.json" : "result.json"), JSON.stringify(evidence, null, 2)); console.log(`RESULT ${evidence.result}; ${evidence.cases.length} cases; ${evidence.runtimeErrors.length} runtime errors; ${evidence.consoleErrors.length} intentional HTTP console errors; ${output}`); }
