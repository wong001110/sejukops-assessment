// Bounded real Guest reads/denials against the confirmed SejukOps Test only.
// Never creates staff, invokes AI, confirms proposals, changes quota or writes business data.
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const origin='http://127.0.0.1:3100',project='qobhjvrrpajoyvlgrkbx';
if(process.argv.slice(2).join(' ')!=='--allow-live')throw new Error('EXPLICIT_LIVE_OPT_IN_REQUIRED');
const env=parseEnv(await readFile('.env','utf8'));
assert.equal(new URL(env.NEXT_PUBLIC_SUPABASE_URL).href,`https://${project}.supabase.co/`);
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const result={project,scope:'Real Test Guest browser/cookie session and request rejection; no Staff/Owner login, paid AI, business write or DoS',checks:[],pageErrors:[],external:[],cleanup:'PENDING'};
const browser=await chromium.launch({headless:true,executablePath:'C:/Users/user/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe'});
const ctx=await browser.newContext({viewport:{width:1920,height:1080}});const page=await ctx.newPage();
const allowed=new Set([origin,`https://${project}.supabase.co`]);
await ctx.route('**/*',async r=>{const u=new URL(r.request().url());if(['http:','https:'].includes(u.protocol)&&!allowed.has(u.origin)){result.external.push(u.origin+u.pathname);await r.abort();}else await r.continue();});
page.on('pageerror',e=>result.pageErrors.push(e.message));page.setDefaultTimeout(15000);
const demo='c0bbac19-df6c-4068-87d0-d43c8d860705',owner='4a19bb4b-f81b-420f-a834-b9045d86cd07',fake='11111111-1111-4111-8111-111111111111';
let before,entered=false;
const headers={origin,'content-type':'application/json'};
async function check(path,method,status,data){const r=await ctx.request.fetch(origin+path,{method,headers,...(data?{data:JSON.stringify(data)}:{}),maxRedirects:0,timeout:60000});result.checks.push({method,path,status:r.status(),expected:status});assert.equal(r.status(),status,method+' '+path);return r;}
const hash=orders=>createHash('sha256').update(JSON.stringify([...orders].sort((a,b)=>a.id.localeCompare(b.id)))).digest('hex');
try{
 await page.goto(origin+'/demo',{waitUntil:'networkidle',timeout:120000});entered=true;await page.getByRole('button',{name:'Continue as Guest',exact:true}).click({timeout:90000});
 await page.waitForURL(new RegExp(`/workspaces/${demo}/orders`),{timeout:90000});await page.waitForLoadState('networkidle');
 before=hash((await (await check(`/api/workspaces/${demo}/orders`,'GET',200)).json()).orders);
 const providerRoutes=[['POST','/api/admin/ai-settings/providers'],['PATCH',`/api/admin/ai-settings/providers/${fake}`],['DELETE',`/api/admin/ai-settings/providers/${fake}`],['PUT','/api/admin/ai-settings/routing'],['POST','/api/admin/ai-settings/test'],['POST',`/api/admin/ai-settings/providers/${fake}/test`]];
 for(const role of ['ADMIN','MANAGER','TECHNICIAN']){
  if(role!=='ADMIN'){const r=await ctx.request.post(origin+'/api/demo/persona',{headers:{origin},form:{persona:role},maxRedirects:0});assert.equal(r.status(),303);await page.goto(origin+`/workspaces/${demo}/orders`,{waitUntil:'networkidle',timeout:60000});}
  assert.match(await page.locator('body').innerText(),new RegExp(role));
  const list=await check(`/api/workspaces/${demo}/orders`,'GET',200);const rows=(await list.json()).orders;
  result.checks.push({role,case:'scoped-read',visibleCount:rows.length,status:'PASS'});
  await check(`/api/workspaces/${owner}/orders`,'GET',403);
  await check(`/api/workspaces/${owner}/knowledge?query=filter`,'GET',403);
  await check(`/api/workspaces/${demo}/knowledge`,'POST',403,{action:'create',generation:1,title:'Forbidden Guest fixture',sourceLabel:'synthetic'});
  await check(`/api/workspaces/${demo}/assignment-proposals`,'POST',403,{orderId:fake,technicianId:fake,expectedUpdatedAt:'2026-10-09T00:00:00Z',scheduledAt:null,idempotencyKey:fake});
  await check(`/api/workspaces/${demo}/assignment-proposals/${fake}`,'POST',403,{confirm:true,previewToken:'0'.repeat(64)});
  await check('/api/admin/ai-settings','GET',403);
  if(role==='TECHNICIAN')await check(`/api/workspaces/${demo}/agent/run`,'POST',403,{prompt:'Read recent orders'});
 }
 for(const [method,path] of providerRoutes)await check(path,method,403,method==='DELETE'?undefined:{});
 const switchBack=await ctx.request.post(origin+'/api/demo/persona',{headers:{origin},form:{persona:'ADMIN'},maxRedirects:0});assert.equal(switchBack.status(),303);
 const after=hash((await (await check(`/api/workspaces/${demo}/orders`,'GET',200)).json()).orders);result.orderSnapshotUnchanged=before===after;assert.equal(before,after);
 assert.deepEqual(result.pageErrors,[]);assert.deepEqual(result.external,[]);result.status='PASS';
}catch(e){result.status='FAIL';result.failure=String(e);process.exitCode=1;}
finally{
 if(entered){try{const exit=await ctx.request.post(origin+'/api/demo/exit',{headers:{origin},maxRedirects:0});assert.equal(exit.status(),303);const denied=await ctx.request.get(origin+`/api/workspaces/${demo}/orders`,{maxRedirects:0});assert.equal(denied.status(),403);result.cleanup='PASS: Guest exit then fresh read denied';}catch{result.cleanup='FAIL';result.status='FAIL';process.exitCode=1;}}
 await browser.close();await mkdir('evals/security/.local',{recursive:true});await writeFile('evals/security/.local/live-guest.json',JSON.stringify(result,null,2));console.log(JSON.stringify({status:result.status,checks:result.checks.length,failure:result.failure,cleanup:result.cleanup,orderSnapshotUnchanged:result.orderSnapshotUnchanged,pageErrors:result.pageErrors}));
}
