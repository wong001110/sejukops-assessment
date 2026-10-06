import { describe, expect, it } from "vitest";
import { aggregateDashboard, dashboardRange } from "./aggregate";
import { dashboardActivitySchema, type DashboardOrder } from "./contracts";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-10-05T04:00:00Z");
const activity = { asOf: now.toISOString(), generation: 1, completed: 2, rescheduled: 1, previousCompleted: 1, previousRescheduled: 0, trend: [{ label: "05/10", jobs: 2 }], technicians: [] };
const row = (created_at: string, patch: Partial<DashboardOrder> = {}): DashboardOrder => ({ id,workspace_id:workspaceId, order_no:"MOCK",status:"NEW",assigned_technician_id:null,service_type:"Cleaning",scheduled_at:null,created_at,...patch });
function run(rows: DashboardOrder[]) { return aggregateDashboard(rows,{workspaceId,role:"MANAGER",period:"today",generation:1,now,activity}); }
describe("dashboard MYT periods and aggregates", () => {
  it("uses MYT midnight and Monday start across UTC date boundaries", () => {
    expect(new Date(dashboardRange("today",now).start).toISOString()).toBe("2026-10-04T16:00:00.000Z");
    expect(new Date(dashboardRange("this_week",now).start).toISOString()).toBe("2026-10-04T16:00:00.000Z");
    expect(new Date(dashboardRange("this_week",new Date("2026-10-04T15:59:00Z")).start).toISOString()).toBe("2026-09-27T16:00:00.000Z");
  });
  it("compares equal elapsed time, clamps short prior calendar months", () => {
    const range=dashboardRange("this_month",new Date("2026-03-31T04:00:00Z"));
    expect(new Date(range.previousStart).toISOString()).toBe("2026-01-31T16:00:00.000Z");
    expect(new Date(range.previousEnd).toISOString()).toBe("2026-02-28T16:00:00.000Z");
  });
  it("includes start and excludes end for cohorts; older active jobs remain in queue", () => {
    const result=run([row("2026-10-04T15:59:59Z"),row("2026-10-04T16:00:00Z",{status:"COMPLETED"}),row("2026-10-05T04:00:00Z")]);
    expect(result.cohort).toEqual({orders:1,completed:1,completionRate:100});
    expect(result.current.total).toBe(3); expect(result.current.active).toBe(2);
    expect(result.trend.reduce((total,item)=>total+item.orders,0)).toBe(1);
  });
  it("does not infer completion event dates from current completed statuses", () => {
    const result=run([row("2026-09-01T00:00:00Z",{status:"COMPLETED"})]);
    expect(result.current.completed).toBe(1); expect(result.cohort.completed).toBe(0);
    expect(result.activity.completed).toBe(2);
  });
  it("counts scheduling attention only for active statuses and explicit dates", () => {
    const result=run([row(now.toISOString(),{status:"COMPLETED",scheduled_at:"2026-10-04T20:00:00Z"}),
      row(now.toISOString(),{status:"ASSIGNED",scheduled_at:"2026-10-05T03:00:00Z"}),
      row(now.toISOString(),{status:"IN_PROGRESS",scheduled_at:null})]);
    expect(result.current).toMatchObject({overdue:1,scheduledToday:1,needsSchedule:1,active:2});
  });
  it("counts beyond the recent table bound; safe empty distribution", () => {
    const result=run(Array.from({length:65},(_,i)=>row("2026-10-04T20:00:00Z",{id:`${String(i).padStart(8,"0")}-2222-4222-8222-222222222222`})));
    expect(result.cohort.orders).toBe(65); expect(result.recentOrders).toHaveLength(12);
    expect(result.services).toEqual([{type:"Cleaning",orders:65,sharePercent:100}]);
    expect(run([]).services).toEqual([]); expect(run([]).cohort.completionRate).toBe(0);
  });
  it("accepts actual PostgreSQL JSON timestamps with UTC offset", () => {
    expect(dashboardActivitySchema.parse({...activity,asOf:"2026-10-05T04:00:00.123456+00:00"}).asOf).toContain("+00:00");
  });
});
