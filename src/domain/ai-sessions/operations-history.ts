import type { OperationsAskResult } from "@/lib/ai/runtime/operations-ask";

/** Bounded, human-readable snapshot of public evidence, never a provider transcript. */
export function operationsHistoryAnswer(result: Pick<OperationsAskResult, "answer" | "orders" | "excerpts">): string {
  const sections = [result.answer];
  if (result.orders.length) sections.push("Recorded orders\n" + result.orders.map(order => `${order.order_no} · ${order.status} · ${order.service_type}`).join("\n"));
  if (result.excerpts.length) sections.push("Recorded published knowledge\n" + result.excerpts.map(({ text, citation }) =>
    `${citation.title} · ${citation.sourceLabel} · ${citation.section} · page ${citation.page}\n${text}`).join("\n\n"));
  const answer = sections.join("\n\n");
  const suffix = "\n\nAdditional historical evidence was omitted to keep this record bounded. Ask a fresh question to check current sources.";
  return answer.length <= 6000 ? answer : answer.slice(0, 6000 - suffix.length) + suffix;
}
