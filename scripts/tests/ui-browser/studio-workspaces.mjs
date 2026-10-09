// Actual product components with isolated fictional MSW responses; no paid AI or DB.
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const origin = 'http://localhost:3200';
const workspace = '10000000-0000-4000-8000-000000000001';
const output = path.resolve('reports/dsh-studio-layout-2026-10-10');
await fs.mkdir(output, { recursive: true });
const evidence = { scope: 'Actual product UI; fictional local MSW responses. No live Auth, database, provider or Human UAT.', result: 'RUNNING', checks: [], measurements: [], screenshots: [], errors: [], externalRequests: [] };
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Users/user/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe' });
const context = await browser.newContext();
await context.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) { evidence.externalRequests.push(url.origin + url.pathname); await route.abort(); }
  else await route.continue();
});
const page = await context.newPage(); page.setDefaultTimeout(15000);
page.on('pageerror', error => evidence.errors.push(error.message));
const timer = setTimeout(() => void browser.close(), 240000);
const pass = name => { evidence.checks.push(name); console.log(`PASS ${name}`); };
async function visit(owner = false, persona = 'staff-admin', scenario = 'success', control = '') {
  const params = new URLSearchParams({ persona, scenario }); if (control) params.set('ownerHistory', control);
  await page.goto(`${origin}${owner ? '/owner/console' : `/workspaces/${workspace}/agent`}?${params}`);
  await page.getByRole('textbox', { name: 'Message the agent', exact: true }).waitFor();
  await page.addStyleTag({ content: '.mock-controls,.mock-footer{display:none!important}body::after{content:"MOCK DATA · fictional responses";position:fixed;top:3px;left:8px;z-index:3000;background:#fff4cc;color:#60440d;padding:3px 8px;font:10px system-ui;pointer-events:none}' });
}
async function capture(name) { await page.screenshot({ path: path.join(output, `${name}.png`) }); evidence.screenshots.push(`${name}.png`); }
async function measure(name) {
  const result = await page.evaluate(() => {
    const r = s => { const x = document.querySelector(s).getBoundingClientRect(); return { x:x.x, y:x.y, right:x.right, bottom:x.bottom, width:x.width, height:x.height }; };
    return { main:r('.native-agent-studio'), chat:r('.native-conversation'), composer:r('.native-composer'), messages:r('.native-messages'), send:r('.native-composer button[type=submit]'), width:innerWidth, height:innerHeight, scrollWidth:document.documentElement.scrollWidth };
  });
  evidence.measurements.push({ name, ...result });
  assert(result.composer.bottom <= result.height + 1, `${name}: composer clipped ${JSON.stringify(result)}`);
  assert(result.composer.y >= result.chat.y && result.send.bottom <= result.chat.bottom + 1, `${name}: composer outside conversation`);
  assert(result.messages.height > 75, `${name}: transcript squeezed`);
  assert(result.scrollWidth <= result.width + 1, `${name}: horizontal page overflow`);
  pass(`${name}: composer and Send remain inside viewport; transcript scrolls; no page overflow`);
}
async function send(text) {
  await page.getByRole('textbox', { name:'Message the agent', exact:true }).fill(text);
  await page.getByRole('button', { name:'Send message', exact:true }).click();
  await page.locator('[data-agent-view]').waitFor({ state:'attached' });
  await page.getByRole('button', { name:'Send message', exact:true }).waitFor();
}
try {
  for (const [label, size, owner, persona] of [
    ['desktop-admin', {width:1536,height:864}, false, 'staff-admin'],
    ['desktop-guest', {width:1536,height:864}, false, 'guest-manager'],
    ['desktop-owner', {width:1536,height:864}, true, 'owner-admin'],
    ['short-window', {width:1024,height:600}, false, 'staff-manager'],
    ['mobile-admin', {width:390,height:844}, false, 'staff-admin'],
    ['mobile-owner', {width:390,height:844}, true, 'owner-admin'],
    ['short-mobile-owner', {width:390,height:600}, true, 'owner-admin'],
  ]) {
    await page.setViewportSize(size); await visit(owner, persona);
    await measure(`${label}-empty`); await capture(`${label}-empty`);
    await send('Compare MOCK-001 and MOCK-002');
    const chat = page.getByRole('region', { name:'Agent conversation', exact:true });
    await chat.getByRole('button', {name:'Show tool activity',exact:true}).click();
    assert(await chat.locator('[data-tool-status="succeeded"]').count() > 0);
    await measure(`${label}-result`); await capture(`${label}-conversation`);
    if (size.width <= 760) await page.getByRole('button', {name:'View results',exact:true}).click();
    const results = page.getByRole('region', {name:'Business results',exact:true});
    await results.waitFor(); assert(await results.locator('[data-agent-view="comparison"]').count() === 1);
    await capture(`${label}-results`);
    await results.getByRole('button', {name:'Expand results',exact:true}).click();
    assert(await page.locator('.native-studio-grid.is-maximized').count() === 1);
    await capture(`${label}-expanded`);
    if (size.width <= 760) { await page.getByRole('button',{name:'Back to conversation',exact:true}).click(); assert(await chat.isVisible()); }
    else await page.keyboard.press('Escape');
    assert(await page.locator('.native-studio-grid.is-maximized').count() === 0);
    if (size.width <= 760) await page.getByRole('button', {name:'Conversation',exact:true}).click();
    await chat.getByRole('button', {name:'Start new conversation',exact:true}).click();
    assert(await page.locator('[data-agent-view]').count() === 0);
    pass(`${label}: dynamic comparison, real fixture tool events, expand/Escape and clean New conversation`);
  }
  await page.setViewportSize({width:1536,height:864}); await visit(true);
  await page.getByRole('button', {name:'Open saved conversation: MOCK Owner saved inspection',exact:true}).click();
  await page.getByText('Historical conversation',{exact:true}).waitFor();
  const confirm = page.getByRole('button',{name:'Confirm and execute assignment',exact:true});
  await page.locator('.native-proposal').waitFor();
  assert(await confirm.count() === 0 || await confirm.isDisabled());
  await capture('owner-history-read-only'); pass('Personal sidebar restores a read-only saved proposal; no enabled confirmation (fixture current proposal unavailable)');
  await page.setViewportSize({width:390,height:844}); await visit(false);
  await page.getByRole('button',{name:'Open conversations',exact:true}).click();
  const drawer = page.getByRole('dialog',{name:'Your conversations',exact:true}); await drawer.waitFor();
  await capture('mobile-history-drawer'); await drawer.getByRole('button',{name:'New conversation',exact:true}).click();
  await drawer.waitFor({state:'hidden'}); pass('Mobile sidebar uses an accessible Drawer and New conversation closes it');
  await page.setViewportSize({width:1536,height:864}); await visit(false,'staff-admin','server-error');
  await page.getByRole('textbox',{name:'Message the agent'}).fill('Inspect a current order');
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  await page.getByRole('button',{name:'Retry request',exact:true}).first().waitFor();
  assert.equal(await page.locator('[data-agent-view]').count(),0); await capture('provider-error');
  pass('Provider failure is explicit and retryable, with no invented working result');
  await page.goto(`${origin}/workspaces/${workspace}/overview?persona=staff-admin&scenario=success`);
  await page.addStyleTag({content:'.mock-controls,.mock-footer{display:none!important}'});
  await page.getByRole('button',{name:'Open Operations Ask AI',exact:true}).click();
  const assistant=page.getByRole('dialog',{name:'Operations · Ask AI',exact:true});
  await assistant.getByRole('textbox',{name:'Question',exact:true}).fill('Show current order status and filter guidance');
  await assistant.getByRole('button',{name:'Ask AI',exact:true}).click();
  await assistant.locator('.operations-assistant-answer').waitFor();
  assert.equal(await assistant.getByRole('region',{name:'Agent execution',exact:true}).count(),0);
  assert.equal(await page.locator('.native-agent-studio').count(),0);
  await capture('operations-chatbot-unchanged'); pass('Operations retains its portal and plain cited chatbot, without native execution UI');
  assert.deepEqual(evidence.errors,[]); assert.deepEqual(evidence.externalRequests,[]); evidence.result='PASS';
} catch (error) { evidence.result='FAIL'; evidence.failure=error.stack; throw error; }
finally { clearTimeout(timer); await fs.writeFile(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2)); await browser.close(); }
