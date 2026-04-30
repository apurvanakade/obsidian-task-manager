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
