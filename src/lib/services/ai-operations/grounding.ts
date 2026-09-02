import {
  operationalPeriodLabel,
  type ConversationContext,
  type GetJobsArguments,
  type GetTechnicianStatsArguments,
  type GetWorkloadArguments,
  type OperationsFact,
  type OperationsPresentation,
} from "@/domain/ai-operations/contracts";

import type { ExecutedOperationsTool } from "./tools";

function money(value: number): string {
  return `RM ${value.toFixed(2)}`;
}

function rangeFacts(
  range: Readonly<{ start: string; end: string }> | null,
): OperationsFact[] {
  if (!range) return [];
  return [
    { key: "range.start", label: "Range start", value: range.start, kind: "DATE_RANGE" },
    { key: "range.end", label: "Range end", value: range.end, kind: "DATE_RANGE" },
  ];
}

function itemKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

export function buildOperationsFacts(
  execution: ExecutedOperationsTool,
): readonly OperationsFact[] {
  if (execution.name === "getJobs") {
    const result = execution.result as ExecutedOperationsTool<"getJobs">["result"];
    return [
      ...rangeFacts(result.range),
      {
        key: "jobs.count",
        label: "Matching jobs",
        value: result.items.length,
        kind: "COUNT",
      },
      {
        key: "jobs.order_numbers",
        label: "Order numbers",
        value: result.items.map((item) => item.order_number),
        kind: "ORDER_NUMBER",
      },
      ...result.items.flatMap((item): OperationsFact[] => {
        const key = `jobs.${itemKey(item.order_number)}`;
        return [
          { key: `${key}.status`, label: `${item.order_number} status`, value: item.status, kind: "STATUS" },
          { key: `${key}.technician`, label: `${item.order_number} technician`, value: item.technician_name ?? "Unassigned", kind: "TEXT" },
          { key: `${key}.service_type`, label: `${item.order_number} service type`, value: item.service_type, kind: "TEXT" },
          { key: `${key}.final_amount`, label: `${item.order_number} final amount`, value: item.final_amount, kind: "AMOUNT" },
        ];
      }),
    ];
  }
  if (execution.name === "getTechnicianStats") {
    const result = execution.result as ExecutedOperationsTool<"getTechnicianStats">["result"];
    const args = execution.arguments as GetTechnicianStatsArguments;
    const relevant = args.technicianNames?.length
      ? result.items
      : result.items.filter((item) => item.completed_jobs > 0);
    const top = relevant[0];
    return [
      ...rangeFacts(result.range),
      { key: "technicians.count", label: "Technicians returned", value: relevant.length, kind: "COUNT" },
      ...(top
        ? [
            { key: "technicians.top_name", label: "Top technician", value: top.technician_name, kind: "TEXT" } as const,
            { key: "technicians.top_completed_jobs", label: "Top completed jobs", value: top.completed_jobs, kind: "COUNT" } as const,
            { key: "technicians.top_completed_amount", label: "Top completed amount", value: top.completed_amount, kind: "AMOUNT" } as const,
          ]
        : []),
      ...relevant.flatMap((item): OperationsFact[] => {
        const key = `technicians.${itemKey(item.technician_id)}`;
        return [
          { key: `${key}.name`, label: "Technician", value: item.technician_name, kind: "TEXT" },
          { key: `${key}.completed_jobs`, label: `${item.technician_name} completed jobs`, value: item.completed_jobs, kind: "COUNT" },
          { key: `${key}.completed_amount`, label: `${item.technician_name} completed amount`, value: item.completed_amount, kind: "AMOUNT" },
        ];
      }),
    ];
  }
  if (execution.name === "getOperationalSummary") {
    const result = execution.result as ExecutedOperationsTool<"getOperationalSummary">["result"];
    return [
      ...rangeFacts(result.range),
      { key: "summary.completed_jobs", label: "Completed jobs", value: result.completedJobs, kind: "COUNT" },
      { key: "summary.total_amount", label: "Total completed amount", value: result.totalAmount, kind: "AMOUNT" },
    ];
  }
  const result = execution.result as ExecutedOperationsTool<"getWorkload">["result"];
  const workloadArgs = execution.arguments as GetWorkloadArguments;
  const relevant = workloadArgs.technicianNames?.length
    ? result.items
    : result.items.filter((item) => item.active_jobs > 0);
  const top = relevant[0];
  return [
    ...rangeFacts(result.range),
    { key: "workload.technicians_count", label: "Technicians returned", value: relevant.length, kind: "COUNT" },
    ...(top
      ? [
          { key: "workload.top_name", label: "Highest workload technician", value: top.technician_name, kind: "TEXT" } as const,
          { key: "workload.top_active_jobs", label: "Highest active workload", value: top.active_jobs, kind: "COUNT" } as const,
        ]
      : []),
    ...relevant.flatMap((item): OperationsFact[] => {
      const key = `workload.${itemKey(item.technician_id)}`;
      return [
        { key: `${key}.name`, label: "Technician", value: item.technician_name, kind: "TEXT" },
        { key: `${key}.active_jobs`, label: `${item.technician_name} active jobs`, value: item.active_jobs, kind: "COUNT" },
        { key: `${key}.assigned_jobs`, label: `${item.technician_name} assigned jobs`, value: item.assigned_jobs, kind: "COUNT" },
        { key: `${key}.in_progress_jobs`, label: `${item.technician_name} in-progress jobs`, value: item.in_progress_jobs, kind: "COUNT" },
      ];
    }),
  ];
}

export function buildOperationsPresentation(
  execution: ExecutedOperationsTool,
): OperationsPresentation {
  if (execution.name === "getJobs") {
    const result = execution.result as ExecutedOperationsTool<"getJobs">["result"];
    return {
      kind: "JOBS",
      rows: result.items.map((item) => ({
        orderNumber: item.order_number,
        status: item.status,
        technicianName: item.technician_name,
        serviceType: item.service_type,
        scheduledAt: item.scheduled_at,
        completedAt: item.completed_at,
        finalAmount: item.final_amount,
      })),
    };
  }

  if (execution.name === "getTechnicianStats") {
    const result = execution.result as ExecutedOperationsTool<"getTechnicianStats">["result"];
    const args = execution.arguments as GetTechnicianStatsArguments;
    const relevant = args.technicianNames?.length
      ? result.items
      : result.items.filter((item) => item.completed_jobs > 0);
    return {
      kind: "TECHNICIAN_PERFORMANCE",
      rows: relevant.map((item) => ({
        technicianId: item.technician_id,
        technicianName: item.technician_name,
        completedJobs: item.completed_jobs,
        completedAmount: item.completed_amount,
      })),
    };
  }

  if (execution.name === "getOperationalSummary") {
    const result = execution.result as ExecutedOperationsTool<"getOperationalSummary">["result"];
    return {
      kind: "OPERATIONAL_SUMMARY",
      completedJobs: result.completedJobs,
      totalAmount: result.totalAmount,
    };
  }

  const result = execution.result as ExecutedOperationsTool<"getWorkload">["result"];
  const args = execution.arguments as GetWorkloadArguments;
  const relevant = args.technicianNames?.length
    ? result.items
    : result.items.filter((item) => item.active_jobs > 0);
  return {
    kind: "WORKLOAD",
    rows: relevant.map((item) => ({
      technicianId: item.technician_id,
      technicianName: item.technician_name,
      activeJobs: item.active_jobs,
      assignedJobs: item.assigned_jobs,
      inProgressJobs: item.in_progress_jobs,
    })),
  };
}

export function formatGroundedOperationsAnswer(
  execution: ExecutedOperationsTool,
): string {
  const args = execution.arguments as {
    period?: string;
    technicianNames?: string[];
    orderNumbers?: string[];
    completedOnly?: boolean;
  };
  const period = args.period
    ? args.period.startsWith("month:")
      ? operationalPeriodLabel(args.period)
      : operationalPeriodLabel(args.period).toLowerCase()
    : "the requested scope";
  if (execution.resultCount === 0) {
    return args.orderNumbers?.length
      ? "No matching requested orders were found in current operational data."
      : `No matching operational data was found for ${period}.`;
  }
  if (execution.name === "getJobs") {
    const result = execution.result as ExecutedOperationsTool<"getJobs">["result"];
    if (args.orderNumbers?.length === 1 && result.items.length === 1) {
      const job = result.items[0];
      return `${job.order_number} is ${job.status}. It is a ${job.service_type} job assigned to ${job.technician_name ?? "no technician"}, with an authoritative amount of ${money(job.final_amount)}.`;
    }
    if (args.orderNumbers?.length) {
      return `Found ${result.items.length} matching requested ${result.items.length === 1 ? "order" : "orders"} in current operational data.`;
    }
    if (args.technicianNames?.length === 1) {
      const verb = args.completedOnly ? "completed" : "has";
      return `${args.technicianNames[0]} ${verb} ${result.items.length} matching ${result.items.length === 1 ? "job" : "jobs"} ${period}.`;
    }
    return `Found ${result.items.length} matching ${result.items.length === 1 ? "job" : "jobs"} ${period}.`;
  }
  if (execution.name === "getTechnicianStats") {
    const result = execution.result as ExecutedOperationsTool<"getTechnicianStats">["result"];
    const relevant = args.technicianNames?.length
      ? result.items
      : result.items.filter((item) => item.completed_jobs > 0);
    const top = relevant[0];
    if (args.technicianNames?.length === 1 && top) {
      return `${top.technician_name} completed ${top.completed_jobs} ${top.completed_jobs === 1 ? "job" : "jobs"} ${period}, totaling ${money(top.completed_amount)}.`;
    }
    if (args.technicianNames?.length) {
      return `Returned performance for ${relevant.length} ${relevant.length === 1 ? "technician" : "technicians"} ${period}.`;
    }
    return `${top.technician_name} completed the most jobs ${period}: ${top.completed_jobs} jobs totaling ${money(top.completed_amount)}.`;
  }
  if (execution.name === "getOperationalSummary") {
    const result = execution.result as ExecutedOperationsTool<"getOperationalSummary">["result"];
    return `${result.completedJobs} ${result.completedJobs === 1 ? "job was" : "jobs were"} completed ${period}, totaling ${money(result.totalAmount)}.`;
  }
  const result = execution.result as ExecutedOperationsTool<"getWorkload">["result"];
  const relevant = args.technicianNames?.length
    ? result.items
    : result.items.filter((item) => item.active_jobs > 0);
  const top = relevant[0];
  if (args.technicianNames?.length === 1) {
    return `${top.technician_name} has ${top.active_jobs} active ${top.active_jobs === 1 ? "job" : "jobs"} ${period}: ${top.assigned_jobs} assigned and ${top.in_progress_jobs} in progress.`;
  }
  if (args.technicianNames?.length) {
    return `Returned workload for ${relevant.length} ${relevant.length === 1 ? "technician" : "technicians"} ${period}.`;
  }
  return `${top.technician_name} has the highest workload ${period} with ${top.active_jobs} active ${top.active_jobs === 1 ? "job" : "jobs"}.`;
}

export function contextFromExecution(
  execution: ExecutedOperationsTool,
): ConversationContext {
  const args = execution.arguments as GetJobsArguments &
    Partial<GetTechnicianStatsArguments> &
    Partial<GetWorkloadArguments>;
  const intent =
    execution.name === "getJobs"
      ? "JOBS_LOOKUP"
      : execution.name === "getTechnicianStats"
        ? "TECHNICIAN_PERFORMANCE"
        : execution.name === "getOperationalSummary"
          ? "OPERATIONAL_SUMMARY"
          : "WORKLOAD";
  return {
    intent,
    ...(args.period ? { period: args.period } : {}),
    ...(args.technicianNames?.length ? { technicianNames: args.technicianNames } : {}),
    ...(args.statuses?.length ? { statuses: args.statuses } : {}),
    ...(args.serviceTypes?.length ? { serviceTypes: args.serviceTypes } : {}),
    ...(args.orderNumbers?.length ? { orderNumbers: args.orderNumbers } : {}),
  };
}

export function assertGroundedOperationsAnswer(
  answer: string,
  facts: readonly OperationsFact[],
): void {
  const knownOrders = new Set(
    facts.flatMap((fact) =>
      fact.kind === "ORDER_NUMBER"
        ? Array.isArray(fact.value)
          ? fact.value
          : [String(fact.value)]
        : [],
    ),
  );
  for (const order of answer.match(/ORD-[0-9]{4}-[0-9]{4,}/g) ?? []) {
    if (!knownOrders.has(order)) throw new Error("Ungrounded order number");
  }
  const knownNumbers = facts
    .filter((fact) => typeof fact.value === "number")
    .map((fact) => Number(fact.value));
  const scrubbed = answer
    .replace(/ORD-[0-9]{4}-[0-9]{4,}/g, "")
    .replace(/\d{4}-\d{2}-\d{2}T[^\s]+/g, "");
  for (const token of scrubbed.match(/\b\d+(?:\.\d+)?\b/g) ?? []) {
    const value = Number(token);
    if (!knownNumbers.some((known) => Math.abs(known - value) < 0.005)) {
      throw new Error("Ungrounded numeric claim");
    }
  }
}
