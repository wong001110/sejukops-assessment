// Opt-in integration regression: requires an explicitly authorized local Test server.
// Creates and revokes one Guest visit. Model response is mocked; no paid model calls.
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.UAT_PLAYWRIGHT_PATH || "playwright");
const origin = process.env.UAT_ORIGIN;
const orderNo = process.env.UAT_ORDER_NO;
if (!origin || !orderNo || !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) throw Error("Set authorized loopback UAT_ORIGIN and fictional UAT_ORDER_NO");
const output = path.resolve(process.env.UAT_OUTPUT || ".agent/order-navigation.local.recording");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.UAT_CHROMIUM_PATH });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: output, size: { width: 1280, height: 720 } } });
const page = await context.newPage();
page.setDefaultTimeout(30000);
const pause = () => page.waitForTimeout(2200);
const evidence = { scope: "real Next/Guest session; mocked model failure; no business writes", modelRequests: 0, checkpoints: [] };
try {
  await page.route("**/api/workspaces/*/agent/orders", async route => {
    evidence.modelRequests++;
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "UAT scripted model unavailable" }) });
  });
  await page.goto(`${origin}/demo`);
  await pause();
  await page.getByRole("button", { name: "Continue as Guest", exact: true }).click();
  const item = page.locator("article").filter({ has: page.getByText(orderNo, { exact: true }) });
  await item.getByRole("button", { name: "View details", exact: true }).waitFor();
  await pause();
  await item.getByRole("button", { name: "View details", exact: true }).click();
  await pause();
  const selected = new URL(page.url()).searchParams.get("orderId");
  if (!selected) throw Error("Selection did not update URL");
  await page.getByRole("button", { name: /Check orders/ }).click();
  await page.waitForTimeout(6000);
  if (evidence.modelRequests !== 1 || new URL(page.url()).searchParams.get("orderId") !== selected) throw Error("Guest AI refresh lost selection");
  evidence.checkpoints.push({ label: "after AI failure and router refresh", url: page.url() });
  await page.screenshot({ path: path.join(output, "refresh-retains-order.png") });
  await pause();
  await page.getByLabel("Perspective", { exact: true }).selectOption("MANAGER");
  await pause();
  await page.getByRole("button", { name: "Switch", exact: true }).click();
  await page.getByRole("heading", { name: orderNo, exact: true }).waitFor();
  await pause();
  if (new URL(page.url()).searchParams.get("orderId") !== selected) throw Error("Perspective switch lost selection");
  evidence.checkpoints.push({ label: "Manager retains order detail", url: page.url() });
  await page.screenshot({ path: path.join(output, "manager-retains-order.png") });
  evidence.result = "PASS";
} catch (error) { evidence.result = "FAIL"; evidence.error = error.message; process.exitCode = 1; }
finally {
  try { await pause(); await page.getByRole("button", { name: "Leave Demo", exact: true }).click(); await page.getByRole("button", { name: "Continue as Guest", exact: true }).waitFor(); evidence.visitRevoked = true; }
  catch { evidence.visitRevoked = false; process.exitCode = 1; }
  await context.close();
  evidence.video = await page.video().path();
  await browser.close();
  await fs.writeFile(path.join(output, "result.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
}
