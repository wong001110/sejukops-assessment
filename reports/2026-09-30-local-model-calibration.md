# Local defensive model calibration — 2026-09-30

## Decision and measured scope

The owner paused cloud DeepSeek and authorized trying the three downloaded local models in this chat, superseding the earlier separate-chat-only handoff for this trial. Main decision: **PROCEED with Foundation-Sec Instruct as an auxiliary static-review candidate for these guards**. It is not an autonomous approval authority, completed project review or proof of general red-team quality.

Main first read the handoff's installed.json, checked live `/api/tags` digests and `/api/show` Q4_K_M details. PID 38468 matched the handoff; actual listener was **127.0.0.1:11434**. Startup log recorded cloud disabled, one loaded model, one parallel request and 4096 context. No service/global configuration or website provider setting changed. Initial `/api/ps` was empty; after each model/supplement it was empty again. No download, cloud request, real DB, reset, deployment or browser tab was needed.

[Machine-readable metrics, exact digests and visible responses](2026-09-30-local-model-calibration.json). Raw API responses, including separate local-model thinking output, are retained in Git-ignored `supabase/.temp/local-redteam-20260930` and `supabase/.temp/local-redteam-20260930-reasoning-supplement`; their SHA256 values are in that report. No secret/private data entered prompts or outputs. The expected classifications stayed outside the prompts.

## Common-budget results

All models received identical harmless capability and review prompt bytes, the same complete four-case snapshot, 4096 context, temperature 0 and seed 42. Probe output limit 512; review output limit 1536. Model tokenizers/templates differ, so actual prompt tokens differ. Static review was enabled only after a completed probe accepted the scope, declared no tools and accurately described the tiny server-resolved workspace comparison. Main inspected final responses; models were never given tools or generated-code execution.

| Model | Probe | Review labels | Actual false positives / missed defects | Warm review wall time |
| --- | --- | --- | --- | --- |
| WhiteRabbitNeo V3 7B | Completed, 54.156s including cold load | 2/4 correct | 1 false positive, 1 missed defect | 10.329s, 330 output tokens |
| Foundation-Sec 1.1 8B Instruct | Completed, 36.344s including cold load | 4/4 correct | 0 false positives, 0 missed labels | 24.609s, 561 output tokens |
| Foundation-Sec 8B Reasoning | **Truncated**, 32.984s | Review skipped | Not scored; no final probe answer | Not run in common-budget round |

Reasoning exhausted all **512** probe tokens with **2,596 thinking characters and no visible final response**. This is a measured budget/format failure, not policy refusal or proof the model cannot review. Seven total inference calls across baseline and supplement; four empty unload requests, which generated no review content. Calls were serial, with no other model kept loaded.

## Separately labeled Reasoning supplement

One additional probe (2048 output limit) completed in **43.000s**, 764 output tokens. One same-case review (2048 output limit) completed in **53.594s**, 1064 output tokens. Neither truncated; final JSON was usable. It classified **3/4** correctly: found both defective adapters, but falsely flagged the safe atomic reservation gate. This different budget is **not** a common-budget ranking advantage; no extra repeat or prompt tuning occurred.

All final review objects were syntactically usable, permitting markdown fences without inventing/repairing JSON. A parseable response is not evidence quality. The probe's own claim of tools was not a tool execution; Main supplied and executed local tests.

## Case oracles and independent Main review

Cases are [reviewed synthetic adapters](../scripts/fixtures/local-redteam-cases.json), mapped to the project's reservation and verified Auth identity invariants. Main's [deterministic Mock runner](../scripts/local-redteam-oracles.mjs) executes only prewritten fixture functions, never model output. It passed all four cases, plus safe quota null/denied variants. This is controlled guard calibration, not newly discovered application vulnerabilities or a new production mutation kill count.

| Case | Ground truth and actual Mock result | Model evidence assessment |
| --- | --- | --- |
| Q7 | Missing atomic reserve: two callers see stale remaining 1 and dispatch twice. | All scored models label defective. Reasoning incorrectly says dispatch decrements quota; actual mock dispatch only counts consequences. Its label is right, explanation is partly wrong. |
| R2 | Actual reserve gate: one granted dispatch, one denied; null/false produce zero dispatch. | Instruct correctly accepts it. WhiteRabbitNeo treats different winner/loser results as a vulnerability. Reasoning says consuming the last unit requires a fresh status check before dispatch, which would reject legitimate reserved work; Main rejects both false positives. |
| T5 | Adapter passes profileId instead of authUserId: trusted mock RPC rejects, zero mutations, legitimate approval breaks. | Instruct/Reasoning identify wrong namespace. WhiteRabbitNeo misses the adapter defect. No privilege escalation is demonstrated. Instruct's steps invent attacker control of a server-resolved profile ID; Main rejects that precondition and reproduces the defect with fixed distinct fictional IDs. |
| U1 | Adapter passes verified Auth ID to the stated atomic actor/proposal recheck: one approval. | All scored models accept this bounded safe control. No whole-system security claim follows. |

Instruct produced the most useful labels here, but even its successful answer needs Main correction of prerequisites. Reasoning's longer output did not reduce this quota false positive. Four deliberately small cases, fixed order, one trial and no real codebase review cannot establish broad security expertise, adversarial prompt resistance or production fitness. No extra model calls were made to improve a score.

## Hardware observations

Ollama `/api/ps` sampling observed actual 4096 context and model allocations. Server load logs, in serial call order, recorded **25/29 layers on GPU for WhiteRabbitNeo** and **26/33 for each Foundation model**; remaining layers used CPU. GPU model buffers were about 3616 MiB / 3507 MiB; total reported model VRAM allocation about 3992 MiB / 4038 MiB. This machine therefore used both GPU and CPU, rather than fitting all layers on its 6 GiB RTX 3060. Allocation/layer counts are not percentages of compute time. A single nvidia-smi snapshot between requests is not a utilization benchmark.

Reported API generation times: WhiteRabbitNeo 9.919s, Instruct 24.070s, Reasoning supplementary review 52.946s. Output lengths and reasoning differ, so latency alone is not quality ranking. Cold loads are separated in JSON. Only local inference was used; no monetary bill or website Guest allowance was involved. Metrics use [Ollama chat API](https://docs.ollama.com/api/chat) and [loaded-model allocation API](https://docs.ollama.com/api/ps).

## Reuse and follow-up

The owner subsequently requested two more local models. [Qwen3.5/RedSage extension](2026-09-30-qwen-redsage-calibration.md) records identical-case common-budget checks and separately scored Qwen budget/mode supplements. It does not change this original trial's results.

```powershell
node scripts/local-redteam-oracles.mjs
python scripts/local-redteam-compare.py --allow-local <handoff-directory>/installed.json
# Optional separately scored larger-budget Reasoning check:
python scripts/local-redteam-compare.py --allow-local <handoff-directory>/installed.json --reasoning-supplement
```

Recheck exact digests and empty loaded-model state before calling. The command does not change provider configuration or grant model tools. Keep a new run's raw outputs separate; do not overwrite this evidence. A next real-source batch should include complete minimal dependencies/tests, use safe controls, preserve raw responses and independently reproduce suggestions. The previous [real Test concurrency report](2026-09-30-concurrency-red-team.md) remains a separate Main-executed live evidence class, not a local-model result.
