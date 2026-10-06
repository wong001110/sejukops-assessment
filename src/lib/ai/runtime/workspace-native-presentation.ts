import type { NativeWorkspace } from "@/domain/agent-workspace/contracts";
import { formatMalaysiaDateTime } from "@/lib/time/malaysia";

type SourceOrder = NativeWorkspace["items"][number]["order"];
const titles: Record<NativeWorkspace["type"], string> = {
  focus: "Orders to inspect", investigation: "Order investigation", comparison: "Compare source records",
  knowledge: "Published knowledge", clarification: "Clarify the next step",
};

/** Model prose is not a factual authority. Compose every public narrative field
 * from validated references and current-run sources, without a second model call.
 * Layout selection and exact, revalidated source excerpts remain model-directed.
 */
export function presentNativeSources(type: NativeWorkspace["type"], orders: SourceOrder[], excerptCount: number,
  proposalPending: boolean, malformed: boolean) {
  const interpretations = orders.map((order) => {
    const scheduled = order.scheduled_at === null ? "Not scheduled."
      : Number.isFinite(Date.parse(order.scheduled_at))
        ? `Scheduled: ${formatMalaysiaDateTime(order.scheduled_at)} MYT.` : "Schedule could not be read.";
    return `Status: ${order.status}. ${scheduled} ${order.assigned_technician_id ? "A technician is assigned." : "No technician is assigned."} Inspect the source record for details.`;
  });
  const missingInformation = orders.flatMap((order) => [
    ...(order.scheduled_at === null ? [`${order.order_no}: no scheduled time is recorded.`] : []),
    ...(order.assigned_technician_id === null ? [`${order.order_no}: no technician is assigned.`] : []),
  ]).slice(0, 4);
  if (orders.length === 0 && excerptCount === 0) missingInformation.push("Provide an order identifier or a phrase to search in published knowledge.");
  return {
    title: titles[type], interpretations, missingInformation,
    summary: malformed ? "The assistant could not validate a layout. Review the scoped source records below."
      : `${orders.length} source record${orders.length === 1 ? "" : "s"} and ${excerptCount} published excerpt${excerptCount === 1 ? "" : "s"} displayed. Facts below come from this run's reads, not model-written summaries.${proposalPending ? " A saved proposal still requires explicit review and confirmation." : ""}`,
    followUps: orders.length ? ["Compare the recent orders.", "Find published knowledge for filter inspection."]
      : ["Which recent orders need attention?"],
  };
}
