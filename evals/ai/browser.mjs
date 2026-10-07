import fs from 'node:fs';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {sourceFingerprint} from './source-fingerprint.mjs';
const root=process.cwd(),output=path.resolve('evals/ai/.local/browser');fs.mkdirSync(output,{recursive:true});
const rawFile=path.join(output,'browser-results.json');if(fs.existsSync(rawFile))fs.unlinkSync(rawFile);
const sourceSha256=sourceFingerprint(root);
const run=spawnSync(process.execPath,['scripts/tests/ui-browser/conversation-layout.mjs'],{env:{...process.env,UI_EVAL_OUTPUT:output},stdio:'inherit',windowsHide:true,timeout:180000});
const raw=fs.existsSync(rawFile)?JSON.parse(fs.readFileSync(rawFile,'utf8')):null;
const status=run.status===0&&raw?.result==='PASS'&&sourceFingerprint(root)===sourceSha256?'PASS':raw?'FAIL':'NOT_RUN';
const result={sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim(),sourceSha256,generatedAt:new Date().toISOString(),status,evidenceKind:'mock-ui',
  summary:`${status}: ${raw?.checks?.length??0} actual rendered browser checks at device, tablet and mobile viewports. Synthetic MSW replies only; no provider, real Auth or database acceptance.`,
  cases:raw?.checks?.map((c,i)=>({id:`UI-${String(i+1).padStart(3,'0')}`,status:c.result,summary:c.name,evidenceKind:'mock-ui'}))??[],
  externalRequestCount:raw?.externalRequests?.length??null,pageErrorCount:raw?.errors?.length??null,failure:raw?.failure??run.error?.code??null};
fs.writeFileSync('evals/ai/.local/browser-result.json',JSON.stringify(result,null,2)+'\n');process.exitCode=status==='PASS'?0:1;
