// Actual React components, isolated MSW replies. This is not live Auth/provider evidence.
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const origin = 'http://localhost:3200';
const workspace = '10000000-0000-4000-8000-000000000001';
const output = path.resolve('reports/dsh-inspired-workspaces-2026-10-09/staff');
await fs.mkdir(output, { recursive: true });
const evidence = { scope: 'Actual UI with fictional MSW responses; no live provider/database/authentication/Human UAT', result: 'RUNNING', checks: [], screenshots: [], errors: [], externalRequests: [] };
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Users/user/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe' });
const context = await browser.newContext();
await context.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) { evidence.externalRequests.push(url.origin + url.pathname); await route.abort(); }
  else await route.continue();
});
const page = await context.newPage(); page.setDefaultTimeout(12000);
page.on('pageerror', error => evidence.errors.push(error.message));
const timer = setTimeout(() => void browser.close(), 150000);
const pass = name => { evidence.checks.push(name); console.log(`PASS ${name}`); };
async function open(mode, persona, scenario = 'success') {
  await page.goto(`${origin}/workspaces/${workspace}/${mode}?persona=${persona}&scenario=${scenario}`);
  await page.getByLabel('Mock persona').waitFor();
  await page.addStyleTag({ content: '.mock-controls,.mock-footer{display:none!important}body::after{content:"MOCK DATA · fictional replies";position:fixed;top:4px;left:8px;z-index:3000;font:11px system-ui;background:#fff4cc;padding:4px;pointer-events:none}' });
}
async function capture(name) { await page.screenshot({ path: path.join(output, `${name}.png`) }); evidence.screenshots.push(`${name}.png`); }
async function bounds(panelSelector, composerSelector, transcriptSelector, label) {
  const value = await page.evaluate(({ panelSelector, composerSelector, transcriptSelector }) => {
    const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x:r.x, y:r.y, right:r.right, bottom:r.bottom }; };
    return { panel:rect(panelSelector), composer:rect(composerSelector), transcript:rect(transcriptSelector), w:innerWidth,h:innerHeight,doc:document.documentElement.scrollWidth };
  }, { panelSelector, composerSelector, transcriptSelector });
  assert(value.panel.x >= 0 && value.panel.y >= 0 && value.panel.right <= value.w+1 && value.panel.bottom <= value.h+1, `${label} panel viewport bounds`);
  assert(value.composer.bottom <= value.panel.bottom+1 && value.composer.y >= value.transcript.bottom-1, `${label} composer below thread`);
  assert(value.doc <= value.w+1, `${label} horizontal overflow`); pass(`${label}: bounded panel and bottom composer`);
}
try {
  for (const [width,height,label] of [[1536,864,'desktop'],[390,844,'mobile']]) {
    await page.setViewportSize({width,height});
    for (const role of ['admin','manager','technician']) {
      await open('overview',`staff-${role}`);
      await page.getByRole('button',{name:'Open Operations Ask AI',exact:true}).click();
      const dialog = page.getByRole('dialog',{name:'Operations · Ask AI',exact:true});
      await dialog.getByRole('textbox',{name:'Question',exact:true}).fill('Show my jobs and filter knowledge');
      await dialog.getByRole('button',{name:'Ask AI',exact:true}).click();
      await dialog.locator('.operations-assistant-answer').waitFor();
      assert.equal(await dialog.getByText('Show my jobs and filter knowledge',{exact:true}).count(),1);
      assert.equal(await dialog.getByRole('region',{name:'Agent execution',exact:true}).count(),0);
      assert.equal(await dialog.locator('[data-tool-status]').count(),0);
      assert.equal(await dialog.getByRole('button',{name:/Confirm and execute/}).count(),0);
      await bounds('.operations-assistant-drawer .ant-drawer-content','.operations-assistant-composer','.operations-assistant-transcript',`${label}-${role}-chat`);
      await capture(`${label}-${role}-chat`);
    }
    await open('agent','staff-admin');
    await page.getByRole('button',{name:'Open conversation',exact:true}).click();
    const native = page.getByRole('region',{name:'Agent conversation',exact:true});
    await native.getByRole('textbox',{name:'Message the agent',exact:true}).fill('Compare MOCK-001 and MOCK-002');
    await native.getByRole('button',{name:'Send message',exact:true}).click();
    await page.locator('[data-agent-view="comparison"]').waitFor();
    if(!await native.isVisible()) await page.getByRole('button',{name:'Open conversation',exact:true}).click();
    await bounds('.native-conversation','.native-composer','.native-messages',`${label}-native`);
    await native.getByRole('button',{name:'Show tool activity',exact:true}).click();
    assert(await native.locator('[data-tool-status="succeeded"]').count() > 0);
    const before = await page.locator('.native-canvas').evaluate(e=>e.getBoundingClientRect().width);
    await capture(`${label}-native`);
    await native.getByRole('button',{name:'Minimize conversation',exact:true}).click();
    assert.equal(await page.locator('.native-canvas').evaluate(e=>e.getBoundingClientRect().width),before);
    pass(`${label}: dynamic comparison and actual execution events; floating conversation preserves canvas width`);
  }
  await page.setViewportSize({width:1536,height:864}); await open('overview','staff-admin','server-error');
  await page.getByRole('button',{name:'Open Operations Ask AI',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Operations · Ask AI',exact:true});
  await dialog.getByRole('textbox',{name:'Question',exact:true}).fill('Check current order status');
  await dialog.getByRole('button',{name:'Ask AI',exact:true}).click();
  await dialog.getByRole('button',{name:'Retry question',exact:true}).waitFor();
  await capture('desktop-chat-failure'); pass('Provider failure is explicit and retryable without fabricated results');
  assert.deepEqual(evidence.errors,[]); assert.deepEqual(evidence.externalRequests,[]);
  evidence.result='PASS';
} catch (error) { evidence.result='FAIL'; evidence.failure=error.stack; throw error; }
finally { clearTimeout(timer); await fs.writeFile(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2)); await browser.close(); }
