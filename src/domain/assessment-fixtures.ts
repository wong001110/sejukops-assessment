import {
  MANAGER_DASHBOARD_GOLDEN,
  MANAGER_DASHBOARD_GOLDEN_REFERENCE_NOW,
} from "./manager-dashboard/golden";

export {
  MANAGER_DASHBOARD_GOLDEN,
  MANAGER_DASHBOARD_GOLDEN_REFERENCE_NOW,
} from "./manager-dashboard/golden";

export const ASSESSMENT_TIME_ZONE = "Asia/Kuala_Lumpur" as const;
export const ASSESSMENT_REFERENCE_NOW =
  MANAGER_DASHBOARD_GOLDEN_REFERENCE_NOW;

export const ASSESSMENT_BRANCH_CODES = [
  "BR-01",
  "BR-02",
  "BR-03",
  "BR-04",
  "BR-05",
] as const;

export const ASSESSMENT_IDENTITIES = {
  admin: { name: "Admin Demo", role: "ADMIN" },
  manager: { name: "Manager Demo", role: "MANAGER" },
  technicians: [
    { name: "Ali", branchCode: "BR-01" },
    { name: "John", branchCode: "BR-02" },
    { name: "Bala", branchCode: "BR-03" },
    { name: "Yusoff", branchCode: "BR-04" },
  ],
} as const;
/** Golden values for the committed fallback anchor in supabase/seed.sql. */
export const ASSESSMENT_GOLDEN_FACTS = {
  aliCompletedLastWeek: [
    "ORD-2026-0012",
    "ORD-2026-0017",
    "ORD-2026-0020",
  ],
  completedToday: MANAGER_DASHBOARD_GOLDEN.today.summary.completedJobs,
  completedThisWeek: MANAGER_DASHBOARD_GOLDEN.this_week.summary.completedJobs,
  totalCompletedAmountToday:
    MANAGER_DASHBOARD_GOLDEN.today.summary.totalAmount,
  totalCompletedAmountThisWeek:
    MANAGER_DASHBOARD_GOLDEN.this_week.summary.totalAmount,
  topTechnicianThisWeek: {
    name: MANAGER_DASHBOARD_GOLDEN.this_week.technicians[0].name,
    completedJobs: MANAGER_DASHBOARD_GOLDEN.this_week.technicians[0].jobs,
  },
  activeWorkload: {
    Ali: 1,
    John: 1,
    Bala: 0,
    Yusoff: 0,
  },
  knownOrder: { orderNo: "ORD-2026-0036", status: "ASSIGNED" },
  noResultServiceType: "Duct Cleaning",
} as const;
