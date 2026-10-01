// Actual preview panel + document navigation; all server responses are synthetic.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve("vitest/package.json"));
const { createServer } = await import(pathToFileURL(viteRequire.resolve("vite")).href);
const root = process.cwd();
const base = (await import(pathToFileURL(path.join(root, "tests/ui-browser/vite.config.mjs")).href)).default;
const origin = "http://localhost:3200";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const employeeId = "22222222-2222-4222-8222-222222222222";
const ordersPath = `/workspaces/${workspaceId}/orders`;
let preview = null;
let failEntry = false;
let failExit = false;
const evidence = { scope: "Actual OwnerPreviewPanel + fixed document navigation; synthetic local API and page shells", cases: [], documents: [], apiCalls: { POST: 0, DELETE: 0 }, externalRequests: 0, runtimeErrors: 0, consoleErrors: 0, expectedHttpErrors: 0, consoleWarnings: 0, result: "RUNNING" };
const entry = `import React from "react";import {createRoot} from "react-dom/client";import {OwnerPreviewPanel} from "/@fs/${root.replaceAll("\\", "/")}/src/components/admin/owner-preview/owner-preview-panel.tsx";createRoot(document.getElementById("root")).render(React.createElement(OwnerPreviewPanel,{workspaceId:${JSON.stringify(workspaceId)}}));`;
const server = await createServer({ ...base, configFile: false, plugins: [{ name: "synthetic-preview-document-server", enforce: "pre",
  resolveId(source) { if (source === "/preview-document-entry.js") return "\0preview-document-entry.js"; },
  load(source) { if (source === "\0preview-document-entry.js") return entry; },
  configureServer(vite) { vite.middlewares.use(async (request, response, next) => {
    const pathname = new URL(request.url, origin).pathname;
    if (pathname === "/owner" || pathname === ordersPath) {
      response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(`<!doctype html><html><body><h1>${pathname === "/owner" ? "Owner account — MOCK" : "Orders — MOCK"}</h1><div id="root"></div><script type="module" src="/preview-document-entry.js"></script></body></html>`); return;
    }
    if (pathname !== "/api/platform/owner-preview") { next(); return; }
    response.setHeader("Content-Type", "application/json"); response.setHeader("Cache-Control", "no-store");
    if (request.method === "POST" || request.method === "DELETE") { evidence.apiCalls[request.method]++; await new Promise((resolve) => setTimeout(resolve, 600)); }
    if ((request.method === "POST" && failEntry) || (request.method === "DELETE" && failExit)) { failEntry = false; failExit = false; response.statusCode = 503; response.end(JSON.stringify({ error: { code: "SYNTHETIC_FAILURE", message: "Synthetic request interrupted. Retry." } })); return; }
    if (request.method === "GET") { response.end(JSON.stringify({ technicians: [{ profileId: employeeId, name: "Synthetic Technician", branchCode: "MOCK" }], preview })); return; }
    if (request.method === "POST") { let body = ""; for await (const chunk of request) body += chunk; const input = JSON.parse(body); preview = { previewId: workspaceId, role: input.role, effectiveEmployeeProfileId: input.employeeProfileId, effectiveEmployeeName: input.role === "TECHNICIAN" ? "Synthetic Technician" : null, readOnly: true }; }
    else if (request.method === "DELETE") preview = null;
    else { response.statusCode = 405; response.end("{}"); return; }
    response.end(JSON.stringify({ preview }));
  }); },
}, ...base.plugins.filter((plugin) => plugin.name !== "synthetic-owner-preview-navigation")] });
let browser;
try {
  await server.listen();
  const { chromium } = require("C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
  browser = await chromium.launch({ headless: true, executablePath: "C:/Users/user/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe" });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.route("**/*", async (route) => { const url = new URL(route.request().url()); if (["http:", "https:"].includes(url.protocol) && url.origin !== origin) { evidence.externalRequests++; await route.abort(); } else await route.continue(); });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on("request", (request) => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) evidence.documents.push(new URL(request.url()).pathname); });
  page.on("pageerror", () => evidence.runtimeErrors++); page.on("console", (message) => { if (message.type() === "warning") evidence.consoleWarnings++; if (message.type() === "error") { if (/Failed to load resource:.*status of 503/.test(message.text())) evidence.expectedHttpErrors++; else evidence.consoleErrors++; } });
  const click = async (locator) => { await locator.click(); await page.waitForTimeout(700); };
  const choose = async (label, value) => { await click(page.getByRole("combobox", { name: label, exact: true }).locator('xpath=ancestor::div[contains(@class,"ant-select-selector")][1]')); await click(page.locator(".ant-select-item-option-content").getByText(value, { exact: true })); };
  const ready = async () => { await page.getByRole("button", { name: "Open read-only preview", exact: true }).waitFor(); };
  await page.goto(`${origin}/owner`); await ready();
  for (const [width, height] of [[1280, 720], [390, 844]]) {
    await page.setViewportSize({ width, height });
    for (const role of ["Manager", "Technician"]) {
      await choose("Business perspective", role); if (role === "Technician") await choose("Technician employee", "Synthetic Technician (MOCK)");
      const before = evidence.documents.length; const beforeSet = evidence.apiCalls.POST; const beforeExit = evidence.apiCalls.DELETE;
      await page.getByRole("button", { name: "Open read-only preview", exact: true }).dblclick(); await page.waitForTimeout(700);
      await page.waitForURL(`${origin}${ordersPath}`); await page.getByText(`Read-only ${role} preview${role === "Technician" ? " · Synthetic Technician" : ""}`, { exact: true }).waitFor();
      assert.equal(evidence.documents.length, before + 1); assert.equal(evidence.documents.at(-1), ordersPath);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), true);
      await page.getByRole("button", { name: "Return to Owner", exact: true }).dblclick(); await page.waitForTimeout(700); await page.waitForURL(`${origin}/owner`); await page.getByRole("heading", { name: "Owner account — MOCK", exact: true }).waitFor();
      assert.equal(evidence.documents.length, before + 2); assert.equal(evidence.documents.at(-1), "/owner"); assert.equal(await page.getByText(/^Read-only .* preview/).count(), 0);
      assert.equal(evidence.apiCalls.POST, beforeSet + 1); assert.equal(evidence.apiCalls.DELETE, beforeExit + 1);
      evidence.cases.push({ name: `${width}x${height} ${role} fresh orders/Owner documents and double-submit once`, result: "PASS", documentReloads: 2, posts: 1, exits: 1 });
    }
  }
  failEntry = true; const beforeFailure = evidence.documents.length; await click(page.getByRole("button", { name: "Open read-only preview", exact: true })); await page.getByText("Synthetic request interrupted. Retry.", { exact: true }).waitFor(); assert.equal(evidence.documents.length, beforeFailure);
  await click(page.getByRole("button", { name: "Open read-only preview", exact: true })); await page.waitForURL(`${origin}${ordersPath}`); failExit = true; const beforeExitFailure = evidence.documents.length; await click(page.getByRole("button", { name: "Return to Owner", exact: true })); await page.getByText("Synthetic request interrupted. Retry.", { exact: true }).waitFor(); assert.equal(evidence.documents.length, beforeExitFailure);
  await click(page.getByRole("button", { name: "Return to Owner", exact: true })); await page.waitForURL(`${origin}/owner`); evidence.cases.push({ name: "failed entry/exit retain document; successful explicit retries navigate", result: "PASS" });
  assert.equal(evidence.externalRequests, 0); assert.equal(evidence.runtimeErrors, 0); assert.equal(evidence.consoleErrors, 0); assert.equal(evidence.consoleWarnings, 0); evidence.result = "PASS"; await context.close();
} catch (error) { evidence.result = "FAIL"; evidence.error = error.message; process.exitCode = 1; }
finally { await browser?.close(); await server.close(); evidence.limitations = ["Synthetic local API and page shells only; actual preview component/document requests verified", "No actual Auth, SSR actor, Test database, RLS, provider or human acceptance verified", "No secrets, screenshots, recordings or existing user browser"]; const directory = path.join(root, "reports/artifacts/2026-10-01-owner-preview-document-mock"); await fs.mkdir(directory, { recursive: true }); await fs.writeFile(path.join(directory, "result.json"), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence)); console.log("OWNED_BROWSER_AND_SERVER_CLOSED"); }
