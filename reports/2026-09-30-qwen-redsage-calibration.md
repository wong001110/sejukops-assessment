# Qwen3.5 and RedSage local calibration — 2026-09-30

## Scope and decision

Owner requested adding Qwen3.5-4B and RedSage-8B-DPO to the local trial. Main checked the additional-model handoff, current localhost `/api/tags` and `/api/show`; both exact digests matched and actual quantization was Q4_K_M. Neither needed downloading. Starting/ending model state was empty; each model was unloaded before proceeding. No website provider settings, service settings, cloud model, real database or browser was used.

Main decision: **PROCEED for recorded calibration evidence; retain Foundation-Sec Instruct as the preferred auxiliary candidate for this four-case scope.** Neither new model improves its correct-label count in this trial. A four-case calibration is not general model ranking, complete project security review or an autonomous acceptance gate.

[Metrics, exact model digests and visible responses](2026-09-30-qwen-redsage-calibration.json). Raw responses (including separate local-model thinking fields) and exact prompts remain in ignored directories listed there, with response SHA256 values. Expected labels never entered the model prompt. Main independently reran [all four Mock oracles](../scripts/local-redteam-oracles.mjs), including safe quota null/denied variants; all passed. Model suggestions were not executed.

## Comparable inputs and results

The [same four complete synthetic cases](../scripts/fixtures/local-redteam-cases.json), prompt text and SHA256 from the previous trial were verified unchanged. Each call used 4096 context, temperature 0, seed 42, text-only messages and no tools. Default mode leaves each model's thinking behavior unchanged; tokenizer/template overhead differs between models. The comparator now lets an exact digest-pinned manifest select a subset of five explicitly supported local identifiers.

| Model/mode | Probe budget / review budget | Observed result | Review wall time |
| --- | --- | --- | --- |
| RedSage default, common-budget | 512 / 1536 | Probe completed; usable final JSON; **3/4** labels correct, zero false positives, one missed adapter defect | **18.407s**, 342 output tokens |
| Qwen default, common-budget | 512 / 1536 | Probe truncated at 512, 2,133 thinking characters, no final content; review skipped | Not run |
| Qwen default, budget supplement | 2048 / 2048 | Probe completed at 1,661 tokens; review truncated at 2,048, 8,899 thinking characters, no final review content; not scored | **36.250s** until truncation |
| Qwen `think:false`, mode supplement | 512 / 1536 | Probe completed; usable final JSON; **3/4** labels correct, zero false positives, one missed quota defect | **5.719s**, 351 output tokens |

Qwen's larger-budget and thinking-disabled checks are separately labeled supplements. They do not count as a common-default-mode victory or a repeated score improvement. `think:false` was set only on these two requests; no persistent model/provider setting changed. Truncation is a budget/answer-completion failure, not a policy refusal. Seven total inference calls and four empty unload requests ran serially; no additional tuning/repeat followed.

## Main's evidence assessment

- **RedSage:** Q7 correctly identifies two stale status reads dispatching twice; R2/U1 correctly accept the specified protected paths. T5 is labeled SAFE because the backend rejects a wrong Auth ID. That rejection does prevent unauthorized mutation, but the adapter still passes profileId and breaks legitimate approval. Main's actual Mock returns DENIED with zero mutations. The missed defect is the identity namespace contract, not demonstrated privilege escalation.
- **Qwen, thinking disabled:** Q7 is incorrectly labeled SAFE: it cites the contract for `api.reserve()` and assumes reservation occurred, although this function is never called in Q7's source. Main's Mock dispatches twice. R2/U1 labels are correct. T5's defect label is correct, but its steps invent attacker profile access, spoofing and an untrusted server actor despite the complete trusted-actor contract. Main rejects those speculative prerequisites; only the fixed wrong-namespace approval failure is reproduced.
- Neither model dynamically executed tests or discovered a new SejukOps application vulnerability. Syntactically usable JSON and correct labels are separate from accurate source evidence and valid reproduction steps.

## Combined limited comparison

| Candidate | Four-case label result | Main limitation |
| --- | --- | --- |
| Foundation-Sec Instruct | 4/4, common budget | One attacker-control precondition was invented and corrected by Main |
| RedSage | 3/4, common budget | Missed legitimate approval identity defect |
| Qwen3.5, thinking disabled | 3/4, separate mode | Missed quota bypass; invented approval attack prerequisites |
| Foundation-Sec Reasoning | 3/4, larger-budget supplement | False positive on correct atomic reservation |
| WhiteRabbitNeo | 2/4, common budget | False positive on atomic reservation and missed identity defect |

These different modes/budgets cannot establish a fair overall quality ranking. [Original trial](2026-09-30-local-model-calibration.md) records the prior three models and their complete limits. This batch demonstrates that a model can confuse a dependency's documented guarantee with a dependency actually being invoked; future source reviews must independently check concrete call sites and counterexamples.

## Hardware and timing

Actual `/api/ps` samples showed Qwen allocated **3,128,038,521 bytes entirely in VRAM** at 4096 context. RedSage allocated **5,763,802,068 bytes total**, **4,193,811,168 bytes in VRAM**: partial GPU/CPU allocation. These are model-memory observations, not compute utilization percentages or a claim that every operation executes on GPU.

Qwen's default cold probe was 33.703s (20.862s load); larger-budget probe 52.016s; thinking-disabled probe 9.563s. RedSage probe was 10.453s (8.587s load). Warm review times above separate model loading. One trial, different output lengths and request modes do not establish a general speed benchmark. API controls/metrics follow [Ollama chat](https://docs.ollama.com/api/chat) and [running-model allocation](https://docs.ollama.com/api/ps).

## Reuse

```powershell
python scripts/local-redteam-compare.py --allow-local <additional-models-installed.json>
# Separate larger-budget check using a manifest containing only selected models:
python scripts/local-redteam-compare.py --allow-local <qwen-only-manifest.json> --budget-supplement
# Separate request-mode check; requires advertised thinking control:
python scripts/local-redteam-compare.py --allow-local <qwen-only-manifest.json> --no-thinking
```

Manifests must contain unique supported exact identifiers and verified digests. Legacy `--reasoning-supplement` still selects only Foundation-Sec Reasoning from its original manifest. Each new run uses a distinct ignored directory and records budget/mode. No full application regression/build, product mutation test or browser E2E ran for this verification-script/report slice; they do not validate these static model outputs. Python syntax, selector import, actual selected-model runs, existing Mock oracles and diff checks were used instead.
