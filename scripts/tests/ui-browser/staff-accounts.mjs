// Opt-in, isolated headless browser verification. All product data/APIs are MSW fixtures.
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require("C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const origin = "http://localhost:3200";
const output = path.resolve("reports/artifacts/2026-10-01-staff-mock");
await fs.mkdir(output, { recursive: true });
const evidence = { scope: "Actual Ant Design staff UI; synthetic MSW API + mocked template navigation; no Auth/DB/AI", runtime: "Playwright 1.62.1 isolated Chromium headless", cases: [], screenshots: [], externalRequests: [], runtimeErrors: [], consoleErrors: [], consoleWarnings: [], viewports: [] };
const redact = (value) => String(value).replace(/SYNTHETIC-ONLY-[A-Za-z0-9-]+/g, "[redacted synthetic credential]");
const browser = await chromium.launch({ headless: true, executablePath: "C:/Users/user/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe" });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: "allow" });
await context.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (["http:", "https:"].includes(url.protocol) && url.origin !== origin) {
    evidence.externalRequests.push(`${url.origin}${url.pathname}`); await route.abort("blockedbyclient");
  } else if (url.pathname === "/api/platform/staff/import/template") {
    // MSW bypasses browser navigation requests. This local download is a synthetic
    // Playwright fixture too; it does not invoke the real template route.
    await route.fulfill({ status: 200, headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": 'attachment; filename="mock-staff-template.xlsx"', "Cache-Control": "no-store" }, body: "SYNTHETIC MOCK XLSX TEMPLATE" });
  } else await route.continue();
});
const page = await context.newPage();
page.setDefaultTimeout(20000);
page.on("pageerror", (error) => evidence.runtimeErrors.push(redact(error.message)));
page.on("console", (message) => { if (message.type() === "error") evidence.consoleErrors.push(redact(message.text())); if (message.type() === "warning") evidence.consoleWarnings.push(redact(message.text())); });
await page.addInitScript(() => {
  window.__staffMockNotices = [];
  window.addEventListener("mock-api-notice", (event) => window.__staffMockNotices.push(String(event.detail)));
});
const pause = () => page.waitForTimeout(1000);
const click = async (locator) => { await locator.click(); await pause(); };
const fill = async (locator, value) => { await locator.fill(value); await pause(); };
const dialog = (name) => page.getByRole("dialog", { name, exact: true });
const employeeRow = (name) => page.getByRole("row").filter({ has: page.getByText(name, { exact: true }) });
const modalPresent = async (name) => await dialog(name).isVisible().catch(() => false);
const casePassed = (name) => { evidence.cases.push({ name, result: "PASS" }); console.log(`PASS ${name}`); };
const countRequests = async (method, suffix) => page.evaluate(({ method, suffix }) => window.__staffMockNotices.filter((notice) => notice.startsWith(`${method} /api/platform/staff${suffix} →`)).length, { method, suffix });
const clearSecrets = async () => { const secrets = dialog("Temporary login credentials"); await secrets.waitFor(); assert.equal(await secrets.locator("code").count() > 0, true, "Temporary credential must be rendered"); await click(secrets.getByRole("button", { name: "Close and clear passwords", exact: true })); await secrets.waitFor({ state: "hidden" }); assert.equal(await page.locator(".ant-modal code").count(), 0, "Credential content must be cleared"); };
const shot = async (name) => {
  assert.equal(await modalPresent("Temporary login credentials"), false, "Never screenshot a credential modal");
  assert.equal(await page.locator(".ant-modal code").count(), 0, "Never screenshot credential content");
  const filename = `${name}.png`; await page.screenshot({ path: path.join(output, filename), fullPage: await page.getByRole("dialog").count() === 0 }); evidence.screenshots.push(filename);
};
const layout = async (label) => {
  const dimensions = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth, tableScrollable: [...document.querySelectorAll(".ant-table-content")].some((element) => element.scrollWidth > element.clientWidth), overflowElements: [...document.querySelectorAll("body *")].filter((element) => { const box = element.getBoundingClientRect(); return box.width > 0 && box.right > window.innerWidth + 2 && getComputedStyle(element).position !== "fixed" && !element.closest(".ant-table-content,.ant-select-dropdown,.ant-modal-wrap"); }).slice(0, 10).map((element) => `${element.tagName}.${element.className}`) }));
  evidence.viewports.push({ label, ...dimensions }); assert.ok(dimensions.document <= dimensions.viewport + 2, `${label}: document overflows viewport`);
};
const scenario = async (value) => { await page.getByLabel("Mock scenario", { exact: true }).selectOption(value); await pause(); await page.getByRole("heading", { name: "Staff accounts", exact: true }).waitFor(); };
const upload = async (name = "valid.xlsx") => { await page.getByLabel("Staff workbook (.xlsx)", { exact: true }).setInputFiles({ name, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from("SYNTHETIC MOCK FILE: no real XLSX parsing") }); await pause(); };
const choose = async (label, option) => { await click(page.getByLabel(label, { exact: true }).locator('xpath=ancestor::div[contains(@class,"ant-select-selector")][1]')); await click(page.locator(".ant-select-item-option-content").getByText(option, { exact: true })); };

try {
  await page.goto(`${origin}/workspaces/mock/staff`); await page.getByText("Synthetic Alex", { exact: true }).waitFor(); await pause();
  await layout("desktop 1280x720 staff list"); await shot("desktop-list"); casePassed("desktop populated list, long employee labels and branch/onboarding states");

  if (!process.argv.includes("--import-only")) {
  await click(page.getByRole("button", { name: "Create staff account", exact: true }));
  const create = dialog("Create staff account"); await click(create.getByRole("button", { name: "Create account", exact: true })); await create.getByText("Please enter Employee name", { exact: true }).waitFor();
  await fill(create.getByLabel("Employee name", { exact: true }), "Synthetic Created Manager"); await fill(create.getByLabel("Employee email", { exact: true }), "created-manager@example.invalid"); await choose("Business role", "Manager");
  const createsBefore = await countRequests("POST", ""); await create.getByRole("button", { name: "Create account", exact: true }).dblclick(); await pause(); await clearSecrets();
  assert.equal(await countRequests("POST", ""), createsBefore + 1, "Double click must create once"); await employeeRow("Synthetic Created Manager").getByText("MANAGER", { exact: true }).waitFor(); await shot("desktop-created-manager"); casePassed("create validation, explicit Manager create, duplicate submit guard, credential close clears content");

  await click(page.getByRole("button", { name: "Edit Synthetic Alex", exact: true })); await choose("Business role", "Technician");
  const edit = dialog("Edit Synthetic Alex"); await click(edit.getByRole("button", { name: "Save changes", exact: true })); await edit.getByText("Choose a branch for this Technician.", { exact: true }).waitFor();
  await choose("Technician branch", "Synthetic South workshop (MOCK_SOUTH)"); await click(edit.getByRole("button", { name: "Save changes", exact: true }));
  await employeeRow("Synthetic Alex").getByText("Synthetic South workshop", { exact: true }).waitFor(); casePassed("edit Admin to Technician requires branch and persists selected branch");

  await click(page.getByRole("button", { name: "Edit Synthetic Alex", exact: true })); await click(dialog("Edit Synthetic Alex").getByRole("switch", { name: "Account active", exact: true }));
  const updatesBefore = await countRequests("PATCH", "/mock-admin"); await click(dialog("Edit Synthetic Alex").getByRole("button", { name: "Save changes", exact: true }));
  const disable = dialog("Disable employee access?"); await disable.waitFor(); assert.equal(await countRequests("PATCH", "/mock-admin"), updatesBefore, "Opening disable confirmation must not update"); await click(disable.getByRole("button", { name: "Confirm disable", exact: true }));
  await employeeRow("Synthetic Alex").getByText("Disabled", { exact: true }).waitFor(); casePassed("disable access requires second explicit confirmation");

  const resetsBefore = await countRequests("POST", "/mock-admin/password"); await click(page.getByRole("button", { name: "Reset temporary password for Synthetic Alex", exact: true }));
  const reset = dialog("Reset temporary password for Synthetic Alex?"); await reset.getByText(/All previous sessions become invalid/).waitFor(); assert.equal(await countRequests("POST", "/mock-admin/password"), resetsBefore, "Reset explanation must precede request");
  await click(reset.getByRole("button", { name: "Reset password", exact: true })); await clearSecrets(); await shot("desktop-access-reset-complete"); casePassed("explicit reset explanation and action; credential modal closed before screenshot");

  const downloadPromise = page.waitForEvent("download"); await click(page.getByRole("link", { name: "Download .xlsx template", exact: true })); const download = await downloadPromise; assert.equal(download.suggestedFilename(), "mock-staff-template.xlsx"); casePassed("synthetic template download only, no real XLSX parser/serializer claim");
  // A navigation download can unregister this MSW client via beforeunload.
  // Restore fixture interception before the next independent browser scenario.
  await page.reload(); await page.getByText("Synthetic Alex", { exact: true }).waitFor(); await pause();
  }
  await upload("invalid.xlsx"); const review = dialog("Review staff import"); await review.getByText("Technicians need a branch code.", { exact: true }).waitFor(); assert.equal(await review.getByRole("button", { name: "Confirm import", exact: true }).isDisabled(), true); await shot("desktop-invalid-import"); await click(review.getByRole("button", { name: "Cancel import", exact: true })); casePassed("invalid import preview blocks confirmation and cancel discards preview");

  await scenario("staff-partial"); await upload(); const partial = dialog("Review staff import"); const confirmsBefore = await countRequests("POST", "/import/confirm");
  await pause(); assert.equal(await countRequests("POST", "/import/confirm"), confirmsBefore, "Preview must not auto-confirm"); await click(partial.getByRole("button", { name: "Confirm import", exact: true })); await clearSecrets();
  await partial.getByText("Import finished: 1 successful · 1 failed.", { exact: true }).waitFor(); assert.equal(await countRequests("POST", "/import/confirm"), confirmsBefore + 2); await shot("desktop-partial-import");
  await click(partial.getByRole("button", { name: "Retry failed rows", exact: true })); await clearSecrets(); await partial.getByText("Import finished: 2 successful · 0 failed.", { exact: true }).waitFor(); await click(partial.getByRole("button", { name: "Close import", exact: true })); casePassed("preview requires explicit confirm; sequential batches report partial failure; explicit failed-row retry succeeds");

  await scenario("staff-slow-import"); await upload(); const slow = dialog("Review staff import"); const slowBefore = await countRequests("POST", "/import/confirm"); await click(slow.getByRole("button", { name: "Confirm import", exact: true }));
  await slow.getByRole("status").waitFor(); await click(slow.getByRole("button", { name: "Stop after current batch", exact: true })); await clearSecrets();
  await slow.getByText("Import stopped after the current batch. Completed accounts remain created.", { exact: true }).waitFor(); assert.equal(await countRequests("POST", "/import/confirm"), slowBefore + 1); await shot("desktop-stopped-import");
  await click(slow.getByRole("button", { name: "Resume import", exact: true })); await clearSecrets(); await slow.getByText("Import finished: 12 successful · 0 failed.", { exact: true }).waitFor(); await click(slow.getByRole("button", { name: "Close import", exact: true })); casePassed("slow import exposes progress; stop waits in-flight batch and retains credentials; explicit resume processes remaining rows");

  await scenario("staff-preview-retry"); await upload(); await page.getByText("MOCK validation temporarily unavailable. Retry validation.", { exact: true }).waitFor(); await click(page.getByRole("button", { name: "Retry validation", exact: true })); await dialog("Review staff import").waitFor(); await click(dialog("Review staff import").getByRole("button", { name: "Cancel import", exact: true })); casePassed("preview service failure and explicit validation retry");
  await scenario("staff-import-retry"); await upload(); const retry = dialog("Review staff import"); await click(retry.getByRole("button", { name: "Confirm import", exact: true })); await retry.getByText("MOCK batch temporarily unavailable. Resume import.", { exact: true }).waitFor(); await click(retry.getByRole("button", { name: "Resume import", exact: true })); await clearSecrets(); await retry.getByText("Import finished: 2 successful · 0 failed.", { exact: true }).waitFor(); await click(retry.getByRole("button", { name: "Close import", exact: true })); casePassed("batch error pauses confirmation; explicit resume reuses saved import");

  await scenario("empty"); await page.getByText("No staff accounts yet", { exact: true }).waitFor(); await shot("desktop-empty"); casePassed("empty accounts state");
  await page.getByLabel("Mock scenario", { exact: true }).selectOption("server-error"); await pause(); await page.getByText("Staff accounts could not be loaded", { exact: true }).waitFor(); await click(page.getByRole("button", { name: "Retry", exact: true })); await page.getByText("Staff accounts could not be loaded", { exact: true }).waitFor(); casePassed("staff list service error and explicit retry retain useful failure");
  await scenario("success"); await click(page.getByRole("button", { name: "Create staff account", exact: true })); await fill(dialog("Create staff account").getByLabel("Employee name", { exact: true }), "Cancelled synthetic input"); await click(dialog("Create staff account").getByRole("button", { name: "Cancel", exact: true })); await click(page.getByRole("button", { name: "Create staff account", exact: true })); assert.equal(await dialog("Create staff account").getByLabel("Employee name", { exact: true }).inputValue(), ""); await click(dialog("Create staff account").getByRole("button", { name: "Cancel", exact: true })); casePassed("cancelled create form reopens empty");

  await page.getByLabel("Mock scenario", { exact: true }).selectOption("delayed"); await pause(); await page.getByRole("status", { name: "Loading staff accounts", exact: true }).waitFor(); await click(page.getByRole("button", { name: "Orders", exact: true })); await click(page.getByRole("button", { name: "Staff", exact: true })); await page.getByRole("heading", { name: "Staff accounts", exact: true }).waitFor(); await page.waitForTimeout(6500); assert.equal(await page.locator(".mock-fatal").count(), 0); await scenario("success"); casePassed("slow list navigation away/back renders current staff screen without late error");

  await page.setViewportSize({ width: 390, height: 844 }); await pause(); await layout("narrow 390x844 staff list"); await shot("narrow-list");
  await click(page.getByRole("button", { name: "Create staff account", exact: true })); await fill(dialog("Create staff account").getByLabel("Employee name", { exact: true }), "Synthetic Narrow Manager"); await fill(dialog("Create staff account").getByLabel("Employee email", { exact: true }), "narrow-manager@example.invalid"); await choose("Business role", "Manager"); await layout("narrow 390x844 create editor"); await shot("narrow-create-editor"); await click(dialog("Create staff account").getByRole("button", { name: "Create account", exact: true })); await clearSecrets(); await employeeRow("Synthetic Narrow Manager").getByText("MANAGER", { exact: true }).waitFor(); await shot("narrow-created-manager");
  await upload("invalid.xlsx"); await dialog("Review staff import").getByText("Row 2: Technicians need a branch code.", { exact: true }).waitFor(); await layout("narrow 390x844 import preview"); await shot("narrow-invalid-import"); await click(dialog("Review staff import").getByRole("button", { name: "Cancel import", exact: true })); casePassed("390x844 table horizontal scroll, usable Manager editor and visible invalid-row detail");

  assert.equal(evidence.externalRequests.length, 0, "All requests must remain local"); assert.equal(evidence.runtimeErrors.length, 0, "No browser runtime errors expected");
  evidence.expectedMock503ConsoleErrors = evidence.consoleErrors.filter((message) => /Failed to load resource:.*status of 503/.test(message)).length;
  assert.equal(evidence.expectedMock503ConsoleErrors, evidence.consoleErrors.length, "Only explicit mock 503 failure scenarios may log HTTP resource errors");
  const missing = await page.evaluate(() => window.__staffMockNotices.filter((notice) => notice.includes("Missing MOCK") || notice.includes("MOCK blocked"))); assert.equal(missing.length, 0, "Every product API must have a mock handler");
  evidence.result = "PASS";
} catch (error) { evidence.result = "FAIL"; evidence.error = redact(error.message); evidence.lastNotices = await page.evaluate(() => window.__staffMockNotices.slice(-8)); evidence.visibleFeedback = (await page.locator(".ant-alert-message").allTextContents()).map(redact); process.exitCode = 1; console.log(`FAIL ${evidence.error}`); console.log("SAFE diagnostics", JSON.stringify({ notices: evidence.lastNotices, feedback: evidence.visibleFeedback })); }
finally {
  evidence.limitations = ["Browser Mock only; no real Auth/permissions/database/transactions", "Template navigation uses Playwright fixture because MSW bypasses navigation; upload uses MSW fixture; no XLSX parsing/serialization verified", "No paid provider, existing user browser, video, credential screenshot or production deployment", "Mock navigation verifies actual UI lifecycle; live workspace/session isolation requires separate integration evidence"];
  await context.close(); await browser.close(); await fs.writeFile(path.join(output, "result.json"), JSON.stringify(evidence, null, 2)); console.log(`RESULT ${evidence.result}; ${evidence.cases.length} cases; ${evidence.runtimeErrors.length} runtime errors; ${evidence.consoleErrors.length} console errors; report ${path.join(output, "result.json")}`);
}
