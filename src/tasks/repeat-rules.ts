/**
 * Purpose:
 * - provide pure parsing and date-calculation helpers for recurring task rules.
 *
 * Responsibilities:
 * - parses `[repeat:: ...]` and `[repeats:: ...]` task fields (this is the sole owner of
 *   the repeat-field extraction regex — task-line-metadata.ts imports from here rather
 *   than keeping its own copy)
 * - normalizes supported aliases to canonical repeat specs (intervals, workday intervals,
 *   weekday/month-day sets, last-day/last-workday, nth-weekday-of-month, yearly dates)
 * - resolves the `every` (due-date-anchored) vs `every!`/`after` (completion-anchored)
 *   distinction, and an optional `until`/`ending` end bound
 * - computes the next occurrence for a parsed rule
 *
 * Dependencies:
 * - ../date/date-utils (pure date string helpers)
 *
 * Side Effects:
 * - none (pure functions over strings/dates)
 */
import { getCurrentDateString, parseIsoDate } from "../date/date-utils";

export type RepeatUnit = "day" | "week" | "month" | "year";
export type RepeatWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type RepeatNth = 1 | 2 | 3 | 4 | 5 | "last";
export type RepeatAnchorMode = "due" | "completion";

export type RepeatSpec =
  | { kind: "interval"; interval: number; unit: RepeatUnit }
  | { kind: "workday-interval"; interval: number }
  | { kind: "weekday-set"; weekdays: RepeatWeekday[] }
  | { kind: "month-day-set"; daysOfMonth: number[] }
  | { kind: "last-day" }
  | { kind: "last-workday" }
  | { kind: "nth-weekday"; nth: RepeatNth; weekday: RepeatWeekday }
  | { kind: "yearly-nth-weekday"; nth: RepeatNth; weekday: RepeatWeekday; month: number }
  | { kind: "yearly-date"; month: number; day: number }; // month is 0-11

export type RepeatRule = {
  spec: RepeatSpec;
  /** "due" (plain `every`, the default) anchors the next date to the task's previous
   *  due date; "completion" (`every!`/`ev!`/`after ...`) anchors to the completion date. */
  anchor: RepeatAnchorMode;
  /** Inclusive ISO end bound (`until`/`ending YYYY-MM-DD`), or null if unbounded. */
  until: string | null;
  /** The exact captured field value (case preserved), for display/round-tripping. */
  raw: string;
};

const REPEAT_FIELD_VALUE_REGEX = /\[(?:repeat|repeats)::\s*([^\]]+?)\s*\]/i;
export const REPEAT_FIELD_PRESENT_REGEX = /\[(?:repeat|repeats)::\s*[^\]]+?\]/i;

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_MONTH_ITERATIONS = 1200; // 100 years for a monthly rule; guards against infinite loops
const MAX_SET_MONTH_ITERATIONS = 48;
const MAX_NTH_WEEKDAY_MONTH_ITERATIONS = 24;
const MAX_YEARLY_ITERATIONS = 8;

type UnitResolution = { unit: RepeatUnit; multiplier: number };

// "quarter"/"quarterly" resolves to 3 months here rather than being its own RepeatUnit,
// since "every 2 quarters" (6 months) and "other quarter" (6 months) fall out for free.
const REPEAT_KEYWORD_TO_UNIT: Record<string, UnitResolution> = {
  day: { unit: "day", multiplier: 1 },
  days: { unit: "day", multiplier: 1 },
  daily: { unit: "day", multiplier: 1 },
  week: { unit: "week", multiplier: 1 },
  weeks: { unit: "week", multiplier: 1 },
  weekly: { unit: "week", multiplier: 1 },
  month: { unit: "month", multiplier: 1 },
  months: { unit: "month", multiplier: 1 },
  monthly: { unit: "month", multiplier: 1 },
  quarter: { unit: "month", multiplier: 3 },
  quarters: { unit: "month", multiplier: 3 },
  quarterly: { unit: "month", multiplier: 3 },
  year: { unit: "year", multiplier: 1 },
  years: { unit: "year", multiplier: 1 },
  yearly: { unit: "year", multiplier: 1 },
  annual: { unit: "year", multiplier: 1 },
  annually: { unit: "year", multiplier: 1 },
};

const WEEKDAY_KEYWORD_TO_INDEX: Record<string, RepeatWeekday> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

const MONTH_NAME_TO_INDEX: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

// Absolute max day-of-month across leap years, used to validate `yearly-date` at parse
// time (e.g. reject "feb 30" but allow "feb 29" — leap-year clamping happens at compute time).
const MONTH_MAX_DAY = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Extracts the raw (trimmed, case-preserved) value of a `[repeat::]`/`[repeats::]` field, or null. */
export function getRepeatFieldValue(line: string): string | null {
  const match = line.match(REPEAT_FIELD_VALUE_REGEX);
  return match ? match[1].trim() : null;
}

export function parseRepeatRule(line: string): RepeatRule | null {
  const rawValue = getRepeatFieldValue(line);
  if (rawValue === null) {
    return null;
  }

  return parseRepeatExpression(rawValue);
}

/**
 * Computes the next occurrence for a rule, or null if the `until` bound has been passed
 * (recurrence has ended). See RepeatRule.anchor for the due-date vs completion-date
 * distinction. The result is always strictly after both the anchor date and today's date,
 * so a long-overdue recurring task never spawns an already-overdue clone.
 */
export function getNextRepeatDate(
  rule: RepeatRule,
  options: { previousDueDate: string | null; now?: Date },
): string | null {
  const now = options.now ?? new Date();
  const today = startOfDay(now);
  const dueAnchor = rule.anchor === "due" ? parseIsoDate(options.previousDueDate ?? "") : null;
  const anchor = dueAnchor ?? today;
  const floor = anchor.getTime() > today.getTime() ? anchor : today;

  const next = computeNextOccurrence(rule.spec, anchor, floor);
  if (next === null) {
    return null;
  }

  const nextString = getCurrentDateString(next);
  if (rule.until !== null && nextString > rule.until) {
    return null;
  }

  return nextString;
}

function parseRepeatExpression(rawValue: string): RepeatRule | null {
  const normalized = rawValue.trim().toLowerCase().replace(/\s+/g, " ");
  if (normalized.length === 0) {
    return null;
  }

  let rest = normalized;
  let anchor: RepeatAnchorMode = "due";
  let requireIntervalOnly = false;

  const bangEveryMatch = rest.match(/^(?:every!|ev!)\s+(.+)$/);
  const afterMatch = rest.match(/^after\s+(.+)$/);
  const plainEveryMatch = rest.match(/^(?:every|ev)\s+(.+)$/);

  if (bangEveryMatch) {
    anchor = "completion";
    rest = bangEveryMatch[1].trim();
  } else if (afterMatch) {
    anchor = "completion";
    requireIntervalOnly = true;
    rest = afterMatch[1].trim();
  } else if (plainEveryMatch) {
    anchor = "due";
    rest = plainEveryMatch[1].trim();
  } else if (/^(every!|ev!|every|ev|after)$/.test(rest)) {
    // A bare prefix with nothing following it (e.g. "[repeat:: every]") is invalid.
    return null;
  }

  if (rest.length === 0) {
    return null;
  }

  let until: string | null = null;
  const boundMatch = rest.match(/^(.*?)\s+(?:until|ending)\s+(\S+)$/);
  if (boundMatch) {
    const boundValue = boundMatch[2];
    // Bounds are ISO-only by design: the raw field round-trips onto every clone, so a
    // natural-language bound like "until aug 3" would re-resolve forward every cycle and
    // never actually terminate the recurrence.
    if (!ISO_DATE_REGEX.test(boundValue)) {
      return null;
    }
    until = boundValue;
    rest = boundMatch[1].trim();
    if (rest.length === 0) {
      return null;
    }
  }

  const spec = matchExpression(rest);
  if (spec === null) {
    return null;
  }

  if (requireIntervalOnly && spec.kind !== "interval" && spec.kind !== "workday-interval") {
    return null;
  }

  return { spec, anchor, until, raw: rawValue.trim() };
}

function matchExpression(expression: string): RepeatSpec | null {
  const hasComma = expression.includes(",");
  const tokens = expression.split(/[,\s]+/).filter((token) => token.length > 0);
  if (tokens.length === 0) {
    return null;
  }

  if (hasComma) {
    return matchSetExpression(tokens);
  }

  return (
    matchOtherInterval(tokens) ??
    matchWorkdayKeyword(tokens) ??
    matchCountedInterval(tokens) ??
    matchLastDay(tokens) ??
    matchLastWorkday(tokens) ??
    matchNthWeekdayOfMonth(tokens) ??
    matchMonthDate(tokens) ??
    matchSingleUnitKeyword(tokens) ??
    matchSingleWeekday(tokens) ??
    matchSingleOrdinalDay(tokens)
  );
}

// Sets (comma-separated) are either all weekday names ("mon, fri") or all month-days
// ("2, 15, 27") — mixing, or anything that isn't one of those two shapes, is invalid.
function matchSetExpression(tokens: string[]): RepeatSpec | null {
  if (tokens.length < 2) {
    return null;
  }

  const weekdays = tokens.map((token) => WEEKDAY_KEYWORD_TO_INDEX[token]);
  if (weekdays.every((weekday) => weekday !== undefined)) {
    const unique = Array.from(new Set(weekdays as RepeatWeekday[])).sort((a, b) => a - b);
    return { kind: "weekday-set", weekdays: unique };
  }

  const days = tokens.map((token) => parseOrdinalOrPlainDay(token));
  if (days.every((day) => day !== null)) {
    const unique = Array.from(new Set(days as number[])).sort((a, b) => a - b);
    return { kind: "month-day-set", daysOfMonth: unique };
  }

  return null;
}

function matchOtherInterval(tokens: string[]): RepeatSpec | null {
  if (tokens.length !== 2 || tokens[0] !== "other") {
    return null;
  }

  const resolution = REPEAT_KEYWORD_TO_UNIT[tokens[1]];
  if (!resolution) {
    return null;
  }

  return { kind: "interval", interval: 2 * resolution.multiplier, unit: resolution.unit };
}

function matchWorkdayKeyword(tokens: string[]): RepeatSpec | null {
  if (tokens.length !== 1) {
    return null;
  }

  if (tokens[0] === "weekday" || tokens[0] === "workday" || tokens[0] === "workdays") {
    return { kind: "workday-interval", interval: 1 };
  }

  return null;
}

function matchCountedInterval(tokens: string[]): RepeatSpec | null {
  if (tokens.length !== 2 || !/^\d+$/.test(tokens[0])) {
    return null;
  }

  const interval = Number.parseInt(tokens[0], 10);
  if (!Number.isFinite(interval) || interval < 1) {
    return null;
  }

  if (tokens[1] === "workday" || tokens[1] === "workdays") {
    return { kind: "workday-interval", interval };
  }

  const resolution = REPEAT_KEYWORD_TO_UNIT[tokens[1]];
  if (!resolution) {
    return null;
  }

  return { kind: "interval", interval: interval * resolution.multiplier, unit: resolution.unit };
}

function matchLastDay(tokens: string[]): RepeatSpec | null {
  if (tokens.length === 2 && tokens[0] === "last" && tokens[1] === "day") {
    return { kind: "last-day" };
  }
  return null;
}

function matchLastWorkday(tokens: string[]): RepeatSpec | null {
  if (tokens.length === 2 && tokens[0] === "last" && (tokens[1] === "workday" || tokens[1] === "weekday")) {
    return { kind: "last-workday" };
  }
  return null;
}

// Handles "1st wed" (nth-weekday, monthly), "3rd thu jul" and "3rd thursday of july"
// (yearly-nth-weekday). `nth` also accepts "last" (e.g. "last friday").
function matchNthWeekdayOfMonth(tokens: string[]): RepeatSpec | null {
  if (tokens.length < 2 || tokens.length > 4) {
    return null;
  }

  const nth = parseNthToken(tokens[0]);
  if (nth === null) {
    return null;
  }

  const weekday = WEEKDAY_KEYWORD_TO_INDEX[tokens[1]];
  if (weekday === undefined) {
    return null;
  }

  if (tokens.length === 2) {
    return { kind: "nth-weekday", nth, weekday };
  }

  const monthToken = tokens.length === 4 ? (tokens[2] === "of" ? tokens[3] : null) : tokens[2];
  if (monthToken === null) {
    return null;
  }

  const month = MONTH_NAME_TO_INDEX[monthToken];
  if (month === undefined) {
    return null;
  }

  return { kind: "yearly-nth-weekday", nth, weekday, month };
}

// Handles "jan 27", "27 jan", "january 27th".
function matchMonthDate(tokens: string[]): RepeatSpec | null {
  if (tokens.length !== 2) {
    return null;
  }

  let month = MONTH_NAME_TO_INDEX[tokens[0]];
  let dayToken = tokens[1];
  if (month === undefined) {
    month = MONTH_NAME_TO_INDEX[tokens[1]];
    dayToken = tokens[0];
  }
  if (month === undefined) {
    return null;
  }

  const day = parseOrdinalOrPlainDay(dayToken);
  if (day === null || day > MONTH_MAX_DAY[month]) {
    return null;
  }

  return { kind: "yearly-date", month, day };
}

function matchSingleUnitKeyword(tokens: string[]): RepeatSpec | null {
  if (tokens.length !== 1) {
    return null;
  }

  const resolution = REPEAT_KEYWORD_TO_UNIT[tokens[0]];
  return resolution ? { kind: "interval", interval: resolution.multiplier, unit: resolution.unit } : null;
}

function matchSingleWeekday(tokens: string[]): RepeatSpec | null {
  if (tokens.length !== 1) {
    return null;
  }

  const weekday = WEEKDAY_KEYWORD_TO_INDEX[tokens[0]];
  return weekday !== undefined ? { kind: "weekday-set", weekdays: [weekday] } : null;
}

function matchSingleOrdinalDay(tokens: string[]): RepeatSpec | null {
  if (tokens.length !== 1) {
    return null;
  }

  const day = parseOrdinalDay(tokens[0]);
  return day !== null ? { kind: "month-day-set", daysOfMonth: [day] } : null;
}

function parseNthToken(token: string): RepeatNth | null {
  if (token === "last") {
    return "last";
  }

  const match = token.match(/^([1-5])(st|nd|rd|th)$/);
  return match ? (Number.parseInt(match[1], 10) as RepeatNth) : null;
}

/** Strict ordinal day (requires the st/nd/rd/th suffix), used for the single-token `5th` form. */
function parseOrdinalDay(token: string): number | null {
  const match = token.match(/^([1-9]|[12][0-9]|3[01])(st|nd|rd|th)$/);
  return match ? Number.parseInt(match[1], 10) : null;
}

/** Accepts both ordinal ("27th") and plain ("27") forms — used by sets and yearly dates. */
function parseOrdinalOrPlainDay(token: string): number | null {
  const ordinal = parseOrdinalDay(token);
  if (ordinal !== null) {
    return ordinal;
  }
  return /^([1-9]|[12][0-9]|3[01])$/.test(token) ? Number.parseInt(token, 10) : null;
}

function computeNextOccurrence(spec: RepeatSpec, anchor: Date, floor: Date): Date | null {
  switch (spec.kind) {
    case "interval":
      if (spec.unit === "day") {
        return nextByDayStep(anchor, floor, spec.interval);
      }
      if (spec.unit === "week") {
        return nextByDayStep(anchor, floor, spec.interval * 7);
      }
      if (spec.unit === "month") {
        return nextByMonthStep(anchor, floor, spec.interval);
      }
      return nextByMonthStep(anchor, floor, spec.interval * 12);
    case "workday-interval":
      return nextWorkdayStep(floor, spec.interval);
    case "weekday-set":
      return nextInWeekdaySet(floor, spec.weekdays);
    case "month-day-set":
      return nextInMonthDaySet(floor, spec.daysOfMonth);
    case "last-day":
      return nextLastDay(floor);
    case "last-workday":
      return nextLastWorkday(floor);
    case "nth-weekday":
      return nextNthWeekdayMonthly(floor, spec.nth, spec.weekday);
    case "yearly-nth-weekday":
      return nextYearlyNthWeekday(floor, spec.nth, spec.weekday, spec.month);
    case "yearly-date":
      return nextYearlyDate(floor, spec.month, spec.day);
  }
}

// Closed-form: smallest k >= 1 such that anchor + k*stepDays is strictly after floor.
// floor is always >= anchor (see getNextRepeatDate), so diffDays is always >= 0.
function nextByDayStep(anchor: Date, floor: Date, stepDays: number): Date {
  const diffDays = Math.round((floor.getTime() - anchor.getTime()) / DAY_MS);
  const k = Math.floor(diffDays / stepDays) + 1;
  return addDays(anchor, k * stepDays);
}

// Iterates from the anchor rather than chaining from the previous computed date, so a
// long-overdue monthly/yearly rule catches up directly (e.g. Jan 31 overdue 3 months ->
// Apr 30, not Apr 28) instead of accumulating clamping drift across intermediate steps.
function nextByMonthStep(anchor: Date, floor: Date, stepMonths: number): Date | null {
  for (let k = 1; k <= MAX_MONTH_ITERATIONS; k += 1) {
    const candidate = addMonthsClamped(anchor, k * stepMonths);
    if (candidate.getTime() > floor.getTime()) {
      return candidate;
    }
  }
  return null;
}

function nextWorkdayStep(floor: Date, count: number): Date {
  let current = floor;
  let remaining = count;
  while (remaining > 0) {
    current = addDays(current, 1);
    if (isWeekday(current)) {
      remaining -= 1;
    }
  }
  return current;
}

function nextInWeekdaySet(floor: Date, weekdays: RepeatWeekday[]): Date | null {
  for (let offset = 1; offset <= 7; offset += 1) {
    const candidate = addDays(floor, offset);
    if (weekdays.includes(candidate.getDay() as RepeatWeekday)) {
      return candidate;
    }
  }
  return null;
}

function nextInMonthDaySet(floor: Date, daysOfMonth: number[]): Date | null {
  let year = floor.getFullYear();
  let month = floor.getMonth();

  for (let i = 0; i < MAX_SET_MONTH_ITERATIONS; i += 1) {
    const candidates = daysOfMonth
      .map((day) => clampedMonthDate(year, month, day))
      .filter((candidate) => candidate.getTime() > floor.getTime())
      .sort((a, b) => a.getTime() - b.getTime());
    if (candidates.length > 0) {
      return candidates[0];
    }

    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return null;
}

function nextLastDay(floor: Date): Date {
  const candidate = lastDayOfMonth(floor.getFullYear(), floor.getMonth());
  if (candidate.getTime() > floor.getTime()) {
    return candidate;
  }
  const nextMonth = addMonthsClamped(new Date(floor.getFullYear(), floor.getMonth(), 1), 1);
  return lastDayOfMonth(nextMonth.getFullYear(), nextMonth.getMonth());
}

function nextLastWorkday(floor: Date): Date {
  const candidate = lastWorkdayOfMonth(floor.getFullYear(), floor.getMonth());
  if (candidate.getTime() > floor.getTime()) {
    return candidate;
  }
  const nextMonth = addMonthsClamped(new Date(floor.getFullYear(), floor.getMonth(), 1), 1);
  return lastWorkdayOfMonth(nextMonth.getFullYear(), nextMonth.getMonth());
}

function nextNthWeekdayMonthly(floor: Date, nth: RepeatNth, weekday: RepeatWeekday): Date | null {
  let year = floor.getFullYear();
  let month = floor.getMonth();

  for (let i = 0; i < MAX_NTH_WEEKDAY_MONTH_ITERATIONS; i += 1) {
    const candidate = nthWeekdayOfMonth(year, month, nth, weekday);
    if (candidate !== null && candidate.getTime() > floor.getTime()) {
      return candidate;
    }
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return null;
}

function nextYearlyNthWeekday(floor: Date, nth: RepeatNth, weekday: RepeatWeekday, month: number): Date | null {
  let year = floor.getFullYear();

  for (let i = 0; i < MAX_YEARLY_ITERATIONS; i += 1) {
    const candidate = nthWeekdayOfMonth(year, month, nth, weekday);
    if (candidate !== null && candidate.getTime() > floor.getTime()) {
      return candidate;
    }
    year += 1;
  }
  return null;
}

function nextYearlyDate(floor: Date, month: number, day: number): Date | null {
  let year = floor.getFullYear();

  for (let i = 0; i < MAX_YEARLY_ITERATIONS; i += 1) {
    const candidate = clampedMonthDate(year, month, day);
    if (candidate.getTime() > floor.getTime()) {
      return candidate;
    }
    year += 1;
  }
  return null;
}

/** The nth (1-5, or "last") occurrence of `weekday` in `year`/`month`, or null if that
 * month doesn't have an nth occurrence (e.g. no 5th Monday). */
function nthWeekdayOfMonth(year: number, month: number, nth: RepeatNth, weekday: RepeatWeekday): Date | null {
  if (nth === "last") {
    let date = lastDayOfMonth(year, month);
    while (date.getDay() !== weekday) {
      date = addDays(date, -1);
    }
    return date;
  }

  const first = new Date(year, month, 1);
  const firstWeekdayOffset = (weekday - first.getDay() + 7) % 7;
  const day = 1 + firstWeekdayOffset + (nth - 1) * 7;
  const lastDay = lastDayOfMonth(year, month).getDate();
  return day <= lastDay ? new Date(year, month, day) : null;
}

function lastWorkdayOfMonth(year: number, month: number): Date {
  let date = lastDayOfMonth(year, month);
  while (!isWeekday(date)) {
    date = addDays(date, -1);
  }
  return date;
}

function lastDayOfMonth(year: number, month: number): Date {
  return new Date(year, month + 1, 0);
}

function clampedMonthDate(year: number, month: number, day: number): Date {
  const lastDay = lastDayOfMonth(year, month).getDate();
  return new Date(year, month, Math.min(day, lastDay));
}

function isWeekday(date: Date): boolean {
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(baseDate: Date, days: number): Date {
  const nextDate = new Date(baseDate);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function addMonthsClamped(baseDate: Date, monthsToAdd: number): Date {
  const startYear = baseDate.getFullYear();
  const startMonth = baseDate.getMonth();
  const targetMonthIndex = startMonth + monthsToAdd;
  const targetYear = startYear + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const day = baseDate.getDate();
  const lastDayOfTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  const clampedDay = Math.min(day, lastDayOfTargetMonth);

  return new Date(targetYear, targetMonth, clampedDay);
}
