const OPENROUTER_NON_THINKING_MODEL = "qwen/qwen3.5-flash-02-23";

/** Options for the one verified optional-reasoning model used by bounded website tasks. */
export function boundedTaskRequestOptions(hostname: string, configuredModel: string): { reasoning?: { enabled: false } } {
  return hostname.toLowerCase().replace(/\.$/, "") === "openrouter.ai" && configuredModel.trim() === OPENROUTER_NON_THINKING_MODEL
    ? { reasoning: { enabled: false } } : {};
}
