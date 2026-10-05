// Actual application components; fictional local MSW responses, never paid AI or Auth proof.
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const origin = 'http://localhost:3200';
const output = path.resolve('reports/conversation-layout-2026-10-06');
await fs.mkdir(output, { recursive: true });
const evidence = { scope: 'Actual React UI, fictional MSW JSON/NDJSON replies. No real provider/database/Auth/Human UAT.', result: 'RUNNING', checks: [], measurements: [], screenshots: [], errors: [], externalRequests: [] };
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Users/user/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe' });
const context = await browser.newContext({ viewport: { width: 1536, height: 864 } });
await context.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) { evidence.externalRequests.push(url.origin + url.pathname); await route.abort(); }
  else await route.continue();
});
const page = await context.newPage();
page.setDefaultTimeout(12000);
page.on('pageerror', error => evidence.errors.push(error.message));
const watchdog = setTimeout(() => { void browser.close(); }, 150000);
const pass = name => { evidence.checks.push({ name, result: 'PASS' }); console.log(`PASS ${name}`); };
const ops = () => page.getByRole('dialog', { name: 'Operations · Ask AI', exact: true });
const native = () => page.getByRole('region', { name: 'Agent conversation', exact: true });
async function configure(mode, persona, scenario = 'success') {
  await page.goto(`${origin}/workspaces/10000000-0000-4000-8000-000000000001/${mode}`);
  await page.getByLabel('Mock persona').selectOption(persona);
  await page.getByLabel('Mock scenario').selectOption(scenario);
  await page.waitForTimeout(300);
}
async function capture(name) {
  const style = await page.addStyleTag({ content: '.mock-controls,.mock-footer{display:none!important}body::after{content:"MOCK DATA · fictional responses";position:fixed;left:12px;top:6px;padding:4px 9px;background:#fff4cc;color:#60440d;font:11px system-ui;z-index:3000;pointer-events:none}' });
  // Removing preview controls changes document height; let any result-scroll settle before capturing.
  await page.waitForTimeout(500);
  const nativePanel = await native().boundingBox().catch(() => null);
  if(nativePanel) assert(nativePanel.y >= 0 && nativePanel.y + nativePanel.height <= page.viewportSize().height + 1, 'Captured native panel and composer fit viewport');
  await page.screenshot({ path: path.join(output, `${name}.png`) });
  await style.evaluate(element => element.remove());
  evidence.screenshots.push(`${name}.png`);
}
async function measure(kind, label) {
  const result = await page.evaluate(({ kind, label }) => {
    const panel = document.querySelector(kind === 'operations' ? '.operations-assistant-drawer .ant-drawer-content' : '.native-conversation');
    const composer = document.querySelector(kind === 'operations' ? '.operations-assistant-composer' : '.native-composer');
    const transcript = document.querySelector(kind === 'operations' ? '.operations-assistant-transcript' : '.native-messages');
    const rect = element => { const r = element.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, bottom:r.bottom, right:r.right }; };
    const canvas = document.querySelector('.native-canvas'), layout = document.querySelector('.native-agent-layout');
    return { kind, label, viewport: { width:innerWidth, height:innerHeight }, documentWidth:document.documentElement.scrollWidth, panel:rect(panel), composer:rect(composer), transcript:rect(transcript), scroll:transcript.scrollHeight > transcript.clientHeight, panelOverflow:getComputedStyle(panel).overflowY, transcriptOverflow:getComputedStyle(transcript).overflowY, canvasWidth:canvas?.getBoundingClientRect().width, layoutWidth:layout?.getBoundingClientRect().width };
  }, { kind, label });
  evidence.measurements.push(result);
  assert(result.panel.x >= 0 && result.panel.y >= 0 && result.panel.right <= result.viewport.width+1 && result.panel.bottom <= result.viewport.height+1, `${label}: panel in viewport`);
  assert(result.composer.bottom <= result.panel.bottom+1 && result.composer.y >= result.transcript.bottom-1, `${label}: bottom composer outside transcript`);
  assert(result.documentWidth <= result.viewport.width+1, `${label}: no page horizontal overflow`);
  assert.match(result.transcriptOverflow, /auto|scroll/, `${label}: transcript scrolls independently`);
  if(kind === 'native') assert(Math.abs(result.canvasWidth-result.layoutWidth)<2, `${label}: canvas full width`);
  pass(`${label}: fixed bottom composer, independently scrolling thread and viewport bounds`);
  return result;
}
try {
  for(const [width,height,label] of [[1536,864,'device'],[1024,768,'tablet'],[390,844,'mobile']]) {
    await page.setViewportSize({width,height});
    for(const persona of ['guest-admin','guest-manager','guest-technician']) {
      await configure('overview',persona);
      await page.getByRole('button',{name:'Open Operations Ask AI',exact:true}).click();
      await ops().getByRole('textbox',{name:'Question',exact:true}).fill('Show my jobs and filter knowledge');
      await ops().getByRole('button',{name:'Ask AI',exact:true}).click();
      await ops().getByRole('region',{name:'Cited knowledge excerpts',exact:true}).waitFor();
      const before = await measure('operations',`${label}-${persona}`);
      await ops().getByRole('textbox',{name:'Question',exact:true}).fill('How should a filter be cleaned?');
      await ops().getByRole('textbox',{name:'Question',exact:true}).press('Enter');
      await page.waitForFunction(() => document.querySelectorAll('.operations-assistant-drawer [aria-label="Cited knowledge excerpts"]').length === 2);
      await ops().locator('.operations-assistant-transcript').evaluate(element=>element.scrollTop=0);
      const after = await measure('operations',`${label}-${persona}-history`);
      assert(Math.abs(before.composer.y-after.composer.y)<2, 'Composer does not move with transcript length or scroll');
      assert.equal(await ops().getByText('Show my jobs and filter knowledge',{exact:true}).count(),1);
      if(label==='device'||persona==='guest-technician') await capture(`${label}-${persona}-chat`);
    }
    await configure('agent','guest-admin');
    await page.getByRole('button',{name:'Open conversation',exact:true}).click();
    await native().getByRole('textbox',{name:'Message the agent',exact:true}).fill('Compare MOCK-001 and MOCK-002');
    await native().getByRole('button',{name:'Send message',exact:true}).click();
    await page.locator('[data-agent-view="comparison"]').waitFor();
    if(!await native().isVisible().catch(()=>false)) await page.getByRole('button',{name:'Open conversation',exact:true}).click();
    await measure('native',`${label}-coding-agent`);
    await capture(`${label}-coding-agent`);
    const widthBefore = await page.locator('.native-canvas').evaluate(element=>element.getBoundingClientRect().width);
    await native().getByRole('button',{name:'Minimize conversation',exact:true}).click();
    assert.equal(await page.locator('.native-canvas').evaluate(element=>element.getBoundingClientRect().width),widthBefore);
    pass(`${label}: minimizing conversation preserves canvas width and result`);
  }
  await page.setViewportSize({width:1536,height:864});
  await configure('agent','guest-admin','delayed');
  await page.getByRole('button',{name:'Open conversation',exact:true}).click();
  await native().getByRole('textbox',{name:'Message the agent',exact:true}).fill('Compare MOCK-001 and MOCK-002');
  await native().getByRole('button',{name:'Send message',exact:true}).click();
  const execution = native().getByRole('region',{name:'Agent execution',exact:true});
  await execution.getByText('Read recent orders',{exact:true}).waitFor();
  assert.match(await execution.innerText(),/running/i);
  await measure('native','streamed-execution-running'); await capture('device-execution-running');
  await execution.getByText(/2 returned/).waitFor();
  await page.locator('[data-agent-view="comparison"]').waitFor();
  assert.match(await execution.innerText(),/complete|succeeded/i);
  await capture('device-execution-complete');
  pass('Actual fictional NDJSON running/succeeded events update execution panel before final canvas');
  await native().getByRole('textbox',{name:'Message the agent',exact:true}).fill('Review MOCK-001');
  await native().getByRole('button',{name:'Send message',exact:true}).click();
  await execution.getByText('Read recent orders',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-agent-view="comparison"]').count(),1,'Previous canvas retained while next run pending');
  await native().getByRole('button',{name:'Cancel request',exact:true}).click();
  await page.waitForTimeout(350);
  assert.doesNotMatch(await execution.innerText(),/\brunning\b/i,'Cancelled execution must not still claim tool running');
  await capture('device-execution-cancelled');
  pass('Pending next run keeps prior canvas; cancel stops current execution display without claiming rollback');
  assert.deepEqual(evidence.errors,[]); assert.deepEqual(evidence.externalRequests,[]);
  evidence.result='PASS';
} catch(error) {
  evidence.result='FAIL'; evidence.failure=error.message; process.exitCode=1; console.error(error);
  await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});
} finally {
  clearTimeout(watchdog); await browser.close();
  await fs.writeFile(path.join(output,'browser-results.json'),JSON.stringify(evidence,null,2));
  console.log(`RESULT ${evidence.result}: ${evidence.checks.length} checks`);
}
