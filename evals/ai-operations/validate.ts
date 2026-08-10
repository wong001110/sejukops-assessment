import {
  operationsFactSchema,
  operationsToolArgumentsSchemas,
  operationsToolNameSchema,
} from "@/domain/ai-operations/contracts";

import { OPERATIONS_EVAL_EXPECTED_BALANCE } from "./cases";
import type {
  OperationsEvalCase,
  OperationsEvalCategory,
} from "./types";

export type OperationsEvalDatasetIssue = Readonly<{
  caseId: string;
  detail: string;
}>;

function stable(value: unknown): string {
  const normalize = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(normalize);
    if (entry && typeof entry === "object") {
      return Object.fromEntries(
        Object.entries(entry)
          .filter(([, item]) => item !== undefined)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, item]) => [key, normalize(item)]),
      );
    }
    return entry;
  };
  return JSON.stringify(normalize(value));
}

export function validateOperationsEvalDataset(
  cases: readonly OperationsEvalCase[],
): readonly OperationsEvalDatasetIssue[] {
  const issues: OperationsEvalDatasetIssue[] = [];
  const ids = new Set<string>();
  const balance = Object.fromEntries(
    Object.keys(OPERATIONS_EVAL_EXPECTED_BALANCE).map((category) => [category, 0]),
  ) as Record<OperationsEvalCategory, number>;

  if (cases.length < 40 || cases.length > 60) {
    issues.push({
      caseId: "DATASET",
      detail: `Expected 40-60 cases; received ${cases.length}.`,
    });
  }

  for (const evalCase of cases) {
    if (ids.has(evalCase.id)) {
      issues.push({ caseId: evalCase.id, detail: "Duplicate case id." });
    }
    ids.add(evalCase.id);
    balance[evalCase.category] += 1;

    if (evalCase.steps.length === 0) {
      issues.push({ caseId: evalCase.id, detail: "Case has no steps." });
    }
    if (evalCase.repetitions < 1 || evalCase.repetitions > 5) {
      issues.push({
        caseId: evalCase.id,
        detail: "Repetitions must be between one and five.",
      });
    }
    if (evalCase.steps[0]?.contextMode === "PREVIOUS") {
      issues.push({
        caseId: evalCase.id,
        detail: "First step cannot inherit previous context.",
      });
    }

    for (const [stepIndex, step] of evalCase.steps.entries()) {
      const label = `${evalCase.id} step ${stepIndex + 1}`;
      const expectedTool = step.expected.tool;

      if (expectedTool) {
        const toolName = operationsToolNameSchema.safeParse(expectedTool.name);
        if (!toolName.success) {
          issues.push({ caseId: label, detail: "Expected tool is not approved." });
        } else {
          const parsedArguments = operationsToolArgumentsSchemas[toolName.data]
            .safeParse(expectedTool.arguments);
          if (!parsedArguments.success) {
            issues.push({
              caseId: label,
              detail: `Invalid ${toolName.data} arguments: ${parsedArguments.error.issues[0]?.message ?? "unknown schema error"}.`,
            });
          } else if (
            stable(parsedArguments.data) !== stable(expectedTool.arguments)
          ) {
            issues.push({
              caseId: label,
              detail: "Expected arguments are not in server-normalised form.",
            });
          }
        }
      }

      if (
        ["UNSUPPORTED", "CLARIFICATION"].includes(step.expected.outcome) &&
        expectedTool
      ) {
        issues.push({
          caseId: label,
          detail: `${step.expected.outcome} must not expect a tool call.`,
        });
      }
      if (
        step.expected.outcome === "ERROR" &&
        (!step.injectFailure || step.injectFailure !== step.expected.errorCode)
      ) {
        issues.push({
          caseId: label,
          detail: "Failure injection and expected runtime error must match.",
        });
      }

      for (const expectedFact of step.expected.facts ?? []) {
        if (!operationsFactSchema.shape.key.safeParse(expectedFact.key).success) {
          issues.push({
            caseId: label,
            detail: `Invalid canonical fact key ${expectedFact.key}.`,
          });
        }
      }
    }
  }

  for (const [category, expected] of Object.entries(
    OPERATIONS_EVAL_EXPECTED_BALANCE,
  ) as [OperationsEvalCategory, number][]) {
    if (balance[category] !== expected) {
      issues.push({
        caseId: "DATASET",
        detail: `${category} expected ${expected}; received ${balance[category]}.`,
      });
    }
  }

  return issues;
}
