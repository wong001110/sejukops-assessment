import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const target = "src/lib/ai/runtime/workspace-native-agent.ts";
const tests = "src/lib/ai/runtime/workspace-native-agent.test.ts";
const reportPath = path.join(repoRoot, "reports/agent-native-2026-10-05/mutations.json");
const mutants = [
  { id: "native-guest-proposal-denial", original: "const canPrepare = !options.isGuest && !actor.isAnonymous",
    replacement: "const canPrepare = !actor.isAnonymous", testName: "offers no proposal tool to Guest or Manager",
    rationale: "A server-held Demo principal is not anonymous; Guest status must independently deny preparation tools." },
  { id: "native-current-preparation-intent", original: "hasActorPermission(actor, \"order:assign\") && requestsAssignmentPreparation(input.prompt);",
    replacement: "hasActorPermission(actor, \"order:assign\") && true;",
    testName: "rejects history-only ID reads and history approval|does not expose preparation for a current informational",
    rationale: "Role alone and prior conversation cannot enable a preparation tool for an informational current request." },
  { id: "native-current-citation-binding",
    original: "if (!excerpts.every((excerpt) => current.some((hit) => sameCitation(excerpt.citation, hit.citation) && hit.content.includes(excerpt.text)))) {",
    replacement: "if (false) {", testName: "rejects fabricated quotes and archived/reset-era knowledge",
    rationale: "Returned citations must still resolve to current published source/version and its literal text after model generation." },
  { id: "native-outbound-step-allowance", original: "await options.beforeProviderCall?.();", replacement: "void options.beforeProviderCall;",
    testName: "reserves before each outbound step and preserves exhaustion",
    rationale: "Every outbound provider step must await the allowance guard; a denied second step cannot dispatch." },
];

function within(parent, child) {
  const relative = path.relative(parent, child);
  return !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}
function assertions(json) {
  return (json?.testResults ?? []).flatMap((suite) => (suite.assertionResults ?? []).map((assertion) => ({
    file: suite.name, title: assertion.fullName, status: assertion.status, messages: assertion.failureMessages ?? [],
  })));
}
function validate(execution, markerRequired) {
  const rows = assertions(execution.json);
  const executed = rows.filter((row) => row.status === "passed" || row.status === "failed");
  const failures = rows.filter((row) => row.status === "failed");
  let reason = null;
  if (execution.timedOut || execution.spawnError) reason = "process timeout or spawn failure";
  else if (!execution.json || executed.length === 0) reason = "no executed assertions or missing JSON report";
  else if (markerRequired && (execution.marker?.status !== "loaded" || execution.marker.loadedCount !== 1 || execution.marker.occurrences !== 1)) {
    reason = "virtual source did not load once with one exact replacement";
  } else if ((execution.json.testResults ?? []).some((suite) => suite.status === "failed" &&
      !(suite.assertionResults ?? []).some((assertion) => assertion.status === "failed"))) reason = "suite failure without assertion failure";
  else if (failures.some((failure) => failure.messages.some((message) =>
      /test timed out|transform failed|syntaxerror|failed to load|cannot find module|error when evaluating/i.test(String(message).split(/\r?\n/, 1)[0])))) {
    reason = "timeout, transform or module failure";
  }
  return { reason, executed, failures };
}

async function execute(workDir, label, testName, mutant) {
  const jsonPath = path.join(workDir, `${label}.json`);
  const markerPath = path.join(workDir, `${label}.marker.json`);
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("SEJUK_MUTATION_")) delete env[key];
  if (mutant) Object.assign(env, { SEJUK_MUTATION_TARGET: path.join(repoRoot, target),
    SEJUK_MUTATION_ORIGINAL: mutant.original, SEJUK_MUTATION_REPLACEMENT: mutant.replacement, SEJUK_MUTATION_MARKER: markerPath });
  const args = [require.resolve("vitest/vitest.mjs"), "run", tests, "--config",
    mutant ? "tests/mutation/vitest.config.ts" : "vitest.config.ts", "--maxWorkers=1", "--testNamePattern", testName,
    "--reporter=json", `--outputFile=${jsonPath}`];
  const output = [];
  const outcome = await new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: repoRoot, env, stdio: ["ignore", "pipe", "pipe"] });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 45_000);
    child.stdout.on("data", (chunk) => output.push(chunk.toString("utf8")));
    child.stderr.on("data", (chunk) => output.push(chunk.toString("utf8")));
    child.on("error", (error) => { clearTimeout(timer); resolve({ exitCode: null, timedOut, spawnError: error.message }); });
    child.on("close", (exitCode) => { clearTimeout(timer); resolve({ exitCode, timedOut }); });
  });
  let json = null; let marker = null;
  try { json = JSON.parse(await readFile(jsonPath, "utf8")); } catch { /* Invalid evidence is reported below. */ }
  if (mutant) try { marker = JSON.parse(await readFile(markerPath, "utf8")); } catch { /* No loaded marker means INVALID. */ }
  return { ...outcome, json, marker, output: output.join("").slice(-4_000) };
}

async function main() {
  const source = await readFile(path.join(repoRoot, target), "utf8");
  const digest = (value) => createHash("sha256").update(value).digest("hex");
  const normalized = source.replace(/\r\n?/g, "\n");
  const tempRoot = path.resolve(os.tmpdir());
  const workDir = await mkdtemp(path.join(tempRoot, "sejuk-native-mutations-"));
  const records = [];
  try {
    const baseline = await execute(workDir, "baseline", mutants.map((mutant) => mutant.testName).join("|"));
    const baselineCheck = validate(baseline, false);
    const baselinePass = !baselineCheck.reason && baseline.exitCode === 0 && baselineCheck.failures.length === 0;
    records.push({ type: "baseline", status: baselinePass ? "PASS" : "INVALID", executedAssertions: baselineCheck.executed.length,
      exitCode: baseline.exitCode, reason: baselineCheck.reason, failures: baselineCheck.failures });
    if (baselinePass) for (const mutant of mutants) {
      const occurrences = normalized.split(mutant.original).length - 1;
      if (occurrences !== 1) {
        records.push({ type: "mutant", id: mutant.id, status: "INVALID", reason: `Expected one source match, found ${occurrences}` });
        continue;
      }
      const execution = await execute(workDir, mutant.id, mutant.testName, mutant);
      const check = validate(execution, true);
      const status = check.reason ? "INVALID" : execution.exitCode === 0 ? "SURVIVED"
        : check.failures.length > 0 ? "KILLED" : "INVALID";
      records.push({ type: "mutant", id: mutant.id, target, tests, testName: mutant.testName, rationale: mutant.rationale,
        status, reason: check.reason ?? (status === "KILLED" ? "Executed relevant assertion failed with loaded virtual mutation marker"
          : status === "SURVIVED" ? "Selected assertions passed" : "Non-assertion process failure"),
        original: mutant.original, replacement: mutant.replacement, loadedMarker: execution.marker,
        executedAssertions: check.executed.length, exitCode: execution.exitCode, failures: check.failures,
        ...(status === "INVALID" ? { output: execution.output } : {}) });
    }
    const after = await readFile(path.join(repoRoot, target), "utf8");
    const evidence = { version: 1, generatedAt: new Date().toISOString(), scope: "Virtual-source fake-provider targeted runtime guards; no live DB/provider/browser evidence",
      baselineStatus: records[0].status, sourceUnchanged: digest(source) === digest(after), sourceSha256: digest(after),
      summary: { selected: mutants.length, killed: records.filter((row) => row.status === "KILLED").length,
        survived: records.filter((row) => row.status === "SURVIVED").length, invalid: records.filter((row) => row.status === "INVALID").length }, records };
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify({ report: reportPath, baselineStatus: evidence.baselineStatus,
      sourceUnchanged: evidence.sourceUnchanged, summary: evidence.summary }, null, 2)}\n`);
    if (!baselinePass || !evidence.sourceUnchanged || evidence.summary.killed !== mutants.length) process.exitCode = 1;
  } finally {
    if (within(tempRoot, workDir) && path.basename(workDir).startsWith("sejuk-native-mutations-")) await rm(workDir, { recursive: true, force: true });
  }
}
main().catch((error) => { process.stderr.write(`${error.stack ?? String(error)}\n`); process.exitCode = 1; });
