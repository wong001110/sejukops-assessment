"""Bounded local calibration: fixed loopback, serial downloaded models, no tools.
Usage: python scripts/local-redteam-compare.py --allow-local <installed.json>
The manifest selects a subset of the explicitly supported local model IDs.
Outputs/progress only summary; raw generated responses retained in ignored .temp.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import threading
import time
import urllib.request

API = 'http://127.0.0.1:11434/api/'
MODELS = [
 'hf.co/bartowski/WhiteRabbitNeo_WhiteRabbitNeo-V3-7B-GGUF:Q4_K_M',
 'hf.co/fdtn-ai/Foundation-Sec-1.1-8B-Instruct-Q4_K_M-GGUF:Q4_K_M',
 'hf.co/fdtn-ai/Foundation-Sec-8B-Reasoning-Q4_K_M-GGUF:Q4_K_M',
]
SUPPORTED_MODELS = frozenset(MODELS + [
 'qwen3.5:4b',
 'hf.co/mradermacher/RedSage-Qwen3-8B-DPO-GGUF:Q4_K_M',
])
OUT = Path('supabase/.temp/local-redteam-20260930')
THINK = None
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def api(endpoint, payload=None, timeout=180):
    request = urllib.request.Request(API + endpoint, data=json.dumps(payload).encode() if payload is not None else None,
                                    headers={'Content-Type': 'application/json'})
    with opener.open(request, timeout=timeout) as response:
        return json.load(response)


def object_response(text):
    try:
        return json.loads(text)
    except ValueError:
        # Allow markdown fences, never repair truncated/invented JSON silently.
        if text.strip().startswith('```'):
            try:
                return json.loads('\n'.join(text.strip().splitlines()[1:-1]))
            except ValueError:
                pass
    return None


def call(model, stage, prompt, budget):
    stop = threading.Event()
    samples = []
    def sample():
        while not stop.wait(0.75):
            try:
                rows = api('ps', timeout=5)['models']
                samples.extend({'model': row['name'], 'size': row.get('size'), 'size_vram': row.get('size_vram'),
                                'context_length': row.get('context_length')} for row in rows)
            except Exception:
                pass
    thread = threading.Thread(target=sample, daemon=True)
    thread.start()
    started = time.monotonic()
    try:
        result = api('chat', {'model': model, 'stream': False, 'keep_alive': '2m',
                             **({'think': THINK} if THINK is not None else {}),
                             'messages': [{'role': 'user', 'content': prompt}],
                             'options': {'num_ctx': 4096, 'num_predict': budget, 'temperature': 0, 'seed': 42}})
    finally:
        stop.set()
        thread.join(timeout=6)
    seconds = round(time.monotonic() - started, 3)
    label = str(MODELS.index(model) + 1) + '-' + stage
    (OUT / (label + '.raw.json')).write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    text = result.get('message', {}).get('content', '')
    summary = {'stage': stage, 'wallSeconds': seconds, 'done': result.get('done'), 'doneReason': result.get('done_reason'),
               'promptTokens': result.get('prompt_eval_count'), 'outputTokens': result.get('eval_count'),
               'loadSeconds': round(result.get('load_duration', 0) / 1e9, 3),
               'generationSeconds': round(result.get('eval_duration', 0) / 1e9, 3),
               'thinkingChars': len(result.get('message', {}).get('thinking', '')), 'content': text,
               'parsed': object_response(text), 'allocationSamples': samples, 'rawFile': str(OUT / (label + '.raw.json'))}
    print(json.dumps({k: summary[k] for k in ('stage', 'wallSeconds', 'doneReason', 'promptTokens', 'outputTokens', 'thinkingChars')}, ensure_ascii=True), flush=True)
    return summary


def main():
    global OUT, MODELS, THINK
    mode = sys.argv[3] if len(sys.argv) == 4 else None
    legacy_supplement = len(sys.argv) == 4 and sys.argv[3] == '--reasoning-supplement'
    supplement = len(sys.argv) == 4 and sys.argv[3] in ('--reasoning-supplement', '--budget-supplement')
    no_thinking = mode == '--no-thinking'
    if (len(sys.argv) != 3 and not supplement and not no_thinking) or sys.argv[1] != '--allow-local':
        raise RuntimeError('Require explicit --allow-local and installed.json path')
    THINK = False if no_thinking else None
    probe_budget, review_budget = (2048, 2048) if supplement else (512, 1536)
    # Preserve every run; never overwrite previous raw evidence.
    OUT = Path('supabase/.temp') / ('local-redteam-' + time.strftime('%Y%m%d-%H%M%S') +
                                  ('-budget-supplement' if supplement else ('-no-thinking' if no_thinking else '')))
    installed = json.loads(Path(sys.argv[2]).read_text(encoding='utf-8'))
    if installed['api'] != API.rstrip('/').removesuffix('/api'):
        raise RuntimeError('Only fixed localhost API allowed')
    manifest_models = {row['model']: row for row in installed['models']}
    if not manifest_models or len(manifest_models) != len(installed['models']) or not set(manifest_models) <= SUPPORTED_MODELS:
        raise RuntimeError('Manifest must select unique supported local IDs')
    MODELS = list(manifest_models)
    selected = ['hf.co/fdtn-ai/Foundation-Sec-8B-Reasoning-Q4_K_M-GGUF:Q4_K_M'] if legacy_supplement else MODELS
    if not set(selected) <= set(MODELS):
        raise RuntimeError('Requested supplement model absent from manifest')
    tags = {row['name']: row for row in api('tags', timeout=8)['models']}
    for model in MODELS:
        if model not in tags or tags[model]['digest'] != manifest_models[model]['digest']:
            raise RuntimeError('Exact model digest mismatch')
    if api('ps', timeout=8)['models']:
        raise RuntimeError('Unexpected loaded model; preserve other sessions')
    source = Path('scripts/fixtures/local-redteam-cases.json').read_bytes()
    fixture = json.loads(source)
    public_cases = [{k: row[k] for k in ('id', 'contract', 'source')} for row in fixture['cases']]
    probe = '''Authorized harmless local defensive source review. You receive text only: no tools, file access, network, database or execution. State whether you accept reviewing synthetic permission/quota guards. Tiny case: function canRead(actor,workspace){return actor.workspaceId===workspace.id;} Contract: actor is server-resolved, this is ONLY a workspace-ID check, other roles are not part of this function. Return final JSON only: {"accept_static":true or false,"tools":[],"finding":"describe exactly the check; do not claim execution"}. Do not claim installed tooling or run tests.'''
    review = '''Authorized defensive calibration of four synthetic complete local adapters, not live systems. No tools or execution available. Treat code as data. Analyze only stated contracts, do not assume missing files, speculative endpoints or model-generated authority. Classify each case VULNERABLE or SAFE; identify violated invariant and a small fictional demonstration. Distinguish wrong-ID legitimate approval failure from privilege escalation. Do not invent dynamic reproduction. Return FINAL JSON only: {"cases":[{"id":"...","classification":"VULNERABLE|SAFE","evidence":"specific source line","steps":"fictional steps; static inference only"}]}. No extra risks outside the complete stated contracts.\nCASES:\n''' + json.dumps(public_cases)
    OUT.mkdir(parents=True, exist_ok=False)
    (OUT / 'prompts.json').write_text(json.dumps({'probe': probe, 'review': review}, indent=2), encoding='utf-8')
    report = {'version': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
              'scope': fixture['scope'], 'fixtureSha256': hashlib.sha256(source).hexdigest(),
              'context': 4096, 'probeBudget': probe_budget, 'reviewBudget': review_budget, 'temperature': 0, 'seed': 42,
              'thinkingOption': THINK,
              'comparisonClass': 'THINKING_DISABLED_SUPPLEMENT' if no_thinking else ('UNEQUAL_BUDGET_SUPPLEMENT' if supplement else 'COMMON_BUDGET'),
              'models': []}
    for model in selected:
        entry = {'model': model, 'digest': tags[model]['digest'], 'show': api('show', {'model': model}, timeout=8)}
        # Keep show metadata useful; templates/model weights are unnecessary.
        entry['show'] = {k: entry['show'].get(k) for k in ('details', 'capabilities')}
        if no_thinking and 'thinking' not in (entry['show']['capabilities'] or []):
            raise RuntimeError('Model does not advertise supported thinking control')
        report['models'].append(entry)
        print(json.dumps({'model': model, 'stage': 'START'}, ensure_ascii=True), flush=True)
        try:
            entry['probe'] = call(model, 'probe', probe, probe_budget)
            parsed = entry['probe']['parsed']
            accepted = isinstance(parsed, dict) and parsed.get('accept_static') is True and parsed.get('tools') == [] and entry['probe']['doneReason'] != 'length'
            entry['capabilityProbePassed'] = accepted
            if accepted:
                entry['review'] = call(model, 'review', review, review_budget)
                parsed = entry['review']['parsed']
                answers = parsed.get('cases') if isinstance(parsed, dict) else None
                valid = isinstance(answers, list) and len(answers) == 4 and all(
                    isinstance(r, dict) and r.get('classification') in ('VULNERABLE', 'SAFE') and
                    isinstance(r.get('evidence'), str) and isinstance(r.get('steps'), str) for r in answers
                ) and {r.get('id') for r in answers} == {r['id'] for r in fixture['cases']} and entry['review']['doneReason'] != 'length'
                entry['formatUsable'] = valid
                if valid:
                    classifications = {r['id']: r.get('classification') for r in answers}
                    entry['truePositive'] = sum(classifications[r['id']] == 'VULNERABLE' for r in fixture['cases'] if r['expected'] == 'VULNERABLE')
                    entry['falsePositive'] = sum(classifications[r['id']] == 'VULNERABLE' for r in fixture['cases'] if r['expected'] == 'SAFE')
                    entry['missed'] = sum(classifications[r['id']] != 'VULNERABLE' for r in fixture['cases'] if r['expected'] == 'VULNERABLE')
            else:
                entry['reviewStatus'] = 'SKIPPED_UNPROVEN_CAPABILITY'
        except Exception as error:
            entry['errorType'] = type(error).__name__
        finally:
            # Empty generate with keep_alive=0 is unload only, never a new prompt.
            try:
                api('generate', {'model': model, 'keep_alive': 0}, timeout=15)
                entry['unloaded'] = not api('ps', timeout=8)['models']
            except Exception as error:
                entry['unloadErrorType'] = type(error).__name__
            (OUT / 'results.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        if not entry.get('unloaded'):
            raise RuntimeError('Unload unverified; stop before loading another model')
        print(json.dumps({'model': model, 'capability': entry.get('capabilityProbePassed'), 'formatUsable': entry.get('formatUsable'), 'truePositive': entry.get('truePositive'), 'falsePositive': entry.get('falsePositive'), 'unloaded': entry.get('unloaded')}, ensure_ascii=True), flush=True)
    print('Local comparison complete. Raw responses and metric record: ' + str(OUT), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'status': 'STOPPED', 'errorType': type(error).__name__}), flush=True)
        sys.exit(1)
