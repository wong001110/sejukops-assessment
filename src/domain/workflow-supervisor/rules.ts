import { WORKFLOW_SUPERVISOR_THRESHOLDS } from "./contracts";

export type WorkflowSupervisorRuleCode =
  | "HIGH_AMOUNT_VARIANCE"
  | "MISSING_EVIDENCE"
  | "UNUSUAL_EXTRA_CHARGE";

export type WorkflowSupervisorRuleInput = Readonly<{
  quotedPrice: number;
  extraCharges: number;
  finalAmount: number;
  attachmentCount: number;
}>;

/**
 * Pure reference evaluator for deterministic rule tests and documentation.
 * PostgreSQL applies the same constants atomically when an order enters JOB_DONE.
 */
export function evaluateWorkflowSupervisorRules(
  input: WorkflowSupervisorRuleInput,
): readonly WorkflowSupervisorRuleCode[] {
  if (
    !Number.isFinite(input.quotedPrice) ||
    !Number.isFinite(input.extraCharges) ||
    !Number.isFinite(input.finalAmount) ||
    !Number.isInteger(input.attachmentCount) ||
    input.quotedPrice < 0 ||
    input.extraCharges < 0 ||
    input.finalAmount < 0 ||
    input.attachmentCount < 0
  ) {
    throw new Error("Workflow rule facts must be finite and non-negative");
  }
  const varianceAmount = Math.max(input.finalAmount - input.quotedPrice, 0);
  const varianceRatio =
    input.quotedPrice > 0 ? varianceAmount / input.quotedPrice : null;
  const extraChargeRatio =
    input.quotedPrice > 0 ? input.extraCharges / input.quotedPrice : null;
  const matches: WorkflowSupervisorRuleCode[] = [];

  if (
    varianceAmount >=
      WORKFLOW_SUPERVISOR_THRESHOLDS.highAmountVarianceMinimum &&
    (input.quotedPrice === 0 ||
      (varianceRatio !== null &&
        varianceRatio >=
          WORKFLOW_SUPERVISOR_THRESHOLDS.highAmountVarianceRatio))
  ) {
    matches.push("HIGH_AMOUNT_VARIANCE");
  }
  if (input.attachmentCount === 0) matches.push("MISSING_EVIDENCE");
  if (
    input.extraCharges >=
      WORKFLOW_SUPERVISOR_THRESHOLDS.unusualExtraChargeMinimum ||
    (extraChargeRatio !== null &&
      extraChargeRatio >=
        WORKFLOW_SUPERVISOR_THRESHOLDS.unusualExtraChargeRatio)
  ) {
    matches.push("UNUSUAL_EXTRA_CHARGE");
  }
  return matches;
}
