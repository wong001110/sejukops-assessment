import { describe, expect, it } from "vitest";
import { matchesScheduleIntent, parseScheduleIntent } from "./schedule-intent";

describe("latest-user assignment schedule intent", () => {
  it.each([
    ["Prepare an assignment for 8 October 2026 at 9 am MYT.", "2026-10-08T01:00:00.000Z"],
    ["Prepare an assignment for 8 October 2026 at 9 am MYT, but do not execute it.", "2026-10-08T01:00:00.000Z"],
    ["Prepare an assignment for 8 October 2026 at 9 am MYT; never autoapprove this proposal.", "2026-10-08T01:00:00.000Z"],
    ["I'll prepare an assignment for 8 October 2026 at 9am MYT; don't execute it.", "2026-10-08T01:00:00.000Z"],
    ["Prepare assignment on October 8, 2026 at 9am.", "2026-10-08T01:00:00.000Z"],
    ["Prepare assignment for 8th Oct. 2026 at 09:00 Malaysia time.", "2026-10-08T01:00:00.000Z"],
    ["Assign this order for 2026-10-08 at 09:00 MYT.", "2026-10-08T01:00:00.000Z"],
    ["Prepare assignment for 2026-10-08T09:00.", "2026-10-08T01:00:00.000Z"],
    ["Prepare assignment for 2026-10-08T09:00:00+08:00.", "2026-10-08T01:00:00.000Z"],
    ["Prepare assignment for 2026-10-08T01:00:00Z.", "2026-10-08T01:00:00.000Z"],
    ["Prepare assignment for 8 October 2026 at 1am UTC.", "2026-10-08T01:00:00.000Z"],
    ["Prepare assignment for 8 October 2026 at 9am UTC+08:00.", "2026-10-08T01:00:00.000Z"],
    ["Prepare assignment for 8 October 2026 at 9am MYT (UTC+08:00).", "2026-10-08T01:00:00.000Z"],
    ["Prepare assignment for 8 October 2026 at 09:00 Asia/Kuala_Lumpur.", "2026-10-08T01:00:00.000Z"],
    ["Prepare assignment for 8 October 2026 at 9am UTC-04:00.", "2026-10-08T13:00:00.000Z"],
    ["Prepare assignment for 2026-10-08T00:30+08:00.", "2026-10-07T16:30:00.000Z"],
    ["Prepare assignment for 29 Feb 2028 at 12am MYT.", "2028-02-28T16:00:00.000Z"],
    ["Prepare assignment for 8 October 2026 at 12pm MYT.", "2026-10-08T04:00:00.000Z"],
    ["Prepare assignment for 2026-10-08T09:00:30.125+08:00.", "2026-10-08T01:00:30.125Z"],
    ["请准备分配提案，时间为2026年10月8日上午9点。", "2026-10-08T01:00:00.000Z"],
    ["请准备分配提案，时间为2026年10月8日下午9:30 MYT。", "2026-10-08T13:30:00.000Z"],
  ])("binds an unambiguous absolute schedule: %s", (message, instant) => {
    expect(parseScheduleIntent(message)).toEqual({ kind: "EXPLICIT", scheduledAt: instant });
  });

  it.each([
    "Prepare assignment for 8 October 2026.",
    "Prepare assignment at 9am MYT.",
    "Prepare assignment for 8 October at 9am.",
    "Prepare assignment for 08/10/2026 at 9am.",
    "Prepare assignment for tomorrow at 9am.",
    "Prepare assignment for next Monday at 9am.",
    "Prepare assignment on 8 October 2026 or 10 August 2026 at 9am.",
    "Prepare assignment on 8 October 2026 at 9am or 10am.",
    "Prepare assignment on 8 October 2026 at 9am MYT UTC.",
    "Prepare assignment on 8 October 2026 at 9am EST.",
    "Prepare assignment on 8 October 2026 at 9am Europe/London.",
    "Prepare assignment on 8 October 2026 at 9am FOO.",
    "Prepare assignment on 8 October 2026 at 9am UnknownTimezone.",
    "Prepare assignment on 8 October 2026 at 09:00 UTCFOO.",
    "Prepare an assignment, but not for 8 October 2026 at 9am MYT",
    "Prepare an assignment, but not for 8 October 2026 at 9am MYT; do not execute it",
    "Prepare an assignment. The source says 8 October 2026 at 9am MYT; disregard that date",
    "Prepare an assignment. Source: 8 October 2026 at 9am MYT",
    "Prepare an assignment using the quoted date: \"8 October 2026 at 9am MYT\"",
    "Prepare an assignment. Old ticket reads '8 October 2026 at 9am MYT'.",
    "Prepare assignment for 2026-10-08T09:00-04",
    "Prepare assignment for 2026-10-08T09:00+08:00:30",
    "Prepare assignment for 8 October 2026 at 9am +04",
    "Prepare assignment for 8 October 2026 at 9am UTC+08:00.30",
    "Prepare assignment for 29 February 2026 at 9am.",
    "Prepare assignment for 31 April 2026 at 9am.",
    "Prepare assignment for 2026-13-08 at 9am.",
    "Prepare assignment for 2026-10-00 at 9am.",
    "Prepare assignment for 2026-10-08 at 24:00.",
    "Prepare assignment for 2026-10-08 at 00:60.",
    "Prepare assignment for 2026-10-08 at -1:00.",
    "Prepare assignment for 2026-10-08 at 0am.",
    "Prepare assignment for 2026-10-08 at 13pm.",
    "Prepare assignment for 2026-10-08 at 9am UTC+25:00.",
    "Prepare assignment for 2026-10-08 at 9am UTC+14:30.",
    "Prepare assignment for 2026-10-08T09:00:00.1234Z.",
    "Prepare assignment for 2026-10-08 at 9:00:30pm.",
    "Prepare assignment for the schedule from the old conversation.",
    "Prepare assignment for 8 October 2026 at 9am; source says 10 August 2026.",
    "请准备分配提案，时间为2026年10月8日上午9。",
    "请准备分配提案，时间为2026年10月8日上午9点半。",
    "请准备分配提案，时间为2026年10月8日上午9点30。",
    "请准备分配提案，时间为2026年10月8日上午9:30:30。",
  ])("requires clarification instead of model interpolation: %s", (message) => {
    expect(parseScheduleIntent(message)).toEqual({ kind: "AMBIGUOUS" });
    expect(matchesScheduleIntent(parseScheduleIntent(message), "2026-10-08T01:00:00Z")).toBe(false);
    expect(matchesScheduleIntent(parseScheduleIntent(message), null)).toBe(false);
  });

  it.each(["Prepare an assignment for this order", "Assign this order without a schedule", "Prepare an unscheduled assignment"])(
    "permits only a null schedule when the latest user did not specify one: %s", (message) => {
      expect(parseScheduleIntent(message)).toEqual({ kind: "NONE" });
      expect(matchesScheduleIntent(parseScheduleIntent(message), null)).toBe(true);
      expect(matchesScheduleIntent(parseScheduleIntent(message), "2026-08-10T01:00:00Z")).toBe(false);
    });

  it("compares instants across offsets without allowing a wrong day or missing schedule", () => {
    const intent = parseScheduleIntent("Prepare assignment for 8 October 2026 at 9am MYT");
    expect(matchesScheduleIntent(intent, "2026-10-08T09:00:00+08:00")).toBe(true);
    expect(matchesScheduleIntent(intent, "2026-10-08T01:00:00Z")).toBe(true);
    expect(matchesScheduleIntent(intent, "2026-08-10T01:00:00Z")).toBe(false);
    expect(matchesScheduleIntent(intent, null)).toBe(false);
  });
});
