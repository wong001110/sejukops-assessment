import { describe, expect, it } from "vitest";

import {
  assertGroundedOperationsAnswer,
  buildOperationsFacts,
  buildOperationsPresentation,
  formatGroundedOperationsAnswer,
} from "@/lib/services/ai-operations/grounding";
import type { ExecutedOperationsTool } from "@/lib/services/ai-operations/tools";

describe("AI Operations deterministic grounding", () => {
  it("answers a known technician zero workload as grounded data, not missing data", () => {
    const execution = {
      name: "getWorkload",
      arguments: { period: "this_week", technicianName: "Bala", limit: 20 },
      resultCount: 1,
      result: {
        range: {
          start: "2026-08-10T16:00:00.000Z",
          end: "2026-08-17T16:00:00.000Z",
        },
        items: [
          {
            technician_id: "00000000-0000-4000-8000-000000002003",
            technician_name: "Bala",
            active_jobs: 0,
            assigned_jobs: 0,
            in_progress_jobs: 0,
          },
        ],
      },
    } as unknown as ExecutedOperationsTool;
    const facts = buildOperationsFacts(execution);
    const answer = formatGroundedOperationsAnswer(execution);

    expect(answer).toBe(
      "Bala has 0 active jobs this week: 0 assigned and 0 in progress.",
    );
    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "workload.top_name", value: "Bala" }),
        expect.objectContaining({ key: "workload.top_active_jobs", value: 0 }),
      ]),
    );
    expect(buildOperationsPresentation(execution)).toEqual({
      kind: "WORKLOAD",
      rows: [
        {
          technicianId: "00000000-0000-4000-8000-000000002003",
          technicianName: "Bala",
          activeJobs: 0,
          assignedJobs: 0,
          inProgressJobs: 0,
        },
      ],
    });
    expect(() => assertGroundedOperationsAnswer(answer, facts)).not.toThrow();
  });

  it("derives job-table rows and timestamps from the approved tool result rather than model prose", () => {
    const execution = {
      name: "getJobs",
      arguments: {
        period: "last_week",
        technicianName: "Ali",
        completedOnly: true,
        limit: 20,
      },
      resultCount: 2,
      result: {
        range: {
          start: "2026-08-02T16:00:00.000Z",
          end: "2026-08-09T16:00:00.000Z",
        },
        items: [
          {
            order_number: "ORD-2026-0012",
            status: "CLOSED",
            technician_name: "Ali",
            service_type: "Cleaning",
            scheduled_at: "2026-08-03T01:00:00.000Z",
            completed_at: "2026-08-03T03:30:00.000Z",
            final_amount: 180,
          },
          {
            order_number: "ORD-2026-0017",
            status: "REVIEWED",
            technician_name: "Ali",
            service_type: "Repair",
            scheduled_at: "2026-08-05T02:00:00.000Z",
            completed_at: "2026-08-05T05:15:00.000Z",
            final_amount: 300,
          },
        ],
      },
    } as unknown as ExecutedOperationsTool;

    expect(buildOperationsPresentation(execution)).toEqual({
      kind: "JOBS",
      rows: [
        {
          orderNumber: "ORD-2026-0012",
          status: "CLOSED",
          technicianName: "Ali",
          serviceType: "Cleaning",
          scheduledAt: "2026-08-03T01:00:00.000Z",
          completedAt: "2026-08-03T03:30:00.000Z",
          finalAmount: 180,
        },
        {
          orderNumber: "ORD-2026-0017",
          status: "REVIEWED",
          technicianName: "Ali",
          serviceType: "Repair",
          scheduledAt: "2026-08-05T02:00:00.000Z",
          completedAt: "2026-08-05T05:15:00.000Z",
          finalAmount: 300,
        },
      ],
    });
    expect(formatGroundedOperationsAnswer(execution)).toBe(
      "Ali completed 2 matching jobs last week.",
    );
  });

  it("rejects invented order numbers and numeric claims", () => {
    const facts = [
      {
        key: "jobs.count",
        label: "Matching jobs",
        value: 1,
        kind: "COUNT" as const,
      },
      {
        key: "jobs.order_numbers",
        label: "Order numbers",
        value: ["ORD-2026-0012"],
        kind: "ORDER_NUMBER" as const,
      },
    ];
    expect(() =>
      assertGroundedOperationsAnswer("Found ORD-2026-9999.", facts),
    ).toThrow("Ungrounded order number");
    expect(() =>
      assertGroundedOperationsAnswer("There were 7 jobs.", facts),
    ).toThrow("Ungrounded numeric claim");
  });
});
