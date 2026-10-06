// Load one virtual UI guard mutant; never modify the source or use real services.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
const reportDir = path.resolve('reports/conversation-layout-2026-10-06');
const tempDir = path.resolve('.agent/conversation-mutation');
await fs.mkdir(tempDir, { recursive: true }); await fs.mkdir(reportDir, { recursive: true });
const target = path.resolve('src/app/workspaces/[workspaceId]/native-agent-workspace.tsx');
const source = await fs.readFile(target, 'utf8');
const hash = value => createHash('sha256').update(value).digest('hex');
const original = 'busy={state !== "ready"}';
const replacement = 'busy={busy}';
const markerPath = path.join(tempDir, 'loaded.json');
if(source.split(original).length !== 2) throw new Error('Expected one stale-action guard');
async function execute(mutant) {
  const file = path.join(tempDir, mutant ? 'mutant.json' : 'baseline.json');
  const args = ['node_modules/vitest/vitest.mjs', 'run', 'src/app/workspaces/[workspaceId]/native-agent-workspace.test.tsx', '--maxWorkers=1', '--testNamePattern', 'blocks earlier proposal confirmation', '--reporter=json', `--outputFile=${file}`];
  const env = {...process.env};
  for(const key of Object.keys(env)) if(key.startsWith('SEJUK_MUTATION_')) delete env[key];
  if(mutant) { args.push('--config','tests/mutation/vitest.config.ts'); Object.assign(env,{ SEJUK_MUTATION_TARGET:target, SEJUK_MUTATION_ORIGINAL:original, SEJUK_MUTATION_REPLACEMENT:replacement, SEJUK_MUTATION_MARKER:markerPath }); }
  const outcome = await new Promise((resolve,reject) => { const child = spawn(process.execPath,args,{env,stdio:['ignore','pipe','pipe']}); let timedOut=false;const timer=setTimeout(()=>{timedOut=true;child.kill();},60000);child.stdout.resume();child.stderr.resume();child.on('error',error=>{clearTimeout(timer);reject(error)});child.on('close',exitCode=>{clearTimeout(timer);resolve({exitCode,timedOut})}); });
  const json = JSON.parse(await fs.readFile(file,'utf8'));
  const rows = json.testResults.flatMap(suite=>suite.assertionResults).filter(row=>['passed','failed'].includes(row.status));
  const failures = rows.filter(row=>row.status==='failed');
  if(outcome.timedOut || rows.length!==2 || failures.some(row=>row.failureMessages.some(message=>/timed out|syntaxerror|transform failed|cannot find module/i.test(message)))) throw new Error('Invalid mutation execution');
  return {...outcome,executed:rows.length,failures:failures.map(row=>({name:row.fullName,message:row.failureMessages.join('\n')}))};
}
const baseline=await execute(false);
if(baseline.exitCode!==0||baseline.failures.length) throw new Error('Baseline must pass');
const mutant=await execute(true);
const marker=JSON.parse(await fs.readFile(markerPath,'utf8'));
const valid=marker.status==='loaded'&&marker.loadedCount===1&&marker.occurrences===1;
const restored=hash(await fs.readFile(target,'utf8'))===hash(source);
const result={scope:'Targeted virtual source mutation; no real API/provider/database',baseline:{status:'PASS',executed:baseline.executed},mutant:{id:'earlier-canvas-confirmation-after-stop',status:valid&&mutant.exitCode!==0&&mutant.failures.length?'KILLED':'INVALID',target:'src/app/workspaces/[workspaceId]/native-agent-workspace.tsx',original,replacement,executed:mutant.executed,failures:mutant.failures},markerLoaded:valid,sourceUnchanged:restored};
await fs.writeFile(path.join(reportDir,'mutation-results.json'),JSON.stringify(result,null,2));
console.log(`${result.mutant.status}: ${mutant.failures.length} relevant assertion failures; source unchanged ${restored}`);
if(result.mutant.status!=='KILLED'||!restored) process.exitCode=1;
