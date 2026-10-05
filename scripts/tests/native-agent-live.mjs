// Bounded real Guest read-only browser acceptance. Maximum two agent requests.
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium } = require("C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const origin = "http://localhost:3100";
const output = path.resolve("reports/agent-native-2026-10-05/live");
await fs.mkdir(output, { recursive: true });
const evidence = { scope: "Real Guest, shared fictional Test Demo, configured live provider, read-only", result: "RUNNING", requests: [], cases: [], errors: [], cleanup: "NOT_RUN" };
const browser = await chromium.launch({ headless: true, executablePath: "C:/Users/user/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe" });
const context = await browser.newContext({ viewport: { width: 1536, height: 864 } });
await context.addInitScript(() => {
  window.__nativeLiveResponses = [];
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    if (String(args[0]).endsWith("/agent/run")) {
      const record = { status: response.status, events: [] };
      window.__nativeLiveResponses.push(record);
      void response.clone().text().then(text => {
        record.events = text.trim().split("\n").map(line => JSON.parse(line)); record.done = true;
      }).catch(() => { record.error = "Capture failed"; record.done = true; });
    }
    return response;
  };
});
const page = await context.newPage();
page.setDefaultTimeout(60000);
page.on("pageerror", (error) => evidence.errors.push(error.message));
let entered = false;
let workspaceBase;
try {
  await page.goto(`${origin}/demo`);
  await page.getByRole("button", { name: "Continue as Guest", exact: true }).click();
  await page.waitForURL(/\/workspaces\/[^/]+\/orders/);
  entered = true;
  const base = new URL(page.url()).pathname.replace(/\/orders$/, "");
  workspaceBase = base;
  evidence.allowanceBefore = await page.getByText(/Guest AI:/).textContent().catch(() => "Unavailable");
  const remaining = Number(evidence.allowanceBefore.match(/Guest AI:\s*(\d+)\//)?.[1]);
  if (!Number.isFinite(remaining) || remaining < 4) throw new Error("Two read-and-answer requests need at least four remaining Guest provider calls. No allowance configuration is changed.");
  await page.getByRole("link", { name: /Agent Workspace/ }).click();
  await page.getByRole("textbox", { name: "Message the agent", exact: true }).fill("Read recent orders and show up to three records I should focus on today. Do not prepare any changes.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.waitForFunction(() => window.__nativeLiveResponses?.length === 1 && window.__nativeLiveResponses[0].done);
  await page.waitForFunction(() => !!document.querySelector('[data-agent-view]') || !!document.querySelector('.ant-alert-error'));
  const canvas = page.locator("[data-agent-view]");
  if (!await canvas.isVisible()) throw new Error(await page.getByRole("alert").last().textContent());
  assert.equal(await canvas.getByText("Live model", { exact: true }).count(), 1);
  evidence.cases.push({ name: "Live scoped recent-order canvas", result: "PASS", view: await canvas.getAttribute("data-agent-view") });
  await page.screenshot({ path: path.join(output, "focus.png"), fullPage: true });
  await canvas.getByRole("button", { name: "Investigate order", exact: true }).first().click();
  await page.waitForFunction(() => window.__nativeLiveResponses?.length === 2 && window.__nativeLiveResponses[1].done);
  await page.waitForFunction(() => !!document.querySelector('[data-agent-view]') || !!document.querySelector('.ant-alert-error'));
  if (!await canvas.isVisible()) throw new Error(await page.getByRole("alert").last().textContent());
  evidence.cases.push({ name: "Live follow-up retains source context", result: "PASS", view: await canvas.getAttribute("data-agent-view") });
  await page.screenshot({ path: path.join(output, "follow-up.png"), fullPage: true });
  const ordersResponse = await context.request.get(`${origin}/api${base}/orders`);
  assert.equal(ordersResponse.status(), 200);
  const actualOrders = (await ordersResponse.json()).orders;
  evidence.requests = await page.evaluate(() => window.__nativeLiveResponses);
  const records = new Map(actualOrders.map(order => [order.id, order]));
  for (const request of evidence.requests) {
    const workspace = request.events.find(event => event.type === "workspace")?.workspace;
    assert.ok(workspace && workspace.mode === "live" && workspace.status === "COMPLETE");
    assert.equal(workspace.proposal, null);
    assert.ok(workspace.items.length > 0);
    for (const item of workspace.items) {
      const actual = records.get(item.order.id);
      assert.ok(actual);
      for (const key of ["order_no", "status", "updated_at", "branch_id", "scheduled_at", "assigned_technician_id"]) assert.equal(item.order[key], actual[key]);
    }
  }
  assert.equal(evidence.requests.length, 2);
  evidence.cases.push({ name: "Both live canvases match independent current Orders API fields; no proposal", result: "PASS" });
  await page.reload();
  evidence.allowanceAfter = await page.getByText(/Guest AI:/).textContent().catch(() => "Unavailable");
  evidence.result = "PASS";
} catch (error) { evidence.result = "FAIL"; evidence.failure = error.message; console.log(`Live acceptance FAIL: ${error.message}`); }
finally {
  if (!evidence.requests.length && !page.isClosed()) evidence.requests = await page.evaluate(() => window.__nativeLiveResponses ?? []).catch(() => evidence.requests);
  if (entered) {
    try {
      const response = await context.request.post(`${origin}/api/demo/exit`, { headers: { Origin: origin }, maxRedirects: 0 });
      evidence.cleanup = response.status() === 303 ? "Guest revoked and cookie cleared" : `Exit HTTP ${response.status()}`;
      evidence.revokedSessionCheck = (await context.request.get(`${origin}/api${workspaceBase}/orders`)).status();
    } catch { evidence.cleanup = "Exit failed"; }
  }
  await context.close(); await browser.close();
  await fs.writeFile(path.join(output, "result.json"), `${JSON.stringify(evidence, null, 2)}\n`);
}
console.log(JSON.stringify({ result: evidence.result, cases: evidence.cases, cleanup: evidence.cleanup, allowanceBefore: evidence.allowanceBefore, allowanceAfter: evidence.allowanceAfter }));
if (evidence.result !== "PASS") process.exitCode = 1;
