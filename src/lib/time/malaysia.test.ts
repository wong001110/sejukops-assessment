import { describe, expect, it } from "vitest";
import { formatMalaysiaDateTime, MALAYSIA_TIME_ZONE } from "./malaysia";

describe("Malaysia time presentation", () => {
  it("uses Asia/Kuala_Lumpur", () => {
    expect(MALAYSIA_TIME_ZONE).toBe("Asia/Kuala_Lumpur");
    expect(formatMalaysiaDateTime("2026-01-01T00:00:00.000Z")).toContain("8:00 am");
  });
});
