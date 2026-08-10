import type { AIModelCapabilities, AITaskType, SafeProfile } from "./ai-settings-api";
import { missingCapabilitiesForTask } from "@/domain/ai-config/contracts";

export const taskLabels: Record<AITaskType, string> = {
  OPERATIONS_QUERY: "Operations Query",
  WORKFLOW_EXPLANATION: "Workflow Explanation",
  OPERATIONAL_INSIGHT: "Operational Insight",
  DOCUMENT_UNDERSTANDING: "Document Understanding",
};

export const capabilityLabels: Record<keyof AIModelCapabilities, string> = {
  text: "Text",
  vision: "Vision",
  toolCalling: "Tool calling",
  structuredOutput: "Structured output",
};

export function missingCapabilities(profile: SafeProfile | undefined, task: AITaskType): Array<keyof AIModelCapabilities> {
  if (!profile || profile.status !== "ACTIVE") return [...missingCapabilitiesForTask({ text: false, vision: false, toolCalling: false, structuredOutput: false }, task, "TEXT")];
  return [...missingCapabilitiesForTask(profile.capabilities, task, "TEXT")];
}

export function missingImageDocumentCapabilities(profile: SafeProfile | undefined): Array<keyof AIModelCapabilities> {
  if (!profile || profile.status !== "ACTIVE") return [...missingCapabilitiesForTask({ text: false, vision: false, toolCalling: false, structuredOutput: false }, "DOCUMENT_UNDERSTANDING", "IMAGE")];
  return [...missingCapabilitiesForTask(profile.capabilities, "DOCUMENT_UNDERSTANDING", "IMAGE")];
}

export function isCompatible(profile: SafeProfile | undefined, task: AITaskType): boolean {
  return missingCapabilities(profile, task).length === 0;
}

export function routingProblems(profiles: readonly SafeProfile[], mode: "SINGLE_MODEL" | "TASK_BASED", defaultId: string | null, routes: Record<AITaskType, string | null>): string[] {
  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  return (Object.keys(taskLabels) as AITaskType[]).flatMap((task) => {
    const selectedId = mode === "SINGLE_MODEL" ? defaultId : routes[task];
    if (!selectedId) return [];
    const profile = byId.get(selectedId);
    if (!profile) return [`${taskLabels[task]} references an unavailable provider.`];
    const missing = missingCapabilities(profile, task);
    return missing.length ? [`${taskLabels[task]} needs ${missing.map((item) => capabilityLabels[item]).join(", ")}.`] : [];
  });
}
