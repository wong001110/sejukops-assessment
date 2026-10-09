// Actual application React components with fictional local MSW/fetch responses.
// No Auth, real database, provider, model resistance or Human UAT claims.
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const origin='http://localhost:3200';
const output=path.resolve(process.env.SECURITY_EVAL_OUTPUT ?? 'evals/security/.local/browser');
const selectedCase=process.env.SECURITY_EVAL_CASE ?? '';
await fs.mkdir(output,{recursive:true});
const result={scope:'Actual React UI / synthetic local responses only; no real Auth, RLS or paid AI',selectedCase:selectedCase||'all',checks:[],pageErrors:[],blockedExternal:[]};
const browser=await chromium.launch({headless:true,executablePath:'C:/Users/user/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe'});
const context=await browser.newContext({viewport:{width:1920,height:1080}});
await context.route('**/*',async r=>{const u=new URL(r.request().url());if(['http:','https:'].includes(u.protocol)&&u.origin!==origin){result.blockedExternal.push(u.origin+u.pathname);await r.abort();}else await r.continue();});
const page=await context.newPage();page.setDefaultTimeout(10000);
page.on('pageerror',e=>result.pageErrors.push(e.message));
const watchdog=setTimeout(()=>void browser.close(),180000);
const ops=()=>page.getByRole('dialog',{name:'Operations · Ask AI',exact:true});
const native=()=>page.getByRole('region',{name:'Agent conversation',exact:true});
const canvas=()=>page.getByRole('region',{name:'Adaptive workspace',exact:true});
async function configure(mode='overview',scenario='success',persona='staff-admin'){
 await page.goto(`${origin}/workspaces/10000000-0000-4000-8000-000000000001/${mode}?scenario=${scenario}&persona=${persona}`,{waitUntil:'networkidle',timeout:60000});
 await page.getByLabel('Mock persona').waitFor();
}
async function caseOf(name,fn){if(selectedCase&&!name.includes(selectedCase))return;try{await fn();result.checks.push({name,status:'PASS'});console.log('PASS '+name);}catch(e){result.checks.push({name,status:'FAIL',failure:String(e)});await page.screenshot({path:path.join(output,`failure-${result.checks.length}.png`)}).catch(()=>{});console.error('FAIL '+name+': '+String(e));}}
async function ask(question){await ops().getByRole('textbox',{name:'Question',exact:true}).fill(question);await ops().getByRole('button',{name:'Ask AI',exact:true}).click();}
async function send(prompt){if(!await native().isVisible().catch(()=>false))await page.getByRole('button',{name:'Open conversation',exact:true}).click();await native().getByRole('textbox',{name:'Message the agent',exact:true}).fill(prompt);await native().getByRole('button',{name:'Send message',exact:true}).click();}
async function injectFetch(mode,status=503){
 await page.evaluate(({mode,status})=>{
  const original=window.fetch.bind(window);const probe={calls:0,mode};window.__securityProbe=probe;
  window.fetch=(input,init)=>{
   const url=new URL(typeof input==='string'?input:input.url,location.origin);
   if(!url.pathname.endsWith('/operations/ask'))return original(input,init);
   probe.calls++;
   if(mode==='network')return Promise.reject(new TypeError('MOCK network disconnected'));
   if(mode==='delayed')return new Promise((resolve,reject)=>{const timer=setTimeout(()=>resolve(new Response(JSON.stringify({error:'MOCK late answer must not reappear'}),{status:503,headers:{'content-type':'application/json'}})),1500);init?.signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));},{once:true});});
   return Promise.resolve(new Response(JSON.stringify({error:status===413?'Request body too large':`MOCK denied ${status}`,...(status===429?{resetAt:'2026-10-10T00:00:00+08:00'}:{})}),{status,headers:{'content-type':'application/json'}}));
  };
 },{mode,status});
}
try{
 for(const status of [403,413,429,503])await caseOf(`Operations HTTP ${status}: visible error, cleared busy state, no invented result`,async()=>{
  await configure();await page.getByRole('button',{name:'Open Operations Ask AI',exact:true}).click();await injectFetch('status',status);await ask('Read my current orders');
  await ops().getByRole('alert').filter({hasText:status===413?'Request body too large':`MOCK denied ${status}`}).waitFor();
  assert.equal(await ops().getByRole('button',{name:'Ask AI',exact:true}).isEnabled(),true);
  assert.equal(await ops().getByRole('region',{name:'Orders from scoped evidence',exact:true}).count(),0);
  if(status===429)assert.match(await ops().innerText(),/Resets.*Malaysia time/);
 });
 await caseOf('Operations network failure preserves question and permits retry',async()=>{
  await configure();await page.getByRole('button',{name:'Open Operations Ask AI',exact:true}).click();await injectFetch('network');await ask('Read my jobs');await ops().getByText('MOCK network disconnected',{exact:true}).waitFor();
  assert.equal(await ops().getByRole('textbox',{name:'Question',exact:true}).inputValue(),'Read my jobs');
  assert.equal(await ops().getByRole('button',{name:'Ask AI',exact:true}).isEnabled(),true);
 });
 await caseOf('Operations cancel, close/reopen and role switch cannot revive old response',async()=>{
  await configure();await page.getByRole('button',{name:'Open Operations Ask AI',exact:true}).click();await injectFetch('delayed');await ask('Unique former Admin context');
  await ops().getByRole('button',{name:'Cancel',exact:true}).click();await ops().getByText('Request cancelled. You can retry or search manually.',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__securityProbe.calls),1);
  await ops().getByRole('button',{name:'Close',exact:true}).click();await page.getByLabel('Mock persona').selectOption('staff-technician');
  await page.getByRole('button',{name:'Open Operations Ask AI',exact:true}).click();await page.waitForTimeout(1700);
  assert.doesNotMatch(await ops().innerText(),/Unique former Admin context|MOCK late answer/);
 });
 for(const [prompt,reason] of [['[[malformed]]','malformed NDJSON'],['[[truncated]]','truncated stream'],['[[missing-fields]]','missing contract fields'],['Find knowledge [[invalid-ref]]','foreign citation'],['[[provider-request-rejected]]','provider request rejected']])await caseOf(`Native ${reason}: controlled error with no invalid canvas`,async()=>{
  await configure('agent');await send(prompt);await page.getByRole('alert').waitFor();assert.equal(await page.locator('[data-agent-view]').count(),0);assert.equal(await native().getByRole('button',{name:'Cancel request',exact:true}).count(),0);
 });
 await caseOf('Native hostile source text stays inert, without executable image/script nodes',async()=>{
  await configure('agent');await send('Find knowledge [[hostile-text]]');await page.locator('[data-agent-view="knowledge"]').waitFor();
  assert.equal(await page.locator("img[src='x']").count(),0);assert.equal(await page.evaluate(()=>window.__nativeAgentXss),undefined);assert.match(await canvas().innerText(),/<script>window\.__nativeAgentXss=1<\/script>/);
 });
 await caseOf('Native pending controls, cancellation and new conversation clear scope',async()=>{
  await configure('agent','delayed');await send('Compare MOCK-001 and MOCK-002');const input=native().getByRole('textbox',{name:'Message the agent',exact:true});
  await native().getByRole('button',{name:'Cancel request',exact:true}).waitFor();assert.equal(await input.isDisabled(),true);await native().getByRole('button',{name:'Cancel request',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Request cancelled.'}).waitFor();await native().getByRole('button',{name:'New conversation',exact:true}).click();await page.waitForTimeout(6000);
  assert.doesNotMatch(await native().innerText(),/Compare MOCK-001|Read recent orders/);assert.equal(await page.locator('[data-agent-view]').count(),0);
 });
 await caseOf('Native quota exhaustion is explicit and manual Operations link remains',async()=>{
  await configure('agent','quota-exhausted');await send('Read recent orders');await page.getByRole('alert').filter({hasText:"Today's Guest AI allowance is used up"}).waitFor();assert.ok(await page.getByRole('link',{name:'Operations',exact:true}).count()>0);
 });
 assert.ok(result.checks.length>0,'No matching browser cases');assert.deepEqual(result.pageErrors,[]);assert.deepEqual(result.blockedExternal,[]);
}catch(e){result.infrastructureFailure=String(e);process.exitCode=1;}
finally{clearTimeout(watchdog);await browser.close();result.status=result.infrastructureFailure||result.checks.some(c=>c.status==='FAIL')?'FAIL':'PASS';if(result.status==='FAIL')process.exitCode=1;await fs.writeFile(path.join(output,'browser-results.json'),JSON.stringify(result,null,2));console.log(`RESULT ${result.status}: ${result.checks.filter(c=>c.status==='PASS').length}/${result.checks.length}`);}
