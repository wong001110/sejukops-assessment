import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const origin='http://localhost:3200';
const output=path.resolve('reports/operations-spacing-ask-2026-10-06');
await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'C:/Users/user/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe'});
const context=await browser.newContext({viewport:{width:1536,height:864}});
const result={scope:'Actual unified Ask AI UI; fictional bounded MSW replies, not real model routing or Auth proof',cases:[],errors:[],externalRequests:[]};
await context.route('**/*',async route=>{const url=new URL(route.request().url());if(['http:','https:'].includes(url.protocol)&&url.origin!==origin){result.externalRequests.push(url.origin+url.pathname);await route.abort();}else await route.continue();});
const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>result.errors.push(error.message));
const pass=name=>{result.cases.push({name,result:'PASS'});console.log(`PASS ${name}`);};
const drawer=()=>page.getByRole('dialog',{name:'Operations · Ask AI',exact:true});
async function ask(question){await drawer().getByRole('textbox',{name:'Question',exact:true}).fill(question);await drawer().getByRole('button',{name:'Ask AI',exact:true}).click();await drawer().getByRole('region',{name:"This run's activity",exact:true}).waitFor();}
async function capture(name){const style=await page.addStyleTag({content:'.mock-controls,.mock-footer{display:none!important}body::after{content:"MOCK DATA · fictional responses";position:fixed;left:12px;bottom:8px;padding:5px 10px;background:#fff4cc;color:#60440d;font:12px system-ui;z-index:3000}'});await page.screenshot({path:path.join(output,name)});await style.evaluate(element=>element.remove());}
try{
await page.goto(`${origin}/workspaces/10000000-0000-4000-8000-000000000001/overview`);
for(const role of ['admin','manager','technician']){
 await page.getByLabel('Mock persona').selectOption(`guest-${role}`);await page.getByText('Completion trend',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Open Operations Ask AI',exact:true}).click();await drawer().waitFor();
 assert.equal(await drawer().locator('select,.ant-segmented').count(),0);assert.equal(await drawer().getByRole('textbox',{name:'Question',exact:true}).count(),1);
 await ask('Show my current orders and jobs');
 const orders=drawer().getByRole('region',{name:'Orders from scoped evidence',exact:true});await orders.waitFor();assert.match(await orders.innerText(),/MOCK-002/);
 if(role==='technician')assert.doesNotMatch(await orders.innerText(),/MOCK-001/);else assert.match(await orders.innerText(),/MOCK-001/);
 pass(`${role} asks orders in one input with scoped Mock records`);await capture(`${role}-ask-orders.png`);
 await ask('How should a filter be cleaned?');await drawer().getByRole('region',{name:'Cited knowledge excerpts',exact:true}).waitFor();assert.equal(await orders.count(),0);
 pass(`${role} asks knowledge in same input without selecting a topic`);
 await ask('Show my jobs and filter knowledge');await orders.waitFor();await drawer().getByRole('region',{name:'Cited knowledge excerpts',exact:true}).waitFor();
 pass(`${role} displays both source types for one question`);await capture(`${role}-ask-both.png`);
 await drawer().getByRole('button',{name:'Close',exact:true}).click();
}
await page.getByLabel('Mock scenario').selectOption('quota-exhausted');await page.getByText('Completion trend',{exact:true}).waitFor();await page.getByRole('button',{name:'Open Operations Ask AI',exact:true}).click();
await drawer().getByRole('textbox',{name:'Question',exact:true}).fill('Show my jobs');await drawer().getByRole('button',{name:'Ask AI',exact:true}).click();await drawer().getByText(/Today's Guest AI allowance is used up/).waitFor();assert.equal(await drawer().getByRole('region',{name:'Orders from scoped evidence',exact:true}).count(),0);pass('Quota exhaustion shows manual fallback without stale source results');
await drawer().getByRole('button',{name:'Close',exact:true}).click();await page.getByLabel('Mock scenario').selectOption('success');await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Open Operations Ask AI',exact:true}).click();await ask('Show my jobs and filter knowledge');
await page.waitForTimeout(350);
const bounds=await drawer().boundingBox();const nav=await page.getByRole('navigation',{name:'Technician navigation',exact:true}).boundingBox();
const button=await page.getByRole('button',{name:'Open Operations Ask AI',exact:true}).boundingBox();
assert(bounds&&nav&&bounds.x>=0&&bounds.x+bounds.width<=390&&bounds.y>=0&&bounds.y+bounds.height<=nav.y-8);
assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));pass('Unified Technician Ask AI fits 390px above bottom navigation');
const navRows=await page.locator('.technician-tabs > a').evaluateAll(items=>items.map(item=>item.getBoundingClientRect().y));
assert.equal(navRows.length,3);assert(navRows.every(y=>Math.abs(y-navRows[0])<1));assert(button&&button.y+button.height<=nav.y-8);
pass('Technician navigation stays on one row and floating button clears it');await capture('technician-390-ask-both.png');
assert.deepEqual(result.errors,[]);assert.deepEqual(result.externalRequests,[]);result.result='PASS';
}catch(error){result.result='FAIL';result.failure=error.message;console.error(error);process.exitCode=1;await page.screenshot({path:path.join(output,'ask-failure.png')});}
finally{await fs.writeFile(path.join(output,'ask-results.json'),JSON.stringify(result,null,2));await browser.close();}
