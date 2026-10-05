import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const manifestPath = path.join(scriptDir, "fixtures", "p6-mutations.json");
const require = createRequire(import.meta.url);

function parseArgs(argv) {
  const options = { report: null, timeoutMs: 90_000, mutants: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--report") options.report = argv[++i];
    else if (argv[i] === "--timeout-ms") options.timeoutMs = Number(argv[++i]);
    else if (argv[i] === "--mutants") options.mutants = argv[++i].split(",").filter(Boolean);
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1000 || options.timeoutMs > 600_000) {
    throw new Error("--timeout-ms must be between 1000 and 600000");
  }
  return options;
}

function normalized(file) {
  return path.resolve(repoRoot, file).replaceAll("\\", "/").toLowerCase();
}

function normalizeLineEndings(value) {
  return value.replace(/\r\n?/g, "\n");
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function run(commandArgs, { timeoutMs, env, label, outputDir }) {
  const jsonPath = path.join(outputDir, `${label}.vitest.json`);
  const markerPath = path.join(outputDir, `${label}.mutation-marker.json`);
  const vitestCli = require.resolve("vitest/vitest.mjs");
  const args = [vitestCli, "run", "--maxWorkers=1", "--reporter=json", `--outputFile=${jsonPath}`, ...commandArgs];
  const childEnv = { ...process.env, ...env };
  if (env?.SEJUK_MUTATION_TARGET) childEnv.SEJUK_MUTATION_MARKER = markerPath;
  const stdout = [];
  const stderr = [];
  let outputBytes = 0;
  const maxOutputBytes = 2_000_000;

  const outcome = await new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: repoRoot, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    const collect = (target) => (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes <= maxOutputBytes) target.push(chunk.toString("utf8"));
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ exitCode: null, timedOut, spawnError: error.message });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ exitCode: code, signal, timedOut });
    });
  });

  let json = null;
  let jsonError = null;
  try { json = JSON.parse(await readFile(jsonPath, "utf8")); }
  catch (error) { jsonError = error.message; }
  let marker = null;
  if (env?.SEJUK_MUTATION_TARGET) {
    try { marker = JSON.parse(await readFile(markerPath, "utf8")); }
    catch { marker = null; }
  }

  return {
    ...outcome,
    json,
    jsonError,
    marker,
    stdout: stdout.join("").slice(-20_000),
    stderr: stderr.join("").slice(-20_000),
    outputTruncated: outputBytes > maxOutputBytes,
  };
}

function testResults(report) {
  return Array.isArray(report?.testResults) ? report.testResults : [];
}

function totalTests(report) {
  return Number(report?.numTotalTests ?? 0);
}

function assertionFailures(report) {
  return testResults(report).flatMap((suite) =>
    (Array.isArray(suite.assertionResults) ? suite.assertionResults : [])
      .filter((assertion) => assertion.status === "failed")
      .map((assertion) => ({ file: suite.name, title: assertion.fullName, messages: assertion.failureMessages ?? [] })),
  );
}

function harnessFailure(report, failedAssertions) {
  if (!report || !testResults(report).length || totalTests(report) < 1) return "missing or empty Vitest JSON report";
  if (Number(report.numPendingTests ?? 0) >= totalTests(report)) return "no executed assertions";
  const failedSuitesWithoutAssertions = testResults(report).filter((suite) =>
    suite.status === "failed" && !(suite.assertionResults ?? []).some((assertion) => assertion.status === "failed"),
  );
  if (failedSuitesWithoutAssertions.length) return "suite-level failure without a failed assertion";
  const headlines = failedAssertions.flatMap((failure) => failure.messages)
    .map((message) => String(message).split(/\r?\n/, 1)[0]);
  if (headlines.some((headline) => /\btest timed out\b|^timeout\b|^transform failed\b|\bsyntaxerror\b|\bfailed to load\b|\bcannot find module\b|\berror when evaluating\b/i.test(headline))) {
    return "timeout, transform, syntax, or module-load error";
  }
  return null;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.version !== 1 || !Array.isArray(manifest.baselineTests) || !Array.isArray(manifest.mutants)) {
    throw new Error("Unsupported or malformed mutation manifest");
  }
  const selectedMutants = options.mutants
    ? manifest.mutants.filter((mutant) => options.mutants.includes(mutant.id))
    : manifest.mutants;
  if (!selectedMutants.length || (options.mutants && selectedMutants.length !== options.mutants.length)) {
    throw new Error("No matching mutants selected or an unknown mutant ID was supplied");
  }

  const reportBase = options.report ? path.resolve(options.report) : null;
  const tempRoot = path.resolve(os.tmpdir());
  if (reportBase && !isWithin(tempRoot, reportBase)) {
    throw new Error(`Report path must be inside the OS temp directory: ${tempRoot}`);
  }
  const workDir = await mkdtemp(path.join(tempRoot, "sejuk-p6-mutations-"));
  const reportPath = reportBase ?? path.join(tempRoot, `sejuk-p6-mutation-evidence-${randomUUID()}.json`);
  const records = [];

  try {
    const baseline = await run(["--config", "vitest.config.ts", ...manifest.baselineTests], {
      timeoutMs: options.timeoutMs,
      label: "baseline",
      outputDir: workDir,
    });
    const baselineFailures = assertionFailures(baseline.json);
    const baselineInvalid = baseline.timedOut || baseline.exitCode !== 0 || harnessFailure(baseline.json, baselineFailures);
    records.push({
      type: "baseline",
      status: baselineInvalid ? "INVALID" : "PASS",
      exitCode: baseline.exitCode,
      timedOut: baseline.timedOut,
      totalTests: totalTests(baseline.json),
      failures: baselineFailures,
      jsonError: baseline.jsonError,
      spawnError: baseline.spawnError,
      stdout: baseline.stdout,
      stderr: baseline.stderr,
    });

    if (!baselineInvalid) {
      for (const mutant of selectedMutants) {
        const targetAbs = path.resolve(repoRoot, mutant.target);
        const source = await readFile(targetAbs, "utf8");
        const occurrences = normalizeLineEndings(source).split(normalizeLineEndings(mutant.original)).length - 1;
        if (occurrences !== 1) {
          records.push({ type: "mutant", id: mutant.id, status: "INVALID", reason: `manifest original matches ${occurrences} times`, occurrences });
          continue;
        }
        const execution = await run([
          "--config", "tests/mutation/vitest.config.ts", ...mutant.tests,
        ], {
          timeoutMs: options.timeoutMs,
          label: mutant.id,
          outputDir: workDir,
          env: {
            SEJUK_MUTATION_ID: mutant.id,
            SEJUK_MUTATION_TARGET: targetAbs,
            SEJUK_MUTATION_ORIGINAL: mutant.original,
            SEJUK_MUTATION_REPLACEMENT: mutant.replacement,
          },
        });
        const failures = assertionFailures(execution.json);
        const invalidReason = execution.timedOut
          ? "child process timed out"
          : execution.spawnError
            ? "child process could not start"
            : execution.marker?.status !== "loaded" || execution.marker?.loadedCount !== 1 || execution.marker?.occurrences !== 1
              ? "mutation did not load exactly once on one exact source match"
              : !execution.json || totalTests(execution.json) < 1
                ? "no executed tests or invalid Vitest JSON"
                : harnessFailure(execution.json, failures);
        let testedTarget = false;
        if (execution.json) {
          testedTarget = testResults(execution.json).some((suite) => normalized(suite.name).endsWith(normalized(mutant.tests[0])));
        }
        const status = invalidReason
          ? "INVALID"
          : execution.exitCode === 0
            ? "SURVIVED"
            : failures.length > 0 && testedTarget
              ? "KILLED"
              : "INVALID";
        records.push({
          type: "mutant",
          id: mutant.id,
          target: mutant.target,
          tests: mutant.tests,
          rationale: mutant.rationale,
          status,
          reason: invalidReason ?? (status === "KILLED" ? "relevant test assertion failed" : status === "SURVIVED" ? "all targeted assertions passed" : "non-assertion process failure"),
          loadedMarker: execution.marker,
          exitCode: execution.exitCode,
          timedOut: execution.timedOut,
          totalTests: totalTests(execution.json),
          failures,
          jsonError: execution.jsonError,
          spawnError: execution.spawnError,
          stdout: execution.stdout,
          stderr: execution.stderr,
        });
      }
    }

    const evidence = {
      version: 1,
      generatedAt: new Date().toISOString(),
      repository: repoRoot,
      baselineStatus: records[0]?.status ?? "INVALID",
      summary: {
        killed: records.filter((record) => record.type === "mutant" && record.status === "KILLED").length,
        survived: records.filter((record) => record.type === "mutant" && record.status === "SURVIVED").length,
        invalid: records.filter((record) => record.type !== "baseline" && record.status === "INVALID").length,
        selected: selectedMutants.length,
      },
      records,
    };
    await writeFile(reportPath, JSON.stringify(evidence, null, 2), "utf8");
    process.stdout.write(`${JSON.stringify({ report: reportPath, baselineStatus: evidence.baselineStatus, summary: evidence.summary }, null, 2)}\n`);
    if (evidence.baselineStatus !== "PASS" || evidence.summary.invalid > 0 || evidence.summary.survived > 0) process.exitCode = 1;
  } finally {
    // Remove only this exact, generated runner directory; retain the evidence.
    if (isWithin(tempRoot, workDir) && path.basename(workDir).startsWith("sejuk-p6-mutations-")) {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
