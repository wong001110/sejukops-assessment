import { describe, expect, it } from "vitest";

import { observeRuntimeResponse } from "../../evals/ai-operations/adapter";
import {
  OPERATIONS_EVAL_CASES,
  OPERATIONS_EVAL_EXPECTED_BALANCE,
} from "../../evals/ai-operations/cases";
import { runOperationsEval } from "../../evals/ai-operations/harness";
import { runOptInRealProviderEval } from "../../evals/ai-operations/real-provider";
import type {
  OperationsEvalCase,
  OperationsEvalExecutor,
} from "../../evals/ai-operations/types";
import { validateOperationsEvalDataset } from "../../evals/ai-operations/validate";
import { OPERATIONS_TOOL_NAMES } from "@/domain/ai-operations/contracts";
import { ASSESSMENT_GOLDEN_FACTS } from "@/domain/assessment-fixtures";
import { MANAGER_DASHBOARD_GOLDEN } from "@/domain/manager-dashboard/golden";

function expectedStep(caseId: string, stepIndex: number) {
  const evalCase = OPERATIONS_EVAL_CASES.find((item) => item.id === caseId);
  if (!evalCase) throw new Error(`Unknown fixture case ${caseId}`);
  const step = evalCase.steps[stepIndex];
  if (!step) throw new Error(`Unknown fixture step ${caseId}:${stepIndex}`);
  return step;
}

const goldenExecutor: OperationsEvalExecutor = async (input) => {
  const step = expectedStep(input.caseId, input.stepIndex);
  const expectedTool = step.expected.tool;
  const resultCountFact = step.expected.facts?.find(({ key }) =>
    key === "jobs.count" ||
    key === "technicians.count" ||
    key === "workload.technicians_count"
  );
  return {
    outcome: step.expected.outcome,
    toolCalls: expectedTool
      ? [{
          name: expectedTool.name,
          arguments: expectedTool.arguments,
          resultCount: step.expected.outcome === "NO_DATA"
            ? 0
            : typeof resultCountFact?.value === "number"
              ? resultCountFact.value
              : 1,
        }]
      : [],
    facts: (step.expected.facts ?? []).map(({ key, value }) => ({ key, value })),
    context: ["ANSWER", "NO_DATA"].includes(step.expected.outcome)
      ? { fixtureContext: `${input.caseId}:${input.stepIndex}` }
      : undefined,
    errorCode: step.expected.errorCode,
    groundingViolations: [],
    providerMetrics: input.caseId === "OPS-EVAL-001"
      ? { inputTokens: 32, outputTokens: 18, estimatedCostUsd: 0.0001 }
      : undefined,
  };
};

function oneCase(id: OperationsEvalCase["id"]): readonly OperationsEvalCase[] {
  const item = OPERATIONS_EVAL_CASES.find((evalCase) => evalCase.id === id);
  if (!item) throw new Error(`Unknown fixture case ${id}`);
  return [item];
}

describe("Operations AI domain evaluation dataset", () => {
  it("contains the required 52 balanced, unique, runtime-valid cases", () => {
    expect(OPERATIONS_EVAL_CASES).toHaveLength(52);
    expect(validateOperationsEvalDataset(OPERATIONS_EVAL_CASES)).toEqual([]);
    expect(new Set(OPERATIONS_EVAL_CASES.map(({ id }) => id)).size).toBe(52);

    const balance = Object.fromEntries(
      Object.keys(OPERATIONS_EVAL_EXPECTED_BALANCE).map((category) => [
        category,
        OPERATIONS_EVAL_CASES.filter((item) => item.category === category).length,
      ]),
    );
    expect(balance).toEqual(OPERATIONS_EVAL_EXPECTED_BALANCE);
  });

  it("uses the shared runtime allow-list and schema-normalised arguments", () => {
    const expectedTools = OPERATIONS_EVAL_CASES.flatMap(({ steps }) =>
      steps.flatMap(({ expected }) => expected.tool ? [expected.tool] : []),
    );
    expect(new Set(expectedTools.map(({ name }) => name))).toEqual(
      new Set(OPERATIONS_TOOL_NAMES),
    );
    for (const expected of expectedTools) {
      expect(expected.arguments).not.toHaveProperty("startDate");
      expect(expected.arguments).not.toHaveProperty("endDate");
      expect(expected.arguments).not.toHaveProperty("sql");
    }
  });

  it("references canonical fixture facts instead of maintaining another truth", () => {
    const aliFacts = OPERATIONS_EVAL_CASES[0].steps[0].expected.facts;
    expect(aliFacts?.find(({ key }) => key === "jobs.order_numbers")?.value)
      .toBe(ASSESSMENT_GOLDEN_FACTS.aliCompletedLastWeek);

    const weeklySummary = OPERATIONS_EVAL_CASES.find(
      ({ id }) => id === "OPS-EVAL-012",
    )?.steps[0].expected.facts;
    expect(weeklySummary?.find(({ key }) => key === "summary.completed_jobs")?.value)
      .toBe(MANAGER_DASHBOARD_GOLDEN.this_week.summary.completedJobs);
    expect(weeklySummary?.find(({ key }) => key === "summary.total_amount")?.value)
      .toBe(MANAGER_DASHBOARD_GOLDEN.this_week.summary.totalAmount);
  });
});

describe("Operations AI deterministic harness", () => {
  it("passes the complete golden mock run and captures optional provider metrics", async () => {
    const report = await runOperationsEval(OPERATIONS_EVAL_CASES, goldenExecutor);
    const expectedExecutions = OPERATIONS_EVAL_CASES.reduce(
      (total, item) => total + (item.steps.length * item.repetitions),
      0,
    );

    expect(report).toMatchObject({
      caseCount: 52,
      executionCount: expectedExecutions,
      passed: true,
      hardGatePassed: true,
      toolSelectionAccuracy: 1,
      argumentAccuracy: 1,
      factAccuracy: 1,
      unsupportedHandlingAccuracy: 1,
      failureHonestyAccuracy: 1,
      failures: [],
    });
    expect(report.metrics).toHaveLength(expectedExecutions);
    expect(report.metrics.find(({ caseId }) => caseId === "OPS-EVAL-001"))
      .toMatchObject({
        inputTokens: 32,
        outputTokens: 18,
        estimatedCostUsd: 0.0001,
      });
    expect(report.metrics.find(({ caseId }) => caseId === "OPS-EVAL-002"))
      .toMatchObject({
        inputTokens: null,
        outputTokens: null,
        estimatedCostUsd: null,
      });
  });

  it("hard-fails an unapproved tool even when its name does not mention SQL", async () => {
    const report = await runOperationsEval(oneCase("OPS-EVAL-048"), async () => ({
      outcome: "UNSUPPORTED",
      toolCalls: [{ name: "dropAllRecords", arguments: {} }],
      facts: [],
    }));
    expect(report.hardGatePassed).toBe(false);
    expect(report.failures.map(({ code }) => code)).toContain(
      "ARBITRARY_SQL_BOUNDARY",
    );
    expect(report.failures.map(({ code }) => code)).toContain(
      "UNSUPPORTED_TOOL_CALL",
    );
  });

  it("hard-fails fabricated success and ungrounded facts", async () => {
    const fabricated = await runOperationsEval(
      oneCase("OPS-EVAL-043"),
      async () => ({
        outcome: "ANSWER",
        toolCalls: [],
        facts: [{ key: "summary.completed_jobs", value: 999 }],
      }),
    );
    expect(fabricated.hardGatePassed).toBe(false);
    expect(fabricated.failures.map(({ code }) => code)).toContain(
      "FAILURE_NOT_HONEST",
    );

    const ungrounded: OperationsEvalExecutor = async (input) => ({
      ...(await goldenExecutor(input)),
      groundingViolations: ["Invented order ORD-9999-9999"],
    });
    const groundedReport = await runOperationsEval(
      oneCase("OPS-EVAL-001"),
      ungrounded,
    );
    expect(groundedReport.hardGatePassed).toBe(false);
    expect(groundedReport.failures.map(({ code }) => code)).toContain(
      "UNGROUNDED_FACT",
    );
  });

  it("detects repeated-run inconsistency", async () => {
    const inconsistent: OperationsEvalExecutor = async (input) => {
      const normal = await goldenExecutor(input);
      if (input.repetition === 0) return normal;
      return {
        ...normal,
        facts: normal.facts.map((item, index) =>
          index === 0 ? { ...item, value: 999 } : item
        ),
      };
    };
    const report = await runOperationsEval(
      oneCase("OPS-EVAL-001"),
      inconsistent,
    );
    expect(report.passed).toBe(false);
    expect(report.failures.map(({ code }) => code)).toContain(
      "CONSISTENCY_MISMATCH",
    );
  });

  it("passes no context after a reset step", async () => {
    const receivedContexts: unknown[] = [];
    const recordingExecutor: OperationsEvalExecutor = async (input) => {
      receivedContexts.push(input.context);
      return goldenExecutor(input);
    };
    const report = await runOperationsEval(
      oneCase("OPS-EVAL-030"),
      recordingExecutor,
    );
    expect(report.passed).toBe(true);
    expect(receivedContexts).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
  });

  it("maps the validated runtime response without prose comparison", () => {
    const response = observeRuntimeResponse({
      outcome: "ANSWER",
      answer: "Any semantically clear wording is allowed.",
      context: {
        intent: "OPERATIONAL_SUMMARY",
        period: "today",
      },
      toolCalls: [{
        name: "getOperationalSummary",
        arguments: { period: "today" },
        resultCount: 1,
      }],
      facts: [{
        key: "summary.completed_jobs",
        label: "Completed jobs",
        value: MANAGER_DASHBOARD_GOLDEN.today.summary.completedJobs,
        kind: "COUNT",
      }],
      metadata: {
        grounded: true,
        timezone: "Asia/Kuala_Lumpur",
        generatedAt: "2026-08-14T12:00:00+08:00",
      },
    });
    expect(response.facts).toEqual([{
      key: "summary.completed_jobs",
      value: MANAGER_DASHBOARD_GOLDEN.today.summary.completedJobs,
    }]);
    expect(response).not.toHaveProperty("answer");
  });

  it("keeps real-provider execution explicitly opt-in", async () => {
    await expect(runOptInRealProviderEval(
      oneCase("OPS-EVAL-001"),
      goldenExecutor,
      {},
    )).rejects.toThrow("Real-provider evaluation is disabled");
  });
});
