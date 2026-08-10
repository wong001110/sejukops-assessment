import type { ManagerDashboardPeriod } from "./contracts";

/**
 * Golden KPI facts for the fallback reference clock in supabase/seed.sql.
 * Keep this manifest aligned with that deterministic seed rather than copying
 * these values into dashboard tests or future AI evaluation cases.
 */
export const MANAGER_DASHBOARD_GOLDEN_REFERENCE_NOW =
  "2026-08-14T12:00:00+08:00" as const;

export const MANAGER_DASHBOARD_GOLDEN = {
  today: {
    summary: {
      completedJobs: 5,
      totalAmount: 1375,
      rescheduled: 0,
      averageJobValue: 275,
    },
    previous: {
      completedJobs: 3,
      totalAmount: 700,
      rescheduled: 0,
      averageJobValue: 233.33,
    },
    trendJobs: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    trendAmounts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 370, 275, 150, 230, 350, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    technicians: [
      { name: "John", jobs: 2, amount: 625, rescheduled: 0 },
      { name: "Ali", jobs: 1, amount: 370, rescheduled: 0 },
      { name: "Yusoff", jobs: 1, amount: 230, rescheduled: 0 },
      { name: "Bala", jobs: 1, amount: 150, rescheduled: 0 },
    ],
    serviceTypes: [
      { type: "Repair", count: 2, amount: 720 },
      { type: "Aircond Cleaning", count: 1, amount: 230 },
      { type: "Inspection", count: 1, amount: 150 },
      { type: "Installation", count: 1, amount: 275 },
    ],
  },
  this_week: {
    summary: {
      completedJobs: 14,
      totalAmount: 3455,
      rescheduled: 4,
      averageJobValue: 246.79,
    },
    previous: {
      completedJobs: 10,
      totalAmount: 2905,
      rescheduled: 0,
      averageJobValue: 290.5,
    },
    trendJobs: [2, 2, 2, 3, 5, 0, 0],
    trendAmounts: [450, 430, 500, 700, 1375, 0, 0],
    technicians: [
      { name: "John", jobs: 5, amount: 1495, rescheduled: 1 },
      { name: "Ali", jobs: 3, amount: 770, rescheduled: 1 },
      { name: "Yusoff", jobs: 3, amount: 710, rescheduled: 1 },
      { name: "Bala", jobs: 3, amount: 480, rescheduled: 1 },
    ],
    serviceTypes: [
      { type: "Repair", count: 4, amount: 1290 },
      { type: "Aircond Cleaning", count: 3, amount: 630 },
      { type: "Inspection", count: 3, amount: 630 },
      { type: "Gas Refill", count: 2, amount: 330 },
      { type: "Installation", count: 2, amount: 575 },
    ],
  },
  this_month: {
    summary: {
      completedJobs: 25,
      totalAmount: 6515,
      rescheduled: 4,
      averageJobValue: 260.6,
    },
    previous: {
      completedJobs: 12,
      totalAmount: 3070,
      rescheduled: 0,
      averageJobValue: 255.83,
    },
    trendJobs: [8, 17, 0, 0, 0],
    trendAmounts: [2275, 4240, 0, 0, 0],
    technicians: [
      { name: "John", jobs: 8, amount: 2040, rescheduled: 1 },
      { name: "Ali", jobs: 6, amount: 1600, rescheduled: 1 },
      { name: "Bala", jobs: 6, amount: 1105, rescheduled: 1 },
      { name: "Yusoff", jobs: 5, amount: 1770, rescheduled: 1 },
    ],
    serviceTypes: [
      { type: "Repair", count: 7, amount: 2110 },
      { type: "Aircond Cleaning", count: 6, amount: 1490 },
      { type: "Gas Refill", count: 5, amount: 840 },
      { type: "Inspection", count: 4, amount: 780 },
      { type: "Installation", count: 3, amount: 1295 },
    ],
  },
} as const satisfies Readonly<
  Record<
    ManagerDashboardPeriod,
    Readonly<{
      summary: Readonly<Record<string, number>>;
      previous: Readonly<Record<string, number>>;
      trendJobs: readonly number[];
      trendAmounts: readonly number[];
      technicians: readonly Readonly<{
        name: string;
        jobs: number;
        amount: number;
        rescheduled: number;
      }>[];
      serviceTypes: readonly Readonly<{
        type: string;
        count: number;
        amount: number;
      }>[];
    }>
  >
>;

