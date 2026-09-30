/** Fixed metadata only; never include tool arguments, outputs, or exception text. */
export const KNOWLEDGE_FAILURE_STAGES = [
  "PROVIDER_UNAVAILABLE", "PROVIDER_FAILURE", "TOOL_INPUT_INVALID", "TOOL_QUERY_REJECTED",
  "TOOL_LIMIT_EXCEEDED", "TOOL_EXECUTION_FAILED", "KNOWLEDGE_SEARCH_FAILED",
  "BOUNDED_SEARCH_INCOMPLETE", "CITATION_RECHECK_FAILED",
] as const;

export type KnowledgeFailureStage = typeof KNOWLEDGE_FAILURE_STAGES[number];
export type KnowledgeToolDiagnostics = Readonly<{
  failureStage: KnowledgeFailureStage;
  toolAttempts: number;
  searchCompleted: number;
  invalidToolCalls: number;
  toolErrors: number;
}>;
