// Actual product components with local synthetic MSW API responses only.
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.UI_PLAYWRIGHT_PATH ?? "C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const origin = "http://localhost:3200";
const output = path.resolve(process.env.UI_EVAL_OUTPUT ?? "reports/dsh-inspired-workspaces-2026-10-09/owner");
await fs.mkdir(output, { recursive: true });
const evidence = { scope: "Actual OwnerConsole, NativeAgentWorkspace, OwnerSessions and AISettingsWorkspace, fictional local MSW responses. No real Auth/database/provider/Human UAT.",
  result: "RUNNING", checks: [], measurements: [], screenshots: [], errors: [], externalRequests: [], layoutFailures: [], startedAt: new Date().toISOString() };
const browser = await chromium.launch({ headless: true, executablePath: process.env.UI_CHROMIUM_PATH ?? "C:/Users/user/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe" });
const context = await browser.newContext({ viewport: { width: 1536, height: 864 } });
await context.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (["http:", "https:"].includes(url.protocol) && url.origin !== origin) { evidence.externalRequests.push(url.origin + url.pathname); await route.abort(); }
  else await route.continue();
});
const page = await context.newPage();
page.setDefaultTimeout(12000);
page.on("pageerror", (error) => evidence.errors.push(error.message));
const watchdog = setTimeout(() => { void browser.close(); }, 150000);
const pass = (name) => { evidence.checks.push({ name, result: "PASS" }); console.log(`PASS ${name}`); };
async function visit(view = "workspace", control = "") {
  const params = new URLSearchParams({ scenario: "success" });
  if (view !== "workspace") params.set("view", view);
  if (control) params.set("ownerHistory", control);
  await page.goto(`${origin}/owner/console?${params}`);
  await page.getByRole("heading", { name: view === "sessions" ? "Sessions" : view === "settings" ? "AI Settings" : "My Workspace", exact: true }).first().waitFor();
  await page.addStyleTag({ content: '.mock-controls,.mock-footer{display:none!important}body::after{content:"MOCK DATA · fictional responses · no real Auth";position:fixed;left:8px;top:4px;padding:3px 8px;background:#fff4cc;color:#60440d;font:10px system-ui;z-index:3000;pointer-events:none}' });
  await page.evaluate(() => window.scrollTo(0, 0));
}
async function capture(name) {
  await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: false });
  evidence.screenshots.push(`${name}.png`);
}
async function chooseView(name) {
  const nav = page.getByRole("navigation", { name: "Owner Console navigation", exact: true });
  if (!await nav.isVisible()) await page.getByRole("button", { name: "Toggle console navigation", exact: true }).click();
  await nav.getByRole("button", { name, exact: true }).click();
}
async function bounds(label) {
  const measurement = await page.evaluate((name) => {
    const rect = (selector) => { const element = document.querySelector(selector); if (!element) return null; const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height, bottom: box.bottom, right: box.right }; };
    return { label: name, viewport: { width: innerWidth, height: innerHeight }, documentWidth: document.documentElement.scrollWidth,
      workspace: rect(".native-agent-embedded"), layout: rect(".native-agent-layout"), canvas: rect(".native-canvas"),
      conversation: rect(".native-conversation"), transcript: rect(".native-messages"), composer: rect(".native-composer"), input: rect("#native-agent-message"), send: rect('.native-composer [aria-label="Send message"]'),
      alerts: [...document.querySelectorAll(".native-agent-embedded > .ant-alert")].map((element) => { const box = element.getBoundingClientRect(); return { y: box.y, bottom: box.bottom, x: box.x, right: box.right, text: element.textContent }; }),
      transcriptOverflow: getComputedStyle(document.querySelector(".native-messages")).overflowY };
  }, label);
  evidence.measurements.push(measurement);
  assert(measurement.documentWidth <= measurement.viewport.width + 1, `${label}: no page horizontal overflow`);
  assert(measurement.conversation && measurement.composer && measurement.input, `${label}: embedded conversation/input rendered`);
  assert(measurement.conversation.x >= 0 && measurement.conversation.right <= measurement.viewport.width + 1, `${label}: conversation width in viewport`);
  assert(measurement.input.y >= 0 && measurement.input.bottom <= measurement.viewport.height + 1, `${label}: bottom input visible in initial viewport`);
  assert(measurement.send && measurement.send.y >= 0 && measurement.send.bottom <= measurement.viewport.height + 1 && measurement.send.bottom <= measurement.conversation.bottom + 1,
    `${label}: Send button entirely visible in panel and viewport`);
  assert(measurement.composer.y >= measurement.transcript.bottom - 1 && measurement.composer.bottom <= measurement.conversation.bottom + 1, `${label}: composer stays below transcript in conversation`);
  assert.match(measurement.transcriptOverflow, /auto|scroll/, `${label}: transcript scrolls independently`);
  if (measurement.canvas) assert(measurement.canvas.width <= measurement.layout.width + 1, `${label}: result canvas stays inside workspace`);
  for (const alert of measurement.alerts) assert(alert.bottom <= measurement.conversation.y + 1 || alert.y >= measurement.conversation.bottom - 1 || alert.right <= measurement.conversation.x + 1,
    `${label}: alert and embedded conversation do not overlap`);
  if (measurement.viewport.width > 1050) assert(measurement.layout.right <= measurement.conversation.x + 1, `${label}: desktop canvas and conversation have separate columns`);
  pass(`${label}: embedded canvas/chat sizing and bottom input visible`);
  return measurement;
}
async function verifyBounds(label) {
  try { return await bounds(label); }
  catch (error) {
    if (process.env.OWNER_LAYOUT_PROBE !== "1") throw error;
    const message = error instanceof Error ? error.message : String(error);
    evidence.layoutFailures.push(message); evidence.checks.push({ name: message, result: "FAIL" }); console.log(`FAIL ${message}`);
  }
}
async function readOnlySnapshot(label, title) {
  await page.getByRole("button", { name: new RegExp(title) }).click();
  const panel = page.getByRole("region", { name: "Session detail", exact: true });
  await panel.getByText("Historical snapshot. Current records may have changed; browsing this history does not update them.", { exact: true }).waitFor();
  assert.equal(await panel.getByRole("button", { name: /confirm|approve|execute/i }).count(), 0);
  assert.equal(await panel.getByRole("link").count(), 0);
  pass(`${label}: selected historical session is read-only`);
  return panel;
}
try {
  for (const [width, height, label] of [[1536, 864, "desktop"], [390, 844, "mobile"]]) {
    await page.setViewportSize({ width, height });
    await visit();
    await page.getByRole("textbox", { name: "Message the agent", exact: true }).waitFor();
    await capture(`${label}-workspace-initial`);
    await verifyBounds(`${label}-initial`);
    assert.equal(await page.getByRole("button", { name: "Open conversation", exact: true }).count(), 0);
    await page.getByRole("textbox", { name: "Message the agent", exact: true }).fill("Investigate MOCK-001");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await page.locator(".native-canvas").getByText("MOCK-001", { exact: true }).waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await verifyBounds(`${label}-result`);
    await capture(`${label}-workspace-result`);
    pass(`${label}: scripted native request renders recorded source canvas`);
    await page.getByRole("button", { name: "Conversation history", exact: true }).click();
    const history = page.getByRole("dialog", { name: "Your conversations", exact: true });
    await history.getByText("MOCK Owner saved inspection", { exact: true }).waitFor();
    await history.getByRole("button", { name: /MOCK Owner saved inspection/ }).click();
    await page.getByText("Historical conversation", { exact: true }).waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await capture(`${label}-workspace-history`);
    await verifyBounds(`${label}-history`);
    pass(`${label}: saved native history restores as historical conversation`);
    await visit("workspace", "warning");
    await page.getByRole("textbox", { name: "Message the agent", exact: true }).fill("Inspect the fictional order with a history save warning.");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await page.getByText("This result was not saved to conversation history.", { exact: true }).waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await capture(`${label}-workspace-history-warning`);
    await verifyBounds(`${label}-history-warning`);
    pass(`${label}: unsaved-history warning remains explicit`);
    await chooseView("Sessions");
    const sessions = page.getByRole("region", { name: "Saved AI sessions", exact: true });
    await sessions.getByRole("button", { name: /MOCK Owner saved inspection/ }).waitFor();
    assert.equal(await sessions.locator("select").count(), 0, "Workspace filter uses Ant Design Select");
    await sessions.getByRole("combobox", { name: "Workspace", exact: true }).focus();
    await sessions.getByRole("combobox", { name: "Workspace", exact: true }).press("ArrowDown");
    await page.getByRole("option", { name: "MOCK Private workspace · Owner", exact: true }).click();
    await sessions.getByRole("combobox", { name: "Workspace", exact: true }).press("Escape");
    assert.equal(await sessions.getByRole("button", { name: /MOCK Demo read-only question/ }).count(), 0);
    let panel = await readOnlySnapshot(label, "MOCK Owner saved inspection");
    await panel.getByText("MOCK recorded inspection snapshot", { exact: true }).waitFor();
    await panel.getByText(/Recorded proposal: MOCK-001/).waitFor();
    if (width < 640) await panel.evaluate((element) => window.scrollTo(0, scrollY + element.getBoundingClientRect().top - 32));
    await capture(`${label}-sessions-saved`);
    pass(`${label}: AntD workspace filter and saved proposal snapshot`);
    panel = await readOnlySnapshot(label, "MOCK Owner incomplete investigation");
    await panel.getByText("Fictional unit model is missing.", { exact: true }).waitFor();
    await panel.getByText(/Last recorded: running; outcome unconfirmed/).waitFor();
    if (width < 640) await panel.evaluate((element) => window.scrollTo(0, scrollY + element.getBoundingClientRect().top - 32));
    await capture(`${label}-sessions-sparse`);
    pass(`${label}: sparse interrupted source-only historical snapshot`);
    await chooseView("AI Settings");
    await page.locator(".ai-settings-page").waitFor();
    await page.getByRole("button", { name: /Add provider/ }).waitFor();
    await capture(`${label}-settings`);
    pass(`${label}: existing AI Settings component opens`);
    await visit("sessions", "empty");
    await page.getByText("No recorded sessions in this workspace.", { exact: true }).waitFor();
    await capture(`${label}-sessions-empty`);
    pass(`${label}: empty saved-session list`);
    await visit("sessions", "list-error-once");
    await page.getByText("Sessions could not be loaded.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Retry session list", exact: true }).click();
    await page.getByRole("button", { name: /MOCK Owner saved inspection/ }).waitFor();
    pass(`${label}: failed session list retries successfully`);
    await visit("sessions", "detail-error-once");
    await page.getByRole("button", { name: /MOCK Owner saved inspection/ }).click();
    await page.getByText("This session could not be loaded.", { exact: true }).waitFor();
    await capture(`${label}-sessions-error`);
    await page.getByRole("button", { name: "Retry session detail", exact: true }).click();
    await page.getByText("MOCK recorded inspection snapshot", { exact: true }).waitFor();
    pass(`${label}: failed selected-session detail retries successfully`);
    assert.equal(await page.getByText(/Missing MOCK|MOCK blocked|MOCK component rendering failed/).count(), 0);
  }
  assert.deepEqual(evidence.errors, [], "No uncaught rendered component errors");
  assert.deepEqual(evidence.externalRequests, [], "No attempted external HTTP requests");
  assert.deepEqual(evidence.layoutFailures, [], "Embedded layouts fit viewport without alert collisions");
  pass("No uncaught page errors or external requests");
  evidence.result = "PASS";
} catch (error) {
  evidence.result = "FAIL"; evidence.failure = error instanceof Error ? error.message : String(error);
  await capture("failure-state").catch(() => {});
  console.error(evidence.failure); process.exitCode = 1;
} finally {
  clearTimeout(watchdog); await context.close(); await browser.close();
  evidence.finishedAt = new Date().toISOString(); evidence.ownedBrowserClosed = true;
  await fs.writeFile(path.join(output, "result.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ result: evidence.result, checks: evidence.checks.length, output, failure: evidence.failure }));
}
