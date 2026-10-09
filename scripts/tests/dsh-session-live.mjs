// Opt-in, bounded Test-only history integration: two read-only AI requests, no business/config changes.
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
if (process.argv.slice(2).join(' ') !== '--allow-live') throw new Error('EXPLICIT_LIVE_OPT_IN_REQUIRED');
const project = 'qobhjvrrpajoyvlgrkbx', origin = 'http://127.0.0.1:3101';
const env = parseEnv(await readFile('.env', 'utf8'));
assert.equal(new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname, `${project}.supabase.co`);
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const evidence = { project, scope: 'Real Test Guest cookie/API/browser history integration; at most two read-only AI requests (2 + 5 provider-step caps). No account creation, business mutation, config, reset or deployment.', checks: [], ai: [], errors: [], cleanup: 'PENDING' };
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Users/user/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe' });
const context = await browser.newContext({ viewport: { width: 1536, height: 864 } });
await context.route('**/*', async route => { const url = new URL(route.request().url()); if (['http:', 'https:'].includes(url.protocol) && ![origin, `https://${project}.supabase.co`].includes(url.origin)) await route.abort(); else await route.continue(); });
const page = await context.newPage(); page.setDefaultTimeout(30000);
page.on('pageerror', error => evidence.errors.push(error.message));
let entered = false, base, before;
const output = 'evals/ai/.local/dsh-reference-live.json';
const hash = orders => createHash('sha256').update(JSON.stringify([...orders].sort((a,b)=>a.id.localeCompare(b.id)))).digest('hex');
const pass = name => { evidence.checks.push(name); console.log(`PASS ${name}`); };
async function get(path, expected=200) { const r=await context.request.get(origin+path,{timeout:60000,maxRedirects:0}); assert.equal(r.status(),expected,path); return r; }
async function switchRole(persona) { const r=await context.request.post(origin+'/api/demo/persona',{headers:{origin},form:{persona},maxRedirects:0,timeout:60000}); assert.equal(r.status(),303); }
try {
  await page.goto(origin+'/demo',{timeout:90000,waitUntil:'domcontentloaded'}); entered=true;
  await page.getByRole('button',{name:'Continue as Guest',exact:true}).click();
  await page.waitForURL(/\/workspaces\/[^/]+\/orders/,{timeout:90000});
  base=new URL(page.url()).pathname.replace(/\/orders$/,'');
  before=hash((await (await get('/api'+base+'/orders')).json()).orders);
  for(const surface of ['CHATBOT','WORKSPACE']) assert.deepEqual((await (await get('/api'+base+`/ai-sessions?surface=${surface}`)).json()).sessions,[]);
  await get('/api/owner/ai-sessions',403); pass('Fresh Guest scoped lists succeed; Owner inspection denied');
  const budgetText=await page.getByText(/Guest AI:/).first().textContent().catch(()=> '');
  const remaining=Number(budgetText?.match(/Guest AI:\s*(\d+)\//)?.[1]);
  if(!Number.isFinite(remaining)||remaining<7) throw new Error('Insufficient visible shared AI allowance; no quota configuration changed');
  let chatSession;
  for(const surface of ['CHATBOT','WORKSPACE']) {
    const sessionId=randomUUID(), prompt='Show recent orders and their current status.';
    if(surface==='CHATBOT') chatSession=sessionId;
    const endpoint='/api'+base+(surface==='CHATBOT'?'/operations/ask':'/agent/run');
    const r=await context.request.post(origin+endpoint,{headers:{origin,'content-type':'application/json','X-Sejuk-Session':sessionId},data:surface==='CHATBOT'?{question:prompt}:{prompt},timeout:65000});
    const text=await r.text(); let completed=false, mode, status;
    if(surface==='CHATBOT'&&r.status()===200) { const body=JSON.parse(text); completed=true;status=body.status; assert.equal(r.headers()['x-sejuk-history'],'saved'); }
    if(surface==='WORKSPACE'&&r.status()===200) { const events=text.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)); const terminal=events.find(e=>e.type==='workspace'); if(terminal){completed=true;mode=terminal.workspace.mode;status=terminal.workspace.status;assert.equal(terminal.historySaved,true);assert.equal(mode,'live');assert.equal(terminal.workspace.proposal,null);} }
    const detail=await (await get('/api'+base+`/ai-sessions/${sessionId}?surface=${surface}`)).json();
    assert.equal(detail.turns.length,1); assert.equal(detail.turns[0].question,prompt);
    assert.equal(detail.turns[0].status,completed?'COMPLETED':'FAILED');
    assert((await (await get('/api'+base+`/ai-sessions?surface=${surface}`)).json()).sessions.some(s=>s.id===sessionId));
    evidence.ai.push({surface,httpStatus:r.status(),handlerOutcome:completed?'COMPLETED':'FAILED',providerResult:!completed?'UNAVAILABLE':status==='SOURCE_ONLY'?'SOURCE_ONLY':'COMPLETED',resultStatus:status,mode,recordedStatus:detail.turns[0].status});
    pass(`${surface}: actual handler outcome recorded and list/detail read succeeds`);
  }
  await page.goto(origin+base+'/orders',{waitUntil:'domcontentloaded',timeout:60000});
  await page.getByRole('button',{name:'Open Operations Ask AI',exact:true}).click();
  await page.getByRole('button',{name:'Conversation history',exact:true}).click();
  await page.getByRole('button',{name:/Show recent orders and their current status/}).click();
  await page.getByText('Recorded answer · ask again for current information',{exact:true}).waitFor();
  pass('Actual Guest browser restores the saved chatbot answer');
  await switchRole('MANAGER');
  await get('/api'+base+`/ai-sessions/${chatSession}?surface=CHATBOT`,404);
  assert.deepEqual((await (await get('/api'+base+'/ai-sessions?surface=CHATBOT')).json()).sessions,[]);
  await switchRole('TECHNICIAN'); await get('/api'+base+'/ai-sessions?surface=WORKSPACE',403);
  pass('Persona change cannot read prior Admin history; Technician native history denied');
  await switchRole('ADMIN'); assert.equal(hash((await (await get('/api'+base+'/orders')).json()).orders),before);
  evidence.orderSnapshotUnchanged=true; pass('Business orders remain unchanged');
  assert.deepEqual(evidence.errors,[]); evidence.result='PASS_HISTORY_INTEGRATION';
  evidence.liveProvider=evidence.ai.every(a=>a.providerResult==='COMPLETED')?'PASS_TWO_REQUESTS':'PARTIAL_OR_UNAVAILABLE';
} catch(error) { evidence.result='FAIL'; evidence.failure=String(error);process.exitCode=1; }
finally {
  if(entered)try { const r=await context.request.post(origin+'/api/demo/exit',{headers:{origin},maxRedirects:0,timeout:60000});assert.equal(r.status(),303);if(base)await get('/api'+base+'/ai-sessions?surface=CHATBOT',403);evidence.cleanup='PASS: visit revoked; history denied'; } catch(error){evidence.cleanup='FAIL';evidence.cleanupError=String(error);evidence.result='FAIL';process.exitCode=1;}
  await browser.close();await mkdir('evals/ai/.local',{recursive:true});await writeFile(output,JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
}
