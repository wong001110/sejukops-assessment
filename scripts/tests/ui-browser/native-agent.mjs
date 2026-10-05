// Actual Agent Workspace UI with synthetic, in-memory NDJSON responses.
// This verifies browser presentation and controls only; it does not call Supabase or a model provider.
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require("C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const origin = "http://localhost:3200";
const output = path.resolve("reports/agent-native-2026-10-05/mock");
await fs.mkdir(output, { recursive: true });
const evidence = {
  scope: "Actual Agent Workspace React UI with fictional in-memory MSW NDJSON and proposal responses",
  runtime: "Playwright isolated headless Chromium",
  result: "RUNNING",
  cases: [], screenshots: [], viewports: [], runtimeErrors: [], consoleErrors: [], consoleWarnings: [], externalRequests: [], agentRequests: [], proposalRequests: [],
};
const browser = await chromium.launch({ headless: true,
  executablePath: "C:/Users/user/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe" });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: "allow" });
await context.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (["http:", "https:"].includes(url.protocol) && url.origin !== origin) {
    evidence.externalRequests.push(`${url.origin}${url.pathname}`);
    await route.abort("blockedbyclient");
  } else await route.continue();
});
const page = await context.newPage();
page.setDefaultTimeout(12000);
page.on("pageerror", (error) => evidence.runtimeErrors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") evidence.consoleErrors.push(message.text());
  if (message.type() === "warning") evidence.consoleWarnings.push(message.text());
});
page.on("request", (request) => {
  const url = new URL(request.url());
  if (url.pathname.endsWith("/agent/run") && request.method() === "POST") {
    try { evidence.agentRequests.push({ body: request.postDataJSON(), at: Date.now() }); } catch { evidence.agentRequests.push({ body: null, at: Date.now() }); }
  }
  if (url.pathname.includes("/assignment-proposals")) evidence.proposalRequests.push({ method: request.method(), path: url.pathname, body: request.postData() });
});
await page.addInitScript(() => { window.__nativeAgentXss = undefined; });

const pass = (name) => { evidence.cases.push({ name, result: "PASS" }); console.log(`PASS ${name}`); };
const openConversation = async () => {
  const input = page.getByRole("textbox", { name: "Message the agent", exact: true });
  if (await input.isVisible().catch(() => false)) return;
  await page.getByRole("button", { name: "Open conversation", exact: true }).click();
  await input.waitFor({ state: "visible" });
};
const send = async (prompt, options = {}) => {
  await openConversation();
  const input = page.getByRole("textbox", { name: "Message the agent", exact: true });
  await input.fill(prompt);
  const button = page.getByRole("button", { name: "Send message", exact: true });
  if (options.double) await button.dblclick(); else await button.click();
};
const canvas = () => page.getByRole("region", { name: "Adaptive workspace", exact: true });
const conversation = () => page.getByRole("region", { name: "Agent conversation", exact: true });
const viewIs = async (type) => {
  await canvas().waitFor();
  await page.waitForFunction((expected) => document.querySelector('[aria-label="Adaptive workspace"]')?.getAttribute("data-agent-view") === expected, type);
};
const scenario = async (name) => page.getByRole("combobox", { name: "Mock scenario", exact: true }).selectOption(name);
const freshThread = async () => {
  await openConversation();
  const button = page.getByRole("button", { name: "New conversation", exact: true });
  if (await button.count()) await button.click();
  await page.getByRole("textbox", { name: "Message the agent", exact: true }).waitFor();
};
const shot = async (name) => {
  assert.equal(await page.getByRole("dialog", { name: /credential|provider/i }).count(), 0, "No credentials should appear in evidence");
  const file = `${name}.png`;
  await page.screenshot({ path: path.join(output, file), fullPage: true });
  evidence.screenshots.push(file);
};
const layout = async (label) => {
  const measured = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
  evidence.viewports.push({ label, ...measured });
  assert.ok(measured.document <= measured.viewport + 2, `${label}: horizontal overflow (${measured.document}/${measured.viewport})`);
};
const softError = async () => {
  const alert = page.getByRole("alert").filter({ hasText: /Request not completed|unavailable|allowance|could not/i }).first();
  await alert.waitFor({ state: "visible" });
  return alert.innerText();
};

try {
  await page.goto(`${origin}/workspaces/10000000-0000-4000-8000-000000000001/agent`);
  await page.getByRole("heading", { name: "Agent Workspace", exact: true }).waitFor();
  await conversation().waitFor();
  await page.getByRole("textbox", { name: "Message the agent", exact: true }).waitFor();

  for (const [width, height, label] of [[1280, 720, "desktop"], [390, 844, "narrow"]]) {
    await page.setViewportSize({ width, height });
    await send("What should I focus on today?"); await viewIs("focus");
    await layout(`${label} focus`); await shot(`${label}-focus`);
    if (label === "desktop") {
      const composer = await page.getByRole("textbox", { name: "Message the agent", exact: true }).boundingBox();
      assert.ok(composer && composer.y >= 0 && composer.y + composer.height <= height,
        "Desktop composer should stay inside the 720px viewport");
    }
    await freshThread();
    await send("Investigate MOCK-001"); await viewIs("investigation");
    if (label === "desktop") await shot("desktop-investigation");
    await freshThread();
    await send("Compare MOCK-001 and MOCK-002"); await viewIs("comparison");
    if (label === "desktop") await shot("desktop-comparison");
    await freshThread();
    await send("Find published knowledge for filter inspection"); await viewIs("knowledge");
    await freshThread();
    await send("I am unsure which order; please clarify"); await viewIs("clarification");
    await layout(`${label} all five adaptive views`);
    if (label === "narrow") {
      assert.equal(await canvas().isVisible(), true, "Completed narrow result should remain visible while the conversation minimizes");
      assert.equal(await conversation().isVisible().catch(() => false), false, "Completed narrow run should minimize the conversation dock");
      await openConversation();
      assert.equal(await conversation().getByText("I am unsure which order; please clarify", { exact: true }).count(), 1,
        "Reopening on narrow screens should preserve the conversation");
    }
    pass(`${label} focus, investigation, comparison, knowledge, clarification render in the single adaptive canvas`);
  }

  await page.setViewportSize({ width: 1280, height: 720 });
  await freshThread();
  await send("Review MOCK-001"); await viewIs("investigation");
  const priorCount = evidence.agentRequests.length;
  await send("Does that order need follow-up?"); await viewIs("investigation");
  const followup = evidence.agentRequests.at(-1)?.body;
  assert.ok(Array.isArray(followup?.contextOrderIds) && followup.contextOrderIds.includes("50000000-0000-4000-8000-000000000001"), "Follow-up should carry the focused order ID");
  assert.ok(Array.isArray(followup?.conversation) && followup.conversation.length > 0, "Follow-up should carry bounded conversation context");
  assert.equal(evidence.agentRequests.length, priorCount + 1);
  await send("Compare MOCK-001 and MOCK-002"); await viewIs("comparison");
  const comparisonRequest = evidence.agentRequests.at(-1)?.body;
  assert.ok(Array.isArray(comparisonRequest?.contextOrderIds) && comparisonRequest.contextOrderIds.length === 1,
    "Comparison follow-up fixture should include the previously focused order");
  await canvas().getByRole("columnheader", { name: "MOCK-001", exact: true }).waitFor();
  await canvas().getByRole("columnheader", { name: "MOCK-002", exact: true }).waitFor();
  await page.getByRole("button", { name: "New conversation", exact: true }).click();
  assert.equal(await conversation().getByText("Compare MOCK-001 and MOCK-002", { exact: true }).count(), 0);
  assert.equal(await canvas().getAttribute("data-agent-view"), null, "New conversation should clear the prior result context");
  await send("What should I focus on today?"); await viewIs("focus");
  const newThreadRequest = evidence.agentRequests.at(-1)?.body;
  assert.deepEqual(newThreadRequest?.contextOrderIds, [], "New thread should not retain the old order context");
  assert.deepEqual(newThreadRequest?.conversation, [], "New thread should not retain prior turns");
  pass("follow-up sends current order context and bounded history; new conversation clears transcript and canvas");

  const beforeDoubleSubmit = evidence.agentRequests.length;
  await send("Review MOCK-001", { double: true });
  await viewIs("investigation");
  assert.equal(evidence.agentRequests.length, beforeDoubleSubmit + 1, "Double submit must issue one request");
  pass("double submit is guarded");

  await scenario("server-error");
  await send("What should I focus on today?");
  await softError();
  await scenario("success");
  const retry = page.getByRole("button", { name: /retry/i }).first();
  if (await retry.count()) { await retry.click(); await viewIs("focus"); }
  else { await send("What should I focus on today?"); await viewIs("focus"); }
  await scenario("quota-exhausted");
  await freshThread(); await send("Find published knowledge"); await softError();
  pass("server error, retry/recovery, and quota error are visible and recoverable");

  await scenario("delayed"); await freshThread();
  await send("[[delay]] inspect a slow response", { wait: false });
  const cancel = page.getByRole("button", { name: "Cancel request", exact: true });
  await cancel.waitFor(); await cancel.click();
  await page.getByRole("alert").filter({ hasText: "Request cancelled." }).waitFor({ state: "visible" });
  await scenario("success"); await freshThread();
  const beforeDouble = evidence.agentRequests.length;
  await send("Compare MOCK-001 and MOCK-002", { double: true }); await viewIs("comparison");
  assert.equal(evidence.agentRequests.length, beforeDouble + 1, "Busy state should suppress duplicate stream");
  pass("running state can be cancelled and suppresses duplicate submissions");

  await freshThread();
  await send("Find knowledge [[invalid-ref]]");
  await softError();
  assert.equal(await canvas().getByText("Fictional filter inspection guide", { exact: true }).count(), 0, "Foreign citation must not render");
  await freshThread();
  await send("Find knowledge [[hostile-text]]");
  assert.equal(await page.locator("img[src='x']").count(), 0);
  assert.equal(await page.evaluate(() => window.__nativeAgentXss), undefined);
  assert.ok((await canvas().innerText()).includes("<script>window.__nativeAgentXss=1</script>"),
    "Hostile string should remain inert visible text");
  await freshThread();
  await send("What happened? [[long-text]]"); await viewIs("focus");
  await freshThread();
  await send("What happened? [[source-only]]"); await viewIs("focus");
  await canvas().getByText("Retrieved sources only", { exact: true }).waitFor();
  await freshThread(); await send("Bad response [[malformed]]"); await softError();
  await freshThread(); await send("Incomplete response [[truncated]]"); await softError();
  await freshThread(); await send("Incomplete object [[missing-fields]]"); await softError();
  pass("invalid references are hidden; hostile/long strings stay inert; source-only, malformed, truncated, and missing-field responses are handled");

  await scenario("stale-write"); await freshThread();
  const proposalStart = evidence.proposalRequests.length;
  await send("Prepare assignment for MOCK-001 [[prepare-assignment]]");
  await canvas().getByText(/PENDING|pending|review/i).first().waitFor();
  await shot("desktop-pending-proposal");
  const confirmationPosts = () => evidence.proposalRequests.slice(proposalStart).filter((item) =>
    item.method === "POST" && item.path.endsWith("/a0000000-0000-4000-8000-000000000001"));
  assert.equal(confirmationPosts().length, 0, "Proposal preparation must not silently call confirmation POST");
  const approve = page.getByRole("button", { name: /approve|confirm|execute assignment/i }).first();
  await approve.waitFor(); await approve.click();
  await canvas().getByText("The proposal was rejected or changed. Refresh the saved proposal before retrying.", { exact: true }).waitFor();
  await canvas().getByText("STALE", { exact: true }).waitFor();
  assert.equal(await canvas().getByRole("button", { name: "Confirm and execute assignment", exact: true }).count(), 0,
    "A stale proposal must no longer expose confirmation");
  assert.ok(confirmationPosts().length > 0, "Explicit confirmation should make a proposal POST");
  pass("formal proposal waits for an explicit confirmation and stale confirmation is surfaced");

  await scenario("success"); await freshThread();
  await page.getByRole("button", { name: "Minimize conversation", exact: true }).click();
  await page.getByRole("button", { name: "Open conversation", exact: true }).waitFor();
  await page.getByRole("button", { name: "Open conversation", exact: true }).click();
  await page.getByRole("textbox", { name: "Message the agent", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Open conversation", exact: true }).waitFor();
  await page.keyboard.press("Control+k");
  await page.getByRole("textbox", { name: "Message the agent", exact: true }).waitFor();
  await layout("keyboard controls"); await shot("desktop-conversation-controls");
  pass("minimize/reopen, Escape, and Ctrl+K keyboard controls work");

  assert.deepEqual(evidence.externalRequests, [], "No external requests are allowed");
  assert.equal(evidence.runtimeErrors.length, 0, evidence.runtimeErrors.join("\n"));
  const notices = await page.evaluate(() => window.__previewNotices ?? []);
  assert.equal(notices.filter((line) => /Missing MOCK|MOCK blocked/.test(line)).length, 0, "All app requests should be mocked locally");
  evidence.result = "PASS";
} catch (error) {
  evidence.result = "FAIL"; evidence.error = error instanceof Error ? error.message : String(error);
  evidence.lastPageText = await page.locator("body").innerText().catch(() => "");
  evidence.lastCanvasView = await canvas().getAttribute("data-agent-view").catch(() => null);
  evidence.mockNotices = await page.evaluate(() => window.__previewNotices ?? []).catch(() => []);
  process.exitCode = 1; console.log(`FAIL ${evidence.error}`);
} finally {
  evidence.limitations = [
    "Actual React UI with synthetic, fictional MSW records and browser-only proposal state.",
    "No Supabase, authenticated account, real model/provider, production data, authorization enforcement, or deployed route was exercised.",
    "No Human UAT is implied by this browser evidence.",
  ];
  await context.close(); await browser.close();
  await fs.writeFile(path.join(output, "result.json"), JSON.stringify(evidence, null, 2));
  console.log(`RESULT ${evidence.result}; ${evidence.cases.length} cases; ${evidence.runtimeErrors.length} runtime errors; ${evidence.externalRequests.length} external requests; ${output}`);
}
