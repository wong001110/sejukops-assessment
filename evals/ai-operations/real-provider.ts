import { runOperationsEval } from "./harness";
import type {
  OperationsEvalCase,
  OperationsEvalExecutor,
  OperationsEvalReport,
} from "./types";

const REAL_EVAL_OPT_IN = "AI_OPERATIONS_REAL_EVAL";

/**
 * Deliberately opt-in wrapper for a runtime-backed executor. The caller owns
 * provider selection and safe reporting; this module never reads or prints a
 * credential and never silently turns a normal test run into paid traffic.
 */
export async function runOptInRealProviderEval(
  cases: readonly OperationsEvalCase[],
  execute: OperationsEvalExecutor,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<OperationsEvalReport> {
  if (environment[REAL_EVAL_OPT_IN] !== "1") {
    throw new Error(
      `Real-provider evaluation is disabled. Set ${REAL_EVAL_OPT_IN}=1 only for an explicitly scheduled run.`,
    );
  }
  return runOperationsEval(cases, execute);
}
