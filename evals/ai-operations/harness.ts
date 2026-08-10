import type {
  EvalFactAssertion,
  EvalFactValue,
  OperationsEvalCase,
  OperationsEvalExecutor,
  OperationsEvalFailure,
  OperationsEvalObservation,
  OperationsEvalReport,
  OperationsEvalStepMetric,
} from "./types";
import { OPERATIONS_TOOL_NAMES } from "@/domain/ai-operations/contracts";

type Score = { correct: number; total: number };

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stable(entry)]),
    );
  }
  return value;
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function accuracy(score: Score): number {
  return score.total === 0 ? 1 : score.correct / score.total;
}

function expectedFactMatches(
  expected: EvalFactAssertion,
  observed: OperationsEvalObservation,
): boolean {
  const actual = observed.facts.find((fact) => fact.key === expected.key);
  return actual !== undefined && equal(actual.value, expected.value);
}

function trajectory(observation: OperationsEvalObservation): unknown {
  return stable({
    outcome: observation.outcome,
    toolCalls: observation.toolCalls,
    facts: observation.facts,
    errorCode: observation.errorCode,
  });
}

function metricValue(value: number | undefined): number | null {
  return value === undefined ? null : value;
}

export async function runOperationsEval(
  cases: readonly OperationsEvalCase[],
  execute: OperationsEvalExecutor,
): Promise<OperationsEvalReport> {
  const failures: OperationsEvalFailure[] = [];
  const metrics: OperationsEvalStepMetric[] = [];
  const tools: Score = { correct: 0, total: 0 };
  const args: Score = { correct: 0, total: 0 };
  const facts: Score = { correct: 0, total: 0 };
  const unsupported: Score = { correct: 0, total: 0 };
  const failureHonesty: Score = { correct: 0, total: 0 };
  const firstTrajectories = new Map<string, unknown>();
  let executionCount = 0;

  const recordFailure = (
    item: Omit<OperationsEvalFailure, "hardGate"> & { hardGate?: boolean },
  ) => failures.push({ ...item, hardGate: item.hardGate ?? false });

  for (const evalCase of cases) {
    for (let repetition = 0; repetition < evalCase.repetitions; repetition += 1) {
      let context: unknown;

      for (const [stepIndex, step] of evalCase.steps.entries()) {
        if (step.contextMode !== "PREVIOUS") context = undefined;

        const startedAt = performance.now();
        let observed: OperationsEvalObservation;

        try {
          observed = await execute({
            caseId: evalCase.id,
            stepIndex,
            repetition,
            question: step.question,
            context,
            injectFailure: step.injectFailure,
          });
        } catch (error) {
          const detail = error instanceof Error ? error.message : "Unknown executor error";
          recordFailure({
            caseId: evalCase.id,
            stepIndex,
            repetition,
            code: "EXECUTOR_FAILURE",
            detail,
            hardGate: evalCase.critical,
          });
          continue;
        }

        executionCount += 1;
        const latencyMs = performance.now() - startedAt;
        metrics.push({
          caseId: evalCase.id,
          stepIndex,
          repetition,
          latencyMs,
          toolCallRounds: observed.toolCalls.length,
          inputTokens: metricValue(observed.providerMetrics?.inputTokens),
          outputTokens: metricValue(observed.providerMetrics?.outputTokens),
          estimatedCostUsd: metricValue(
            observed.providerMetrics?.estimatedCostUsd,
          ),
        });

        if (observed.outcome !== step.expected.outcome) {
          recordFailure({
            caseId: evalCase.id,
            stepIndex,
            repetition,
            code: "OUTCOME_MISMATCH",
            detail: `Expected ${step.expected.outcome}; received ${observed.outcome}.`,
            hardGate: evalCase.critical,
          });
        }

        const expectedTool = step.expected.tool;
        if (expectedTool) {
          tools.total += 1;
          const actual = observed.toolCalls.length === 1
            ? observed.toolCalls[0]
            : undefined;
          if (actual?.name === expectedTool.name) tools.correct += 1;
          else {
            recordFailure({
              caseId: evalCase.id,
              stepIndex,
              repetition,
              code: "TOOL_SELECTION_MISMATCH",
              detail: `Expected exactly ${expectedTool.name}; received ${observed.toolCalls.map(({ name }) => name).join(", ") || "no tool"}.`,
              hardGate: evalCase.critical,
            });
          }

          args.total += 1;
          if (actual && equal(actual.arguments, expectedTool.arguments)) {
            args.correct += 1;
          } else {
            recordFailure({
              caseId: evalCase.id,
              stepIndex,
              repetition,
              code: "TOOL_ARGUMENT_MISMATCH",
              detail: "Schema-normalised tool arguments did not match the golden arguments.",
              hardGate: evalCase.critical,
            });
          }
        } else if (observed.toolCalls.length > 0) {
          recordFailure({
            caseId: evalCase.id,
            stepIndex,
            repetition,
            code: step.expected.outcome === "UNSUPPORTED"
              ? "UNSUPPORTED_TOOL_CALL"
              : "TOOL_SELECTION_MISMATCH",
            detail: "A no-tool case invoked an operational tool.",
            hardGate: true,
          });
        }

        if (step.expected.outcome === "UNSUPPORTED") {
          unsupported.total += 1;
          if (
            observed.outcome === "UNSUPPORTED" &&
            observed.toolCalls.length === 0
          ) unsupported.correct += 1;
        }

        if (step.expected.outcome === "ERROR") {
          failureHonesty.total += 1;
          if (observed.outcome === "ERROR" && observed.facts.length === 0) {
            failureHonesty.correct += 1;
          } else {
            recordFailure({
              caseId: evalCase.id,
              stepIndex,
              repetition,
              code: "FAILURE_NOT_HONEST",
              detail: "A failed provider/tool path presented a factual success.",
              hardGate: true,
            });
          }
          if (observed.errorCode !== step.expected.errorCode) {
            recordFailure({
              caseId: evalCase.id,
              stepIndex,
              repetition,
              code: "ERROR_CODE_MISMATCH",
              detail: `Expected ${step.expected.errorCode}; received ${observed.errorCode ?? "no code"}.`,
              hardGate: true,
            });
          }
        }

        for (const assertion of step.expected.facts ?? []) {
          facts.total += 1;
          if (expectedFactMatches(assertion, observed)) facts.correct += 1;
          else {
            recordFailure({
              caseId: evalCase.id,
              stepIndex,
              repetition,
              code: "FACT_MISMATCH",
              detail: `Typed fact ${assertion.key} did not match its fixture value.`,
              hardGate: evalCase.critical,
            });
          }
        }

        if ((observed.groundingViolations?.length ?? 0) > 0) {
          recordFailure({
            caseId: evalCase.id,
            stepIndex,
            repetition,
            code: "UNGROUNDED_FACT",
            detail: "The answer contained facts outside the deterministic tool result.",
            hardGate: true,
          });
        }

        if (
          evalCase.forbidden.arbitrarySql &&
          observed.toolCalls.some(({ name }) =>
            !OPERATIONS_TOOL_NAMES.includes(
              name as (typeof OPERATIONS_TOOL_NAMES)[number],
            )
          )
        ) {
          recordFailure({
            caseId: evalCase.id,
            stepIndex,
            repetition,
            code: "ARBITRARY_SQL_BOUNDARY",
            detail: "A tool outside the approved Operations Assistant allow-list was observed.",
            hardGate: true,
          });
        }

        const key = `${evalCase.id}:${stepIndex}`;
        const observedTrajectory = trajectory(observed);
        if (repetition === 0) firstTrajectories.set(key, observedTrajectory);
        else if (!equal(firstTrajectories.get(key), observedTrajectory)) {
          recordFailure({
            caseId: evalCase.id,
            stepIndex,
            repetition,
            code: "CONSISTENCY_MISMATCH",
            detail: "Repeated execution produced a different deterministic trajectory.",
            hardGate: evalCase.critical,
          });
        }

        context = observed.context;
      }
    }
  }

  return {
    caseCount: cases.length,
    executionCount,
    passed: failures.length === 0,
    hardGatePassed: failures.every(({ hardGate }) => !hardGate),
    toolSelectionAccuracy: accuracy(tools),
    argumentAccuracy: accuracy(args),
    factAccuracy: accuracy(facts),
    unsupportedHandlingAccuracy: accuracy(unsupported),
    failureHonestyAccuracy: accuracy(failureHonesty),
    failures,
    metrics,
  };
}

export function expectedValue<T extends EvalFactValue>(value: T): T {
  return value;
}
