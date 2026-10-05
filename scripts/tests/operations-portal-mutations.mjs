// In-memory transforms only; source files are never rewritten.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const output = path.resolve(process.env.PORTAL_MUTATION_OUTPUT ?? ".agent/operations-portal-mutations");
fs.mkdirSync(output, { recursive: true });
const root = "src/app/workspaces/[workspaceId]/";
const mutations = [
  { name: "assignment-guest-page", file: "assignment/page.tsx", test: "assignment/page.test.tsx",
    original: "context.guestVisit ||", replacement: "" },
  { name: "schedule-preview-permission", file: "schedule/page.tsx", test: "schedule/page.test.tsx",
    original: '!hasActorPermission(context.actor, "order:reschedule")', replacement: "false" },
  { name: "sidebar-preview-schedule", file: "operations-nav-policy.ts", test: "operations-nav-policy.test.ts",
    original: 'role === "MANAGER" && !readOnly', replacement: 'role === "MANAGER"' },
  { name: "orders-context-key", file: "orders/page.tsx", test: "orders/page.test.tsx",
    original: 'key={`${workspaceId}:${actor?.profileId}:${actor?.membership?.role}:${perspectiveKey}:${workspaceContext?.guestVisit?.id ?? actor?.sessionId ?? "formal"}`}', replacement: "key={workspaceId}" },
];
const results = [];
for (const mutation of mutations) {
  const report = path.join(output, `${mutation.name}.json`);
  const marker = path.join(output, `${mutation.name}-loaded.json`);
  const execution = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", root + mutation.test,
    "--config", "tests/mutation/vitest.config.ts", "--reporter=json", `--outputFile=${report}`], {
    timeout: 45000, encoding: "utf8", env: { ...process.env, SEJUK_MUTATION_TARGET: path.resolve(root + mutation.file),
      SEJUK_MUTATION_ORIGINAL: mutation.original, SEJUK_MUTATION_REPLACEMENT: mutation.replacement, SEJUK_MUTATION_MARKER: marker },
  });
  let loaded, tests;
  try { loaded = JSON.parse(fs.readFileSync(marker, "utf8")); tests = JSON.parse(fs.readFileSync(report, "utf8")); } catch { /* Invalid evidence below. */ }
  const failed = (tests?.testResults ?? []).flatMap(suite => suite.assertionResults ?? []).filter(test => test.status === "failed");
  const invalidFailure = failed.some(test => /timed out|SyntaxError|Cannot find module/i.test(test.failureMessages.join("\n")));
  const killed = execution.status === 1 && loaded?.status === "loaded" && failed.length > 0 && !invalidFailure;
  results.push({ name: mutation.name, result: killed ? "KILLED" : "INVALID_OR_SURVIVED", failedAssertions: failed.map(test => test.fullName) });
  console.log(`${mutation.name}: ${results.at(-1).result}`);
}
fs.writeFileSync(path.join(output, "summary.json"), JSON.stringify(results, null, 2));
if (results.some(result => result.result !== "KILLED")) process.exitCode = 1;
