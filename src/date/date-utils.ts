/**
 * Purpose:
 * - provide shared pure date helpers used across task, dashboard, and summary modules.
 *
 * Responsibilities:
 * - format local current date/time strings for metadata stamping
 * - parse ISO dates used in inline task fields
 * - calculate the local end-of-week boundary for summary bucketing
 *
 * Dependencies:
 * - none outside language/runtime primitives
 *
 * Side Effects:
 * - none (pure date helpers)
 */
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function getCurrentDateString(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getTodayDateString(): string {
  return getCurrentDateString();
}

export function getCurrentTimeString(now: Date = new Date()): string {
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

export function getEndOfWeek(baseDate: Date): Date {
  const endOfWeek = new Date(baseDate);
  const daysUntilSunday = (7 - endOfWeek.getDay()) % 7;
  endOfWeek.setHours(23, 59, 59, 999);
  endOfWeek.setDate(endOfWeek.getDate() + daysUntilSunday);
  return endOfWeek;
}

export function parseIsoDate(value: string): Date | null {
  if (!ISO_DATE_REGEX.test(value)) {
    return null;
  }

  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Shifts an ISO date string by `days` (negative to go backward). Null if unparseable. */
export function addDaysToDateString(dateString: string, days: number): string | null {
  const date = parseIsoDate(dateString);
  if (!date) {
    return null;
  }

  date.setDate(date.getDate() + days);
  return getCurrentDateString(date);
}

/**
 * True when `startDateString + thresholdDays` falls between today and the end of the
 * current (Sunday-ending) week, inclusive — i.e. the item is about to (or just did)
 * cross its staleness threshold "this week." Used by the Weekly Review to flag items
 * worth surfacing now rather than items merely somewhere in the stale backlog.
 */
export function crossesThresholdWithinCurrentWeek(
  startDateString: string,
  thresholdDays: number,
  referenceDate: Date = new Date(),
): boolean {
  const startDate = parseIsoDate(startDateString);
  if (!startDate) {
    return false;
  }

  const thresholdDate = new Date(startDate);
  thresholdDate.setDate(thresholdDate.getDate() + thresholdDays);

  const startOfToday = new Date(referenceDate);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfWeek = getEndOfWeek(referenceDate);

  return thresholdDate >= startOfToday && thresholdDate <= endOfWeek;
}
