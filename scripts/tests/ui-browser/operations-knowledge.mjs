import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const origin = "http://localhost:3200";
const workspace = "10000000-0000-4000-8000-000000000001";
const documentId = "60000000-0000-4000-8000-000000000001";
const versionId = "70000000-0000-4000-8000-000000000001";
const output = path.resolve(process.env.PORTAL_KNOWLEDGE_OUTPUT ?? ".agent/operations-knowledge-mock");
fs.mkdirSync(output, {recursive:true});
const evidence = { scope: "Rendered KnowledgeWorkspace with UI-browser MSW fictional in-memory APIs; no live backend/provider; personas are presentation props only", result: "RUNNING", checks: [], knowledgeRequests: [], blockedExternalRequests: [] };
function check(name, passed, details = "") {
  if (!passed) throw new Error(`${name} failed${details ? `: ${details}` : ""}`);
  evidence.checks.push({ name, result: "PASS", ...(details ? { details } : {}) });
}
function visible(locator) { return locator.isVisible().catch(() => false); }

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: "C:/Users/user/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/workspaces/") && url.pathname.endsWith("/knowledge"))
      evidence.knowledgeRequests.push({ method: request.method(), path: url.pathname, queryKeys: [...url.searchParams.keys()] });
    if (url.origin !== origin && ["http:", "https:"].includes(url.protocol)) evidence.blockedExternalRequests.push(url.origin);
  });
  page.on("response", response => {
    const url = new URL(response.url());
    if (url.origin === origin && url.pathname.startsWith(`/api/workspaces/${workspace}/knowledge`)) {
      const request = response.request();
      const record = evidence.knowledgeRequests.findLast(item => item.method === request.method() && item.path === url.pathname && item.status === undefined);
      if (record) record.status = response.status();
    }
  });
  try {
    const reviewUrl = `${origin}/workspaces/${workspace}/knowledge?reviewDocumentId=${documentId}&reviewVersionId=${versionId}`;
    await page.goto(reviewUrl, { waitUntil: "networkidle" });
    const manageTab = page.getByRole("tab", { name: "Manage knowledge", exact: true });
    const searchTab = page.getByRole("tab", { name: "Search knowledge", exact: true });
    await page.getByText("Fictional filter inspection guide", { exact: true }).waitFor();
    check("review query selects Manage", await manageTab.getAttribute("aria-selected") === "true");
    check("review version is rendered", await visible(page.getByRole("button", { name: "Publish this reviewed version", exact: true })));
    await page.screenshot({ path: path.join(output, "review-query-manage.png"), fullPage: true });
    await searchTab.click();
    check("review state survives switch to Search", await visible(page.getByRole("textbox", { name: "Search text", exact: true })));
    await manageTab.click();
    check("review state survives return to Manage", await page.getByText("Fictional filter inspection guide", { exact: true }).isVisible());
    check("review URL context remains", new URL(page.url()).searchParams.get("reviewVersionId") === versionId);

    await page.goto(`${origin}/workspaces/${workspace}/knowledge`, { waitUntil: "networkidle" });
    await page.getByRole("textbox", { name: "Search text", exact: true }).waitFor();
    check("editor default tab is Search", await searchTab.getAttribute("aria-selected") === "true");
    check("Search is visible by default", await visible(page.getByRole("textbox", { name: "Search text", exact: true })));
    check("Manage controls are initially hidden", !(await visible(page.getByRole("button", { name: "Create draft", exact: true }))));
    await page.screenshot({ path: path.join(output, "admin-default-search.png"), fullPage: true });

    await manageTab.click();
    await page.getByRole("textbox", { name: "Title", exact: true }).fill("Fictional airflow guide");
    await page.getByRole("textbox", { name: "Source label", exact: true }).fill("Mock training source");
    await page.getByRole("button", { name: "Create draft", exact: true }).click();
    await page.getByText("Private draft created. Add text next.", { exact: true }).waitFor();
    await page.getByRole("textbox", { name: "Knowledge text", exact: true }).fill("Disconnect power before inspecting the fictional airflow filter.");
    await page.getByRole("button", { name: "Add text for review", exact: true }).click();
    await page.getByRole("button", { name: "Prepare for search", exact: true }).waitFor();
    check("draft stages as PENDING for review", await page.getByText("PENDING", { exact: true }).isVisible());
    check("stage replaces URL with the active review IDs", Boolean(new URL(page.url()).searchParams.get("reviewDocumentId")) && Boolean(new URL(page.url()).searchParams.get("reviewVersionId")));
    await page.screenshot({ path: path.join(output, "admin-pending-review.png"), fullPage: true });

    await page.getByRole("button", { name: "Prepare for search", exact: true }).click();
    await page.getByRole("button", { name: "Publish this reviewed version", exact: true }).waitFor();
    check("prepare action reaches READY", await page.getByText("READY", { exact: true }).isVisible());
    await page.screenshot({ path: path.join(output, "admin-ready-to-publish.png"), fullPage: true });
    await page.getByRole("button", { name: "Publish this reviewed version", exact: true }).click();
    await page.getByText("Version published for this workspace.", { exact: true }).waitFor();
    check("reviewed version publishes and clears review URL", !new URL(page.url()).searchParams.has("reviewVersionId"));
    await searchTab.click();
    await page.getByRole("textbox", { name: "Search text", exact: true }).fill("airflow");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const publishedResult = page.locator("article.workspace-result").filter({ hasText: "Fictional airflow guide" });
    await publishedResult.waitFor();
    check("published source appears in Search results", await publishedResult.isVisible());
    await page.screenshot({ path: path.join(output, "admin-published-search-result.png"), fullPage: true });

    for (const persona of ["guest-admin", "staff-technician"]) {
      await page.getByLabel("Mock persona", { exact: true }).selectOption(persona);
      const searchInput = page.getByRole("textbox", { name: "Search text", exact: true });
      await searchInput.waitFor();
      check(`${persona} sees Search`, await visible(searchInput));
      check(`${persona} has no Manage tab`, await page.getByRole("tab", { name: "Manage knowledge", exact: true }).count() === 0);
      check(`${persona} has no create control`, await page.getByRole("button", { name: "Create draft", exact: true }).count() === 0);
    }
    check("no external HTTP requests were attempted", evidence.blockedExternalRequests.length === 0);
    check("no missing mock API handler was reported", !(await page.getByText(/Missing MOCK (handler|response)/).count()));
    evidence.result = "PASS";
  } catch (error) {
    evidence.result = "FAIL";
    evidence.error = error instanceof Error ? error.message : String(error);
    try { await page.screenshot({ path: path.join(output, "failure-state.png"), fullPage: true }); } catch {}
    process.exitCode = 1;
  } finally {
    await context.close();
    await browser.close();
    fs.writeFileSync(path.join(output, "result.json"), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence, null, 2));
  }
})().catch(error => {
  evidence.result = "FAIL";
  evidence.error = error instanceof Error ? error.message : String(error);
  fs.writeFileSync(path.join(output, "result.json"), JSON.stringify(evidence, null, 2));
  console.error(error);
  process.exit(1);
});
