// Bounded read-only Test page/API smoke. No provider request or business/config mutation.
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
if (process.argv.slice(2).join(' ') !== '--allow-live') throw new Error('EXPLICIT_LIVE_OPT_IN_REQUIRED');
const project='qobhjvrrpajoyvlgrkbx', origin='http://127.0.0.1:3101';
const env=parseEnv(await readFile('.env','utf8'));
assert.equal(new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname,`${project}.supabase.co`);
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=await chromium.launch({headless:true,executablePath:'C:/Users/user/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe'});
const context=await browser.newContext({viewport:{width:1536,height:864}});
const evidence={project,scope:'Actual local Next.js + confirmed Supabase Test Guest page/history/access reads. Zero provider calls; no business/config writes. Guest entry/persona/exit only.',checks:[],errors:[],forbiddenRequests:[],cleanup:'PENDING'};
await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  const allowedOrigins=[origin,`https://${project}.supabase.co`];
  const allowedPosts=['/api/demo/entry','/api/demo/persona','/api/demo/exit'];
  if(['http:','https:'].includes(url.protocol)&&(!allowedOrigins.includes(url.origin)||url.origin===origin&&request.method()==='POST'&&!allowedPosts.includes(url.pathname))){ evidence.forbiddenRequests.push({method:request.method(),path:url.pathname});await route.abort(); }
  else await route.continue();
});
const page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>evidence.errors.push(e.message));
const pass=name=>{evidence.checks.push(name);console.log(`PASS ${name}`);};
const hash=orders=>createHash('sha256').update(JSON.stringify([...orders].sort((a,b)=>a.id.localeCompare(b.id)))).digest('hex');
let entered=false,base,before;
async function get(path,status=200){const r=await context.request.get(origin+path,{timeout:60000,maxRedirects:0});assert.equal(r.status(),status,path);return r;}
async function role(persona){const r=await context.request.post(origin+'/api/demo/persona',{headers:{origin},form:{persona},maxRedirects:0,timeout:60000});assert.equal(r.status(),303);}
try{
  await page.goto(origin+'/demo',{timeout:90000,waitUntil:'domcontentloaded'});
  entered=true; await page.getByRole('button',{name:'Continue as Guest',exact:true}).click({noWaitAfter:true});
  await page.waitForURL(/\/workspaces\/[^/]+\/orders/,{timeout:90000});base=new URL(page.url()).pathname.replace(/\/orders$/,'');
  before=hash((await(await get('/api'+base+'/orders')).json()).orders);
  for(const [label,size]of[['desktop',{width:1536,height:864}],['mobile',{width:390,height:844}]]){
    await page.setViewportSize(size);await page.goto(origin+base+'/agent',{timeout:90000,waitUntil:'domcontentloaded'});
    await page.getByRole('textbox',{name:'Message the agent',exact:true}).waitFor();
    if(size.width<=760)await page.getByRole('button',{name:'Open conversations',exact:true}).click();
    await page.getByText('No saved conversations yet',{exact:true}).waitFor();
    if(size.width<=760)await page.getByRole('dialog',{name:'Your conversations',exact:true}).getByRole('button',{name:'Close',exact:true}).click();
    const metrics=await page.locator('.native-composer').evaluate(e=>{const r=e.getBoundingClientRect();return{bottom:r.bottom,height:innerHeight,width:document.documentElement.scrollWidth,viewport:innerWidth};});
    assert(metrics.bottom<=metrics.height+1);assert(metrics.width<=metrics.viewport+1);pass(`Real Guest ${label} studio loads; private history empty; composer inside viewport`);
  }
  await get('/api/owner/ai-sessions',403);
  await page.goto(origin+'/owner/console',{waitUntil:'domcontentloaded',timeout:90000});
  await page.waitForURL(/\/owner\/login/,{timeout:60000});
  assert.equal(await page.getByRole('textbox',{name:'Message the agent',exact:true}).count(),0);
  pass('Guest cannot inspect Owner sessions; Owner Console redirects to Owner login');
  await role('MANAGER');assert.deepEqual((await(await get('/api'+base+'/ai-sessions?surface=WORKSPACE')).json()).sessions,[]);
  await role('TECHNICIAN');await get('/api'+base+'/ai-sessions?surface=WORKSPACE',403);
  await page.goto(origin+base+'/agent',{waitUntil:'domcontentloaded',timeout:90000});
  await page.getByText('Page not found',{exact:true}).waitFor();
  assert.equal(await page.getByRole('textbox',{name:'Message the agent',exact:true}).count(),0);
  pass('Manager history remains scoped; Technician native page/history denied');
  await role('ADMIN');assert.equal(hash((await(await get('/api'+base+'/orders')).json()).orders),before);
  evidence.orderSnapshotUnchanged=true;assert.deepEqual(evidence.errors,[]);assert.deepEqual(evidence.forbiddenRequests,[]);evidence.result='PASS';pass('Business order snapshot unchanged; no provider requests or browser errors');
}catch(error){evidence.result='FAIL';evidence.failure=String(error);process.exitCode=1;}
finally{
  if(entered)try{const r=await context.request.post(origin+'/api/demo/exit',{headers:{origin},maxRedirects:0,timeout:60000});assert.equal(r.status(),303);if(base)await get('/api'+base+'/ai-sessions?surface=WORKSPACE',403);evidence.cleanup='PASS: Guest visit revoked and history denied';}catch(error){evidence.cleanup='FAIL';evidence.cleanupError=String(error);process.exitCode=1;}
  await browser.close();await mkdir('evals/ai/.local',{recursive:true});await writeFile('evals/ai/.local/studio-layout-live.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
}
