import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validateCases,mapAssertions,writeReport,hasCaseId} from './report.mjs';
import {sourceFingerprint} from './source-fingerprint.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
process.chdir(root);
const sources = JSON.parse(fs.readFileSync('evals/ai/sources.json','utf8'));
const files = ['operations','workspace','insight','intake'].map(s=>`evals/ai/cases/${s}.json`);
const cases = validateCases(files.flatMap(f=>JSON.parse(fs.readFileSync(f,'utf8'))),sources);
const local = 'evals/ai/.local'; fs.mkdirSync(local,{recursive:true});
const sourceSha256=sourceFingerprint(root);
const rawFile = path.resolve(local,'vitest.json');
if (!process.argv.includes('--report-only') && fs.existsSync(rawFile)) fs.unlinkSync(rawFile); // Only this owned previous output; prevent stale-run PASS.
const supplemental = [
  'src/lib/ai/runtime/workspace-orders-agent.test.ts',
  'src/lib/ai/runtime/workspace-knowledge-agent.test.ts',
  'src/lib/services/workspace-orders/assignment-proposals.test.ts',
  'src/lib/ai/client/native-agent-stream.test.ts',
  'tests/document-understanding/text-extraction.test.ts',
];
const command = [path.resolve('node_modules/vitest/vitest.mjs'),'run','tests/ai-evaluation',...supplemental,'--maxWorkers=1','--reporter=json',`--outputFile=${rawFile}`];
const reportOnly = process.argv.includes('--report-only');
const receiptFile = `${local}/receipt.json`;
const previous = reportOnly && fs.existsSync(receiptFile) ? JSON.parse(fs.readFileSync(receiptFile,'utf8')) : null;
if (reportOnly && !previous) throw new Error('No execution receipt; run eval:ai first.');
const executed = reportOnly ? {status:previous.processExitCode} : spawnSync(process.execPath,command,{stdio:'inherit',windowsHide:true,timeout:180000});
if(sourceFingerprint(root)!==sourceSha256)throw new Error('Application source changed during execution; results cannot be published.');
const raw = fs.existsSync(rawFile) ? JSON.parse(fs.readFileSync(rawFile,'utf8')) : {testResults:[]};
const evaluated = mapAssertions(cases,raw);
const assertions = (raw.testResults??[]).flatMap(f=>f.assertionResults??[]);
const extra = assertions.filter(a=>!cases.some(c=>hasCaseId(a.fullName??a.title,c.id)));
const digestFiles = [...files,'evals/ai/sources.json','evals/ai/run.mjs','evals/ai/report.mjs','evals/ai/source-fingerprint.mjs','evals/ai/live.mjs','evals/ai/mutate.mjs',...fs.readdirSync('tests/ai-evaluation').filter(f=>f.endsWith('.test.ts')).map(f=>`tests/ai-evaluation/${f}`),...supplemental,
  'src/lib/ai/runtime/operations-ask.ts','src/lib/ai/runtime/workspace-native-agent.ts','src/lib/ai/runtime/dashboard-insight.ts','src/lib/services/document-understanding/runtime.ts','src/lib/services/document-understanding/validation.ts','src/lib/services/workspace-order-intake/draft.ts','src/lib/services/workspace-order-intake/confirm.ts'];
const walkSource = dir => fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walkSource(`${dir}/${e.name}`):/\.(ts|tsx)$/.test(e.name)?[`${dir}/${e.name}`]:[]);
digestFiles.push(...walkSource('src'),'package.json','pnpm-lock.yaml');
digestFiles.push('evals/ai/live-support.mjs','evals/ai/browser.mjs','scripts/tests/ui-browser/conversation-layout.mjs','tests/ui-browser/next-navigation.ts','tests/document-understanding/validation.test.ts','tests/fixtures/documents/complete-service-invoice.pdf.base64','vitest.config.ts','tests/helpers/ui-setup.ts');
const sha256 = Object.fromEntries(digestFiles.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')]));
const rawSha256 = fs.existsSync(rawFile) ? crypto.createHash('sha256').update(fs.readFileSync(rawFile)).digest('hex') : null;
if (reportOnly && (JSON.stringify(previous.sha256)!==JSON.stringify(sha256) || previous.rawSha256!==rawSha256)) throw new Error('Source, cases or execution output changed; rerun eval:ai before publishing.');
if (!reportOnly) fs.writeFileSync(receiptFile,JSON.stringify({sha256,rawSha256,processExitCode:executed.status},null,2));
const sourceCommit = execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim();
const optional = name => {
  if (!fs.existsSync(`${local}/${name}.json`)) return null;
  const record = JSON.parse(fs.readFileSync(`${local}/${name}.json`,'utf8'));
  if (record.sourceCommit !== sourceCommit || record.sourceSha256!==sourceSha256 || !record.generatedAt || record.generatedAt.slice(0,10)!==new Date().toISOString().slice(0,10)) return {summary:'NOT_RUN for this snapshot: stored evidence is stale or lacks source/date provenance.',cases:[]};
  return record;
};
const live = optional('live-result'), mutation = optional('mutation-result'), browser=optional('browser-result');
const pass = evaluated.every(c=>c.status==='PASS') && extra.every(a=>a.status==='passed') && executed.status===0;
const result = {schemaVersion:1,generatedAt:new Date().toISOString(),mockExecutedAt:raw.startTime?new Date(raw.startTime).toISOString():null,sourceCommit,sourceSha256,
  decision:pass?'PROCEED for this Mock scope only':'REPAIR — see actual failing or unexecuted cases',
  processExitCode:executed.status,runnerError:executed.error?.code??null,rawSha256,sha256,cases:evaluated,
  supplementalSummary:`${extra.filter(a=>a.status==='passed').length} passed / ${extra.filter(a=>a.status==='failed').length} failed / ${extra.filter(a=>a.status!=='passed'&&a.status!=='failed').length} skipped or pending existing regression/dataset-validator assertions.`,
  supplemental:extra.map(a=>({name:a.fullName,status:a.status})), live,mutation,browser};
const out = path.resolve('evals/ai/results',new Date().toISOString().slice(0,10));
writeReport(out,result,sources);
console.log(`AI evaluation: ${cases.length} catalog cases; report ${path.relative(root,out)}/index.html`);
process.exitCode=pass?0:1;
