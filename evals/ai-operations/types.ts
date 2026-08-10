import type {
  AIOperationsErrorCode,
  OperationsToolName,
} from "@/domain/ai-operations/contracts";

export const OPERATIONS_EVAL_CATEGORIES = [
  "DIRECT_LOOKUP",
  "AGGREGATION_RANKING",
  "DATE_NORMALIZATION",
  "MULTI_TURN_ISOLATION",
  "NO_DATA",
  "UNSUPPORTED_IRRELEVANT",
  "TOOL_PROVIDER_FAILURE",
  "ADVERSARIAL_BOUNDARY",
] as const;

export type OperationsEvalCategory =
  (typeof OPERATIONS_EVAL_CATEGORIES)[number];

export type EvalScalar = string | number | boolean | null;
export type EvalFactValue = EvalScalar | readonly EvalScalar[];

export type EvalFactAssertion = Readonly<{
  key: string;
  value: EvalFactValue;
}>;

export type EvalToolExpectation = Readonly<{
  name: OperationsToolName;
  arguments: Readonly<Record<string, EvalFactValue | undefined>>;
}>;

export type EvalContextMode = "NONE" | "PREVIOUS" | "RESET";
export type EvalExpectedOutcome =
  | "ANSWER"
  | "NO_DATA"
  | "UNSUPPORTED"
  | "CLARIFICATION"
  | "ERROR";

export type OperationsEvalStep = Readonly<{
  question: string;
  contextMode: EvalContextMode;
  expected: Readonly<{
    outcome: EvalExpectedOutcome;
    tool?: EvalToolExpectation;
    facts?: readonly EvalFactAssertion[];
    errorCode?: AIOperationsErrorCode;
  }>;
  injectFailure?: AIOperationsErrorCode;
}>;

export type OperationsEvalCase = Readonly<{
  id: `OPS-EVAL-${string}`;
  fixture: "assessment-reference";
  category: OperationsEvalCategory;
  testMatrix: readonly `TC-AIOPS-${string}`[];
  steps: readonly OperationsEvalStep[];
  repetitions: number;
  critical: boolean;
  forbidden: Readonly<{
    arbitrarySql: true;
    ungroundedFacts: true;
  }>;
}>;

export type EvalObservedToolCall = Readonly<{
  name: string;
  arguments: Readonly<Record<string, unknown>>;
  resultCount?: number;
}>;

export type EvalObservedFact = Readonly<{
  key: string;
  value: unknown;
}>;

export type OperationsEvalObservation = Readonly<{
  outcome: EvalExpectedOutcome;
  toolCalls: readonly EvalObservedToolCall[];
  facts: readonly EvalObservedFact[];
  context?: unknown;
  errorCode?: AIOperationsErrorCode;
  groundingViolations?: readonly string[];
  providerMetrics?: Readonly<{
    inputTokens?: number;
    outputTokens?: number;
    estimatedCostUsd?: number;
  }>;
}>;

export type OperationsEvalExecutionInput = Readonly<{
  caseId: OperationsEvalCase["id"];
  stepIndex: number;
  repetition: number;
  question: string;
  context: unknown;
  injectFailure?: AIOperationsErrorCode;
}>;

export type OperationsEvalExecutor = (
  input: OperationsEvalExecutionInput,
) => Promise<OperationsEvalObservation>;

export const OPERATIONS_EVAL_FAILURE_CODES = [
  "OUTCOME_MISMATCH",
  "TOOL_SELECTION_MISMATCH",
  "TOOL_ARGUMENT_MISMATCH",
  "FACT_MISMATCH",
  "UNGROUNDED_FACT",
  "ARBITRARY_SQL_BOUNDARY",
  "UNSUPPORTED_TOOL_CALL",
  "FAILURE_NOT_HONEST",
  "ERROR_CODE_MISMATCH",
  "CONSISTENCY_MISMATCH",
  "EXECUTOR_FAILURE",
] as const;

export type OperationsEvalFailureCode =
  (typeof OPERATIONS_EVAL_FAILURE_CODES)[number];

export type OperationsEvalFailure = Readonly<{
  caseId: OperationsEvalCase["id"];
  stepIndex: number;
  repetition: number;
  code: OperationsEvalFailureCode;
  detail: string;
  hardGate: boolean;
}>;

export type OperationsEvalStepMetric = Readonly<{
  caseId: OperationsEvalCase["id"];
  stepIndex: number;
  repetition: number;
  latencyMs: number;
  toolCallRounds: number;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
}>;

export type OperationsEvalReport = Readonly<{
  caseCount: number;
  executionCount: number;
  passed: boolean;
  hardGatePassed: boolean;
  toolSelectionAccuracy: number;
  argumentAccuracy: number;
  factAccuracy: number;
  unsupportedHandlingAccuracy: number;
  failureHonestyAccuracy: number;
  failures: readonly OperationsEvalFailure[];
  metrics: readonly OperationsEvalStepMetric[];
}>;
