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
