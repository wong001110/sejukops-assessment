import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {sourceFingerprint} from './source-fingerprint.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'); process.chdir(root);
const dir=path.resolve('evals/ai/.local/mutations');fs.mkdirSync(dir,{recursive:true});
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const definitions=[
  {id:'MUT-EXCERPT',file:'src/lib/ai/runtime/operations-ask.ts',test:'tests/ai-evaluation/operations.test.ts',title:'OPS-011',
    changes:[['!hit.content.includes(item.excerpt)','false'],['hit.content.includes(excerpt.text)','true']]},
  {id:'MUT-GENERATION',file:'src/lib/ai/runtime/operations-ask.ts',test:'tests/ai-evaluation/operations.test.ts',title:'OPS-023',
    changes:[['if (freshGeneration !== generation) throw new OperationsAskError("STALE");','if (false) throw new OperationsAskError("STALE");']]},
  {id:'MUT-AMBIGUOUS-JSON',file:'src/lib/services/document-understanding/validation.ts',test:'tests/document-understanding/validation.test.ts',title:'rejects multiple valid objects as ambiguous',
    changes:[['if (parseable.length !== 1) throw invalidAIResponse();','if (parseable.length === 0) throw invalidAIResponse();']]},
  {id:'MUT-REQUESTED-DATE',file:'src/lib/ai/runtime/workspace-native-agent.ts',test:'tests/ai-evaluation/workspace.test.ts',title:'WS-022',
    changes:[['if (!matchesScheduleIntent(scheduleIntent, scheduledAt)) throw new WorkspaceNativeAgentError("TOOL_FAILED");','if (false) throw new WorkspaceNativeAgentError("TOOL_FAILED");']]},
];
const records=[];
for(const d of definitions){
  const original=fs.readFileSync(d.file); let mutated=original.toString('utf8');
  for(const [find,replace] of d.changes){if(mutated.split(find).length!==2) throw new Error(`Mutation site not unique: ${d.id}`);mutated=mutated.replace(find,replace);}
  // Virtual modules only; relative runtime dependency remains the real installed source.
  mutated=mutated.replace('from "./workspace-orders-agent"','from "@/lib/ai/runtime/workspace-orders-agent"');
  mutated=mutated.replace(/from "\.\/([^\"]+)"/g, 'from "@/lib/ai/runtime/$1"');
  const mutant=path.join(dir,`${d.id}.ts`);fs.writeFileSync(mutant,mutated);
  const config=path.join(dir,`${d.id}.config.mjs`),alias=`@/${d.file.slice(4,-3)}`,raw=path.join(dir,`${d.id}.json`);
  const baseAliases=[{find:'@',replacement:path.resolve('src')},{find:'server-only',replacement:path.resolve('tests/helpers/server-only.ts')}];
  const run=enabled=>{
    fs.writeFileSync(config,`export default ${JSON.stringify({resolve:{alias:[...(enabled?[{find:alias,replacement:mutant}]:[]),...baseAliases]},test:{environment:'node',include:[d.test],setupFiles:['./tests/helpers/ui-setup.ts']}})};`);
    if(fs.existsSync(raw))fs.unlinkSync(raw);
    const r=spawnSync(process.execPath,[path.resolve('node_modules/vitest/vitest.mjs'),'run',d.test,'--config',config,'--maxWorkers=1','-t',d.title,'--reporter=json',`--outputFile=${raw}`],{stdio:'pipe',windowsHide:true,timeout:60000});
    const data=fs.existsSync(raw)?JSON.parse(fs.readFileSync(raw,'utf8')):null;
    const matches=(data?.testResults??[]).flatMap(t=>t.assertionResults??[]).filter(a=>a.title===d.title||a.title.startsWith(`${d.title} `)||a.title.startsWith(`${d.title}:`));
    return {exit:r.status,matches};
  };
  const baseline=run(false),actual=baseline.matches.length===1&&baseline.matches[0].status==='passed'?run(true):null;
  const unchanged=hash(fs.readFileSync(d.file))===hash(original);
  if(!unchanged)throw new Error(`Original source changed unexpectedly: ${d.file}`);
  const status=!actual?'NOT_RUN':actual.matches.length===1&&actual.matches[0].status==='failed'&&actual.exit!==0?'KILLED':actual.matches.length===1&&actual.matches[0].status==='passed'?'SURVIVED':'INVALID';
  records.push({id:d.id,status,file:d.file,targetAssertion:d.title,originalSha256:hash(original),mutantSha256:hash(mutated),originalUnchanged:unchanged,baselineStatus:baseline.matches[0]?.status??'NOT_RUN',mutantStatus:actual?.matches[0]?.status??'NOT_RUN',
    failure:status==='KILLED'?(actual.matches[0].failureMessages??[]).join('\n').replace(/\u001b\[[0-9;]*m/g,'').slice(0,1500):null});
  console.log(`${d.id}: ${status} (original unchanged: ${unchanged})`);
}
const result={sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim(),sourceSha256:sourceFingerprint(root),generatedAt:new Date().toISOString(),
  summary:`${records.filter(r=>r.status==='KILLED').length}/${records.length} selected guard mutations killed, each after its target baseline passed. Virtual source copies only; original source hashes unchanged. This is targeted sensitivity evidence, not a full mutation score.`,cases:records};
fs.writeFileSync('evals/ai/.local/mutation-result.json',JSON.stringify(result,null,2)+'\n');
process.exitCode=records.every(r=>r.status==='KILLED')?0:1;
