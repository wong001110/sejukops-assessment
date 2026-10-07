import { malaysiaDateTimeLocalToIso } from "@/lib/time/malaysia";

export type ScheduleIntent =
  | { kind: "NONE" }
  | { kind: "EXPLICIT"; scheduledAt: string }
  | { kind: "AMBIGUOUS" };

const monthNames = ["jan(?:uary)?", "feb(?:ruary)?", "mar(?:ch)?", "apr(?:il)?", "may", "jun(?:e)?",
  "jul(?:y)?", "aug(?:ust)?", "sep(?:t(?:ember)?)?", "oct(?:ober)?", "nov(?:ember)?", "dec(?:ember)?"].join("|");
const months: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (value: number) => String(value).padStart(2, "0");

/** A conservative parser of the latest user message, never retrieved text or history.
 * Unsupported/partial/conflicting schedule expressions require clarification. No
 * date, year, time or timezone is supplied by the model; unzoned times use MYT.
 */
export function parseScheduleIntent(latestUserMessage: string): ScheduleIntent {
  let remaining = latestUserMessage;
  const dates: { year: number; month: number; day: number }[] = [];
  const addDate = (year: string, month: string | number, day: string) => {
    dates.push({ year: Number(year), month: Number(month), day: Number(day) });
    return " ";
  };
  remaining = remaining.replace(/(?<![\w-])(\d{4})-(\d{2})-(\d{2})(?:T(?=\d{2}:)|(?![\w-]))/gi,
    (_match, year, month, day) => addDate(year, month, day));
  remaining = remaining.replace(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthNames})\\.?\\s+(\\d{4})\\b`, "gi"),
    (_match, day, month: string, year) => addDate(year, months[month.toLowerCase().slice(0, 3)], day));
  remaining = remaining.replace(new RegExp(`\\b(${monthNames})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,\\s*|\\s+)(\\d{4})\\b`, "gi"),
    (_match, month: string, day, year) => addDate(year, months[month.toLowerCase().slice(0, 3)], day));
  remaining = remaining.replace(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/g,
    (_match, year, month, day) => addDate(year, month, day));

  const offsets: number[] = [];
  // A timezone-looking word immediately after a clock must not silently become
  // MYT. Dates have already been removed, so a time-before-date is also safe.
  const clockWords = remaining.matchAll(/\b(?:\d{1,2}(?::\d{2})?\s*[ap]m|\d{1,2}:\d{2}(?::\d{2})?)\s+([a-z]{2,})\b/gi);
  let invalid = [...clockWords].some((match) => !/^(?:MYT|UTC|GMT|Asia|Malaysia|for|on|and|but|using|with|to|please|do|without|before|after)$/i.test(match[1]));
  // Consume the entire offset token before validating it. A partial match must
  // not turn a truncated/fractional/seconds offset into an apparently valid one.
  remaining = remaining.replace(/\b(?:MYT|Malaysia\s+time|Asia\/Kuala_Lumpur|UTC|GMT)\b(?:\s*[+-]\d[\d:]*(?:\.\d+)?)?|(?<=\d)Z\b|[+-]\d[\d:]*(?:\.\d+)?/gi,
    (token: string) => {
      const label = token.match(/^(MYT|Malaysia\s+time|Asia\/Kuala_Lumpur|UTC|GMT)\b/i)?.[0];
      const suffix = label ? token.slice(label.length).trim() : token;
      if (!suffix || suffix.toUpperCase() === "Z") {
        offsets.push(suffix || /^(?:UTC|GMT)$/i.test(label ?? "") ? 0 : 480);
        return " ";
      }
      const signed = label ? suffix.match(/^([+-])(\d{1,2})(?::(\d{2}))?$/) ?? suffix.match(/^([+-])(\d{2})(\d{2})$/)
        : suffix.match(/^([+-])(\d{2}):?(\d{2})$/);
      if (!signed) invalid = true;
      else {
        const [, sign, hours, minutes] = signed;
        const h = Number(hours), m = Number(minutes ?? 0);
        if (h > 14 || m > 59 || (h === 14 && m !== 0)) invalid = true;
        offsets.push((h * 60 + m) * (sign === "-" ? -1 : 1));
        if (label && !/^(?:UTC|GMT)$/i.test(label)) invalid = true;
      }
      return " ";
    });

  const times: { hour: number; minute: number; second: number; millisecond: number }[] = [];
  const addTime = (hour: number, minute: number, second = 0, millisecond = 0) => {
    if (hour > 23 || minute > 59 || second > 59) invalid = true;
    times.push({ hour, minute, second, millisecond });
    return " ";
  };
  remaining = remaining.replace(/(?<![\w:+.\-])(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/gi,
    (_match, hour: string, minute: string | undefined, meridiem: string) => {
      const h = Number(hour);
      if (h < 1 || h > 12) invalid = true;
      return addTime(h % 12 + (meridiem.toLowerCase() === "pm" ? 12 : 0), Number(minute ?? 0));
    });
  remaining = remaining.replace(/(上午|下午)\s*(\d{1,2})(?::(\d{2})|(?:点|時|时)(?:(\d{1,2})分)?)(?![\d:半])/g,
    (_match, meridiem: string, hour: string, colonMinute: string | undefined, minute: string | undefined) => {
      const h = Number(hour);
      if (h < 1 || h > 12) invalid = true;
      return addTime(h % 12 + (meridiem === "下午" ? 12 : 0), Number(colonMinute ?? minute ?? 0));
    });
  remaining = remaining.replace(/(?<![\w:+.\-])(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(?![\w:]|\.\d)/g,
    (_match, hour, minute, second: string | undefined, fraction: string | undefined) =>
      addTime(Number(hour), Number(minute), Number(second ?? 0), Number((fraction ?? "").padEnd(3, "0"))));

  // Do not silently select one of multiple dates/times or reinterpret a slash
  // date, relative date, missing year, unsupported timezone, or a time range.
  const unsupported = new RegExp(`\\b(?:${monthNames}|today|tomorrow|yesterday|next|monday|tuesday|wednesday|thursday|friday|saturday|sunday|noon|midnight|morning|afternoon|evening|night|days?|weeks?|months?|years?|EST|EDT|CST|CDT|PST|PDT|IST|CET|CEST|BST|SGT|JST|AEST|AEDT)\\b`, "i");
  const incomplete = unsupported.test(remaining) || /\b\d{1,4}[/-]\d{1,2}(?:[/-]\d{1,4})?\b|今天|明天|后天|下周|下个月|上午|下午|\d+年|\d+月|\d+日|\d+点|\bat\s+\d|[A-Za-z_]+\/[A-Za-z_]+/i.test(remaining);
  if (invalid || incomplete || dates.length > 1 || times.length > 1 || new Set(offsets).size > 1) return { kind: "AMBIGUOUS" };
  if (dates.length === 0 && times.length === 0) {
    const explicitlyUnscheduled = /\b(?:unscheduled|without\s+(?:a\s+)?schedule|no\s+(?:schedule|scheduled\s+time))\b|不安排时间|无需排期/i.test(remaining);
    return !explicitlyUnscheduled && /\b(?:schedule|scheduled|date|time)\b|时间|日期|排期/i.test(remaining)
      ? { kind: "AMBIGUOUS" } : { kind: "NONE" };
  }
  if (dates.length !== 1 || times.length !== 1) return { kind: "AMBIGUOUS" };

  // Token extraction is not language understanding. A negated, quoted or
  // source-attributed date does not authorize that schedule; ask the user to
  // restate the intended absolute date/time directly.
  const scheduleStatement = latestUserMessage.replace(/\b(?:(?:do\s+not|don't|never|not)\s+(?:auto[-\s]?)?(?:approve|execute))(?:\s+(?:it|this|the\s+(?:assignment|proposal)))?\b|不要(?:执行|批准)|不(?:执行|批准)/gi, " ");
  const indirectOrNegated = /\b(?:not|never|except|ignore|disregard|avoid|cancel|don't|do\s+not|rather\s+than|instead\s+of|according\s+to|quoted|quotation)\b|\b(?:source|note|document|history|conversation)\s*(?::|says|states|reports|shows|suggests)|["“”‘’`]|不是|不要|忽略|取消|不在|不安排|来源|资料|原文|引用|历史/i;
  if (indirectOrNegated.test(scheduleStatement) || /(?<!\w)'[^'\r\n]+'(?!\w)/.test(scheduleStatement)) return { kind: "AMBIGUOUS" };

  const { year, month, day } = dates[0];
  const { hour, minute, second, millisecond } = times[0];
  const date = `${year}-${pad(month)}-${pad(day)}`;
  const calendar = new Date(`${date}T00:00:00Z`);
  if (year < 1000 || calendar.getUTCFullYear() !== year || calendar.getUTCMonth() + 1 !== month || calendar.getUTCDate() !== day) {
    return { kind: "AMBIGUOUS" };
  }
  const offset = offsets[0] ?? 480;
  const local = `${date}T${pad(hour)}:${pad(minute)}`;
  // Reuse the application's explicit Malaysia datetime-local conversion.
  const instant = offset === 480 && second === 0 && millisecond === 0 ? malaysiaDateTimeLocalToIso(local)
    : new Date(`${local}:${pad(second)}.${String(millisecond).padStart(3, "0")}${offset < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`).toISOString();
  return { kind: "EXPLICIT", scheduledAt: instant };
}

/** Same instant may be transported with a different offset; absent intent may
 * never be filled from a model, history or source. Ambiguous intent authorizes none.
 */
export function matchesScheduleIntent(intent: ScheduleIntent, scheduledAt: string | null): boolean {
  if (intent.kind === "NONE") return scheduledAt === null;
  return intent.kind === "EXPLICIT" && scheduledAt !== null && Date.parse(scheduledAt) === Date.parse(intent.scheduledAt);
}
