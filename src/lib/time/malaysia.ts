export const MALAYSIA_TIME_ZONE = "Asia/Kuala_Lumpur";

export function formatMalaysiaDateTime(value: Date | string | number, options: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: MALAYSIA_TIME_ZONE,
    ...options,
  }).format(new Date(value));
}

export function malaysiaTimeZoneLabel(): string {
  return "Malaysia time (MYT, UTC+08:00)";
}

/** Formats an instant for a `datetime-local` input in Malaysia time. */
export function toMalaysiaDateTimeLocal(value: Date | string | number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MALAYSIA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

/** Converts a Malaysia-time `datetime-local` value into a transport-safe ISO instant. */
export function malaysiaDateTimeLocalToIso(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    throw new RangeError("Expected a datetime-local value in YYYY-MM-DDTHH:mm format");
  }
  const instant = new Date(`${value}:00+08:00`);
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError("The Malaysia date and time is invalid");
  }
  return instant.toISOString();
}
