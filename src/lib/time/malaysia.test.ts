import { describe, expect, it } from "vitest";
import {
  formatMalaysiaDateTime,
  malaysiaDateTimeLocalToIso,
  MALAYSIA_TIME_ZONE,
  toMalaysiaDateTimeLocal,
} from "./malaysia";

describe("Malaysia time presentation", () => {
  it("uses Asia/Kuala_Lumpur", () => {
    expect(MALAYSIA_TIME_ZONE).toBe("Asia/Kuala_Lumpur");
    expect(formatMalaysiaDateTime("2026-01-01T00:00:00.000Z")).toContain("8:00 am");
  });

  it("round-trips datetime-local values using Malaysia time", () => {
    expect(toMalaysiaDateTimeLocal("2026-08-10T01:15:00.000Z")).toBe(
      "2026-08-10T09:15",
    );
    expect(malaysiaDateTimeLocalToIso("2026-08-10T09:15")).toBe(
      "2026-08-10T01:15:00.000Z",
    );
  });
});
