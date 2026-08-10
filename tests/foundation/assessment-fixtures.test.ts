import { describe, expect, it } from "vitest";

import {
  ASSESSMENT_BRANCH_CODES,
  ASSESSMENT_GOLDEN_FACTS,
  ASSESSMENT_IDENTITIES,
  ASSESSMENT_REFERENCE_NOW,
} from "../../src/domain/assessment-fixtures";

describe("deterministic assessment fixture contract", () => {
  it("keeps the frozen evaluation anchor and stable branches", () => {
    expect(ASSESSMENT_REFERENCE_NOW).toBe("2026-08-14T12:00:00+08:00");
    expect(ASSESSMENT_BRANCH_CODES).toEqual([
      "BR-01",
      "BR-02",
      "BR-03",
      "BR-04",
      "BR-05",
    ]);
  });

  it("keeps named demo identities and primary branches stable", () => {
    expect(ASSESSMENT_IDENTITIES.technicians.map(({ name }) => name)).toEqual([
      "Ali",
      "John",
      "Bala",
      "Yusoff",
    ]);
  });

  it("preserves the published Ali last-week golden fact", () => {
    expect(ASSESSMENT_GOLDEN_FACTS.aliCompletedLastWeek).toEqual([
      "ORD-2026-0012",
      "ORD-2026-0017",
      "ORD-2026-0020",
    ]);
  });
});
