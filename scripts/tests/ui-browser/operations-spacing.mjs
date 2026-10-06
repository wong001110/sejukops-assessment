import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const output = path.resolve('reports/operations-spacing-ask-2026-10-06');
await fs.mkdir(output, { recursive: true });
const origin = 'http://localhost:3200';
const browser = await chromium.launch({ headless:true, executablePath:'C:/Users/user/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe' });
const context = await browser.newContext();
const result = { scope:'Actual components with fictional MSW data only; no database/provider calls', cases:[], errors:[], externalRequests:[] };
await context.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) { result.externalRequests.push(url.origin + url.pathname); await route.abort(); }
  else await route.continue();
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.on('pageerror', error => result.errors.push(error.message));
const pass = (name, evidence) => { result.cases.push({ name, result:'PASS', ...(evidence ? { evidence } : {}) }); console.log(`PASS ${name}`); };
async function capture(name) {
  const style = await page.addStyleTag({ content:'.mock-controls,.mock-footer{display:none!important}body::after{content:"MOCK DATA · fictional responses";position:fixed;left:12px;bottom:8px;padding:5px 10px;background:#fff4cc;color:#60440d;font:12px system-ui;z-index:3000}' });
  await page.screenshot({path:path.join(output,name)});
  await style.evaluate(element => element.remove());
}
try {
  await page.goto(`${origin}/workspaces/10000000-0000-4000-8000-000000000001/overview`);
  for (const role of ['admin','manager','technician']) {
    await page.getByLabel('Mock persona').selectOption(`guest-${role}`);
    for (const viewport of [{width:1536,height:864},{width:1024,height:768},{width:390,height:844}]) {
      await page.setViewportSize(viewport);
      await page.getByText('Completion trend', {exact:true}).waitFor();
      await page.waitForTimeout(300);
      const geometry = await page.locator('.operations-dashboard-stack').evaluate(stack => {
        const rect = element => { const r=element.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right}; };
        const children=[...stack.children].map(rect);
        const gaps=children.slice(1).map((item,i) => item.y-children[i].bottom);
        const panels=[...stack.querySelectorAll('.ant-card')];
        const overflow=panels.filter(panel => panel.scrollWidth > panel.clientWidth+1 && !panel.querySelector('.ant-table-wrapper,.dashboard-chart')).map(panel => panel.textContent.slice(0,60));
        const noteOverflows=[...stack.querySelectorAll('.dashboard-stat-card')].filter(card => card.querySelector('.dashboard-comparison').getBoundingClientRect().bottom > card.getBoundingClientRect().bottom+1).length;
        const kpis=[...stack.querySelectorAll('.dashboard-stat-card')].map(rect);
        const kpiGaps=kpis.slice(1).map((item,i)=>Math.abs(item.y-kpis[i].y)<1 ? item.x-kpis[i].right : item.y-kpis[i].bottom);
        return {gaps,kpiGaps,overflow,noteOverflows,pageOverflow:document.documentElement.scrollWidth-innerWidth};
      });
      const expected=viewport.width<=760?16:20;
      assert(geometry.gaps.length>=4);
      for (const gap of geometry.gaps) assert(Math.abs(gap-expected)<=1, `Section gap ${gap}, expected ${expected}`);
      for (const gap of geometry.kpiGaps) assert(Math.abs(gap-expected)<=1, `KPI gap ${gap}, expected ${expected}`);
      assert.deepEqual(geometry.overflow,[]); assert.equal(geometry.noteOverflows,0); assert(geometry.pageOverflow<=1);
      pass(`${role} ${viewport.width}px cards have consistent gaps and no clipping`,geometry);
      await capture(`${role}-${viewport.width}-dashboard.png`);
      if (viewport.width===1536 && await page.locator('.desktop-content').count()) {
        await page.locator('.desktop-content').evaluate(element=>{element.scrollTop=element.scrollHeight;});
        await capture(`${role}-dashboard-bottom.png`);
        await page.locator('.desktop-content').evaluate(element=>{element.scrollTop=0;});
      }
    }
    assert.equal(await page.locator('.workspace-persona-form select').count(),0);
    await page.locator('.workspace-persona-form .ant-select-selector').click();
    await page.locator('.ant-select-dropdown:visible').getByText('Manager',{exact:true}).click();
    assert.equal(await page.locator('.workspace-persona-form input[name=persona]').inputValue(),'MANAGER');
    assert.match(await page.locator('.operations-role-controls').innerText(),new RegExp(role.toUpperCase()));
    pass(`${role} AntD Perspective changes field without automatic submit`);
    await page.getByRole('button',{name:'Switch',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.operations-role-controls')?.textContent?.includes('MANAGER'));
    pass(`${role} explicit Switch applies chosen Mock perspective`);
  }
  assert.deepEqual(result.errors,[]); assert.deepEqual(result.externalRequests,[]);
  result.result='PASS';
} catch(error) { result.result='FAIL'; result.failure=error.message; process.exitCode=1; console.error(error); await page.screenshot({path:path.join(output,'failure.png')}); }
finally { await fs.writeFile(path.join(output,'layout-results.json'),JSON.stringify(result,null,2)); await browser.close(); }
