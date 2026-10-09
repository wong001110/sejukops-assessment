// Opt-in confirmed-Test verification. "before" runs one diagnostic request;
// "after" verifies three role-scoped requests and the actual Admin chatbot.
// These mode names do not roll source backward. Outputs stay in ignored .local.
// Each request is read-only and capped by the existing two-step runtime/quota.
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const phase=process.argv[2];assert(['before','after'].includes(phase));assert.equal(process.argv[3],'--allow-live');
const origin='http://127.0.0.1:3101',project='qobhjvrrpajoyvlgrkbx';
const env=parseEnv(await readFile('.env','utf8'));assert.equal(new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname,`${project}.supabase.co`);
const require=createRequire(import.meta.url);const {chromium}=require('C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=await chromium.launch({headless:true,executablePath:'C:/Users/user/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe'});
const context=await browser.newContext({viewport:{width:1536,height:864}});
await context.route('**/*',async route=>{const url=new URL(route.request().url());if(['http:','https:'].includes(url.protocol)&&![origin,`https://${project}.supabase.co`].includes(url.origin))await route.abort();else await route.continue();});
const page=await context.newPage();page.setDefaultTimeout(45000);
const result={phase,project,scope:'Bounded read-only Operations Test requests; no business/config/model changes',checks:[],requests:[],pageErrors:[],cleanup:'PENDING'};
page.on('pageerror',()=>result.pageErrors.push('BROWSER_PAGE_ERROR'));
let entered=false,base;
const hash=orders=>createHash('sha256').update(JSON.stringify([...orders].sort((a,b)=>a.id.localeCompare(b.id)))).digest('hex');
const get=async path=>{const r=await context.request.get(origin+path,{timeout:90000});assert.equal(r.status(),200);return r.json();};
try{
  await page.goto(origin+'/demo',{waitUntil:'domcontentloaded',timeout:90000});entered=true;
  await page.getByRole('button',{name:'Continue as Guest',exact:true}).click();await page.waitForURL(/\/workspaces\/[^/]+\/orders/,{timeout:90000});
  base=new URL(page.url()).pathname.replace(/\/orders$/,'');const initial=hash((await get('/api'+base+'/orders')).orders);
  const allowance=await page.getByText(/Guest AI:/).first().textContent();const remaining=Number(allowance.match(/Guest AI:\s*(\d+)\//)?.[1]);assert(remaining>=(phase==='before'?2:6),'INSUFFICIENT_AI_ALLOWANCE');
  for(const role of phase==='before'?['ADMIN']:['ADMIN','MANAGER','TECHNICIAN']){
    if(role!=='ADMIN'){const changed=await context.request.post(origin+'/api/demo/persona',{headers:{origin},form:{persona:role},maxRedirects:0,timeout:60000});assert.equal(changed.status(),303);}
    const visible=(await get('/api'+base+'/orders')).orders;
    let response;
    if(phase==='after'&&role==='ADMIN'){
      await page.getByRole('button',{name:'Open Operations Ask AI',exact:true}).click();
      await page.getByLabel('Question',{exact:true}).fill('Show recent orders and their current status.');
      [response]=await Promise.all([page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.endsWith('/operations/ask'),{timeout:65000}),page.getByRole('button',{name:'Ask AI',exact:true}).click()]);
    }else response=await context.request.post(origin+'/api'+base+'/operations/ask',{headers:{origin,'content-type':'application/json'},data:{question:'Show recent orders and their current status.'},timeout:65000});
    const body=await response.json();result.requests.push({role,httpStatus:response.status(),status:body.status??null,traceId:body.traceId,orderCount:body.orders?.length??0});
    if(phase==='after'){
      assert.equal(response.status(),200);assert.equal(body.status,'EVIDENCE_FOUND');assert(body.orders.length>0);
      assert(body.orders.every(order=>visible.some(source=>source.id===order.id&&source.status===order.status)));
      if(role==='ADMIN'){
        await page.getByText(body.answer,{exact:true}).waitFor();
        await page.screenshot({path:'evals/ai/.local/ops-tool-after-live.png'});
        result.checks.push('Actual live chatbot sends the question and renders the verified answer');
      }
    }
  }
  if(phase==='after'){const changed=await context.request.post(origin+'/api/demo/persona',{headers:{origin},form:{persona:'ADMIN'},maxRedirects:0,timeout:60000});assert.equal(changed.status(),303);}
  assert.equal(hash((await get('/api'+base+'/orders')).orders),initial);result.checks.push('Business order snapshot unchanged');assert.deepEqual(result.pageErrors,[]);result.result=phase==='before'?'DIAGNOSTIC_CAPTURED':'PASS';
}catch{result.result='FAIL';result.safeFailure='BOUNDED_VALIDATION_FAILED';process.exitCode=1;}
finally{
  if(entered)try{const exit=await context.request.post(origin+'/api/demo/exit',{headers:{origin},maxRedirects:0,timeout:90000});assert.equal(exit.status(),303);if(base){const denied=await context.request.get(origin+'/api'+base+'/orders',{timeout:60000});assert.equal(denied.status(),403);}result.cleanup='PASS';}catch{result.cleanup='FAIL';result.result='FAIL';process.exitCode=1;}
  await browser.close();await writeFile(`evals/ai/.local/ops-tool-${phase}.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}
