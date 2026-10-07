import fs from 'node:fs';
import path from 'node:path';

export function validateCases(cases, sources) {
  if (!Array.isArray(cases) || !cases.length) throw new Error('Empty case manifest');
  const seen = new Set(), sourceIds = new Set(sources.map(s => s.id));
  for (const c of cases) {
    if (!/^(OPS|WS|INS|INT)-\d{3}$/.test(c.id) || seen.has(c.id)) throw new Error(`Invalid or duplicate case ID: ${c.id}`);
    seen.add(c.id);
    if (!['operations', 'workspace', 'insight', 'intake'].includes(c.surface) || !['functional','grounding','security','resilience'].includes(c.category) || !['ADMIN','MANAGER','TECHNICIAN'].includes(c.actorRole) || !['critical','high','medium'].includes(c.severity) || c.execution !== 'mock' || typeof c.isGuest !== 'boolean' || typeof c.liveCandidate !== 'boolean') throw new Error(`Invalid metadata: ${c.id}`);
    for (const key of ['scenario','input','expected']) if (typeof c[key] !== 'string' || !c[key].trim()) throw new Error(`Missing ${key}: ${c.id}`);
    for (const key of ['checks','sourceIds','tags']) if (!Array.isArray(c[key]) || !c[key].length || c[key].some(x => typeof x !== 'string' || !x.trim())) throw new Error(`Missing ${key}: ${c.id}`);
    if (c.sourceIds.some(id => !sourceIds.has(id))) throw new Error(`Unknown reference: ${c.id}`);
  }
  return cases;
}

export function hasCaseId(name, id) {
  return new RegExp(`(?:^|\\s)${id}(?=\\s|:|$)`).test(name ?? '');
}

export function mapAssertions(cases, run) {
  const assertions = (run.testResults ?? []).flatMap(file => file.assertionResults ?? []);
  return cases.map(c => {
    const found = assertions.filter(a => {
      const ids = cases.filter(candidate => hasCaseId(a.title, candidate.id));
      return ids.length === 1 && ids[0].id === c.id && a.title.startsWith(c.id) &&
        a.status !== undefined;
    });
    const status = found.length !== 1 ? 'NOT_RUN' : ({passed:'PASS',failed:'FAIL',pending:'SKIP',skipped:'SKIP',todo:'SKIP'}[found[0].status] ?? 'NOT_RUN');
    return {...c, status, evidenceKind:'mock-runtime', durationMs:found.length === 1 ? (found[0].duration ?? null) : null,
      failure:status === 'FAIL' ? (found[0].failureMessages ?? []).join('\n').replace(/\u001b\[[0-9;]*m/g,'').slice(0,1800) : status === 'NOT_RUN' ? `Expected exactly one executed assertion, found ${found.length}.` : null};
  });
}

const esc = x => String(x ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function writeReport(dir, result, sources) {
  fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2)+'\n');
  const counts = Object.fromEntries(['PASS','FAIL','SKIP','NOT_RUN'].map(s=>[s,result.cases.filter(c=>c.status===s).length]));
  const rows = result.cases.map(c=>`<tr data-search="${esc([c.id,c.surface,c.category,c.actorRole,c.isGuest?'Guest':'Staff',c.scenario,c.tags.join(' '),c.status].join(' ').toLowerCase())}" data-status="${c.status}"><td><strong>${c.id}</strong><br><span class="status ${c.status}">${c.status}</span></td><td>${esc(c.surface)}<br>${esc(c.actorRole)} ${c.isGuest?'· Guest':''}</td><td>${esc(c.category)}<br>${esc(c.severity)}</td><td><b>${esc(c.input)}</b><p>${esc(c.expected)}</p><small>${esc(c.checks.join(' · '))}</small>${c.failure?`<details><summary>Actual failure</summary><pre>${esc(c.failure)}</pre></details>`:''}</td><td>Mock runtime<br>${esc(c.durationMs)} ms<br><small>Live candidate: ${c.liveCandidate?'yes':'no'} (not a result)</small></td></tr>`).join('');
  const live = result.live?.cases ?? [];
  const liveRows = live.map(c=>`<tr><td>${esc(c.id)}</td><td>${esc(c.role ?? c.actorRole)}</td><td>${esc(c.status)}</td><td>${esc(c.evidenceKind)}</td><td>${esc(c.summary ?? c.sanitizedCode ?? c.errorCode ?? c.reason ?? c.passedChecks?.join(' · ') ?? c.checks?.join(' · '))}</td></tr>`).join('');
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sejuk Ops · AI Evaluation</title><style>body{font:15px/1.55 system-ui;background:#f5f7fb;color:#18263b;margin:0}main{max-width:1300px;margin:auto;padding:32px}h1{margin-bottom:8px}section,.notice{background:white;padding:22px;border-radius:12px;margin:20px 0;border:1px solid #dbe2ec}.stats{display:flex;gap:14px;flex-wrap:wrap}.stats div{background:white;padding:15px 25px;border-radius:8px}table{width:100%;border-collapse:collapse;table-layout:fixed}td,th{vertical-align:top;text-align:left;padding:14px;border-bottom:1px solid #dde3ed;overflow-wrap:anywhere}th{background:#edf1f8}td:first-child{width:90px}p{margin:8px 0}small{color:#53647b}input,select{padding:10px;border:1px solid #becadd;border-radius:6px;margin:8px 8px 14px 0}.status{font-weight:700}.PASS{color:#087c48}.FAIL{color:#b31c32}.SKIP,.NOT_RUN{color:#956118}pre{white-space:pre-wrap;background:#f7e9eb;padding:12px;font-size:12px}code{overflow-wrap:anywhere}li{margin:7px 0}@media(max-width:700px){main{padding:12px}table{table-layout:auto}td,th{padding:8px}}</style><main><h1>Sejuk Ops · AI Evaluation</h1><p>Operations Ask AI · AI Workspace · Dashboard Insight · Document Intake</p><div class="stats">${Object.entries(counts).map(([s,n])=>`<div><b class="${s}">${n} ${s}</b></div>`).join('')}</div><div class="notice"><b>Scoped decision: ${esc(result.decision)}</b><p>Executed ${esc(result.generatedAt)}. Source base commit <code>${esc(result.sourceCommit)}</code>. The executed working-tree candidate is identified by source/file SHA-256 in result.json; the base commit may precede pending edits.</p><p>Mock tests exercise actual runtime and service code with synthetic models and fixtures. They validate containment and contracts; they do not establish real model accuracy, prompt-injection resistance, real RLS or browser usability. No human UAT is claimed.</p></div><section><h2>Dataset-backed Mock results</h2><input id="search" aria-label="Filter cases" placeholder="Search role, injection, dates, case ID…"><select id="status" aria-label="Filter status"><option value="">All statuses</option>${Object.keys(counts).map(s=>`<option>${s}</option>`).join('')}</select><table><thead><tr><th style="width:9%">Case</th><th style="width:14%">Surface / actor</th><th style="width:12%">Risk</th><th>Input, expected behavior and checks</th><th style="width:17%">Evidence</th></tr></thead><tbody id="cases">${rows}</tbody></table></section><section><h2>Live / browser evidence</h2><p>${esc(result.live?.summary ?? 'NOT_RUN. Run the bounded local live harness separately; a liveCandidate flag never counts as PASS.')}</p>${live.length?`<table><thead><tr><th>ID</th><th>Role</th><th>Status</th><th>Evidence</th><th>Observed checks</th></tr></thead><tbody>${liveRows}</tbody></table>`:''}<p>Human UAT: NOT_RUN. Hosted deployment and MCP: outside this batch.</p></section><section><h2>Additional executed regression</h2><p>${esc(result.supplementalSummary)}</p><p>These tests cover the SDK transport, requested-date parser, Operations and native runtimes, route/privacy diagnostics, contextual Order Assist, direct knowledge retrieval, proposal authorization/replay, document parser and native stream boundaries. Their counts are separate from dataset cases.</p><h2>Mutation checks</h2><p>${esc(result.mutation?.summary ?? 'NOT_RUN. No mutation coverage claim.')}</p></section><section><h2>Research references</h2><p>Original fictional cases, informed by these taxonomies. No external benchmark was copied and no external red-team service received project content.</p><ul>${sources.map(s=>`<li><a href="${esc(s.url.startsWith('http')?s.url:'../../../../docs/ARCHITECTURE.md')}">${esc(s.title)}</a> — ${esc(s.use)}</li>`).join('')}</ul><p>Reference review: 7 October 2026. Promptfoo is a methodology reference; it is not installed or invoked.</p></section></main><script>const filter=()=>{const q=document.querySelector('#search').value.toLowerCase(),s=document.querySelector('#status').value;document.querySelectorAll('#cases tr').forEach(r=>r.hidden=!r.dataset.search.includes(q)||(s&&r.dataset.status!==s))};document.querySelector('#search').addEventListener('input',filter);document.querySelector('#status').addEventListener('change',filter)</script></html>`;
  const browserSection=`<section><h2>Rendered Mock browser checks</h2><p>${esc(result.browser?.summary??'NOT_RUN. Runtime unit tests do not prove browser behavior.')}</p><ul>${(result.browser?.cases??[]).map(c=>`<li><b>${esc(c.status)}</b> · ${esc(c.summary)}</li>`).join('')}</ul></section>`;
  const finalHtml=html.replace(`Executed ${esc(result.generatedAt)}.`, `Mock executed ${esc(result.mockExecutedAt??'NOT_RUN')}. Report generated ${esc(result.generatedAt)}.`).replace('<section><h2>Additional executed regression',browserSection+'<section><h2>Additional executed regression');
  fs.writeFileSync(path.join(dir,'index.html'),finalHtml);
}
