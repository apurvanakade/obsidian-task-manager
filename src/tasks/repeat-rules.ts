/**
 * Purpose:
 * - provide pure parsing and date-calculation helpers for recurring task rules.
 *
 * Responsibilities:
 * - parses `[repeat::  ...]` and `[repeats::  ...]` task fields
 * - normalizes supported aliases to canonical repeat units or calendar targets
 * - computes the next due date for a recurring task rule
 *
 * Dependencies:
 * - none outside language/runtime primitives
 *
 * Side Effects:
 * - none (pure functions over strings/dates)
 */
export type RepeatUnit = "day" | "week" | "month" | "year";
export type RepeatWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type RepeatRule =
  | {
      kind: "interval";
      interval: number;
      unit: RepeatUnit;
    }
  | {
      kind: "weekday";
      weekday: RepeatWeekday;
    }
  | {
      kind: "month-day";
      dayOfMonth: number;
    };

const REPEAT_FIELD_REGEX = /\[(?:repeat|repeats)::\s*(?:every\s+)?([^\]]+?)\s*\]/i;
const COUNT_AND_KEYWORD_REGEX = /^(\d+)\s+([a-z-]+)$/i;
const KEYWORD_ONLY_REGEX = /^([a-z-]+)$/i;

const REPEAT_KEYWORD_TO_UNIT: Record<string, RepeatUnit> = {
  day: "day",
  days: "day",
  daily: "day",
  week: "week",
  weeks: "week",
  weekly: "week",
  month: "month",
  months: "month",
  monthly: "month",
  year: "year",
  years: "year",
  yearly: "year",
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

export function parseRepeatRule(line: string): RepeatRule | null {
  const fieldMatch = line.match(REPEAT_FIELD_REGEX);
  if (!fieldMatch) {
    return null;
  }

  return parseRepeatExpression(fieldMatch[1]);
}

export function getRepeatDueDate(rule: RepeatRule, baseDate: Date = new Date()): string {
  switch (rule.kind) {
    case "interval":
      switch (rule.unit) {
        case "day":
          return formatDate(addDays(baseDate, rule.interval));
        case "week":
          return formatDate(addDays(baseDate, rule.interval * 7));
        case "month":
          return formatDate(addMonthsClamped(baseDate, rule.interval));
        case "year":
          return formatDate(addMonthsClamped(baseDate, rule.interval * 12));
      }
    case "weekday":
      return formatDate(getNextWeekday(baseDate, rule.weekday));
    case "month-day":
      return formatDate(getNextMonthDay(baseDate, rule.dayOfMonth));
  }
}

function parseRepeatExpression(expression: string): RepeatRule | null {
  const normalized = expression.trim().toLowerCase();

  const countedMatch = normalized.match(COUNT_AND_KEYWORD_REGEX);
  if (countedMatch) {
    const interval = Number.parseInt(countedMatch[1], 10);
    const unit = REPEAT_KEYWORD_TO_UNIT[countedMatch[2]];
    if (!Number.isFinite(interval) || interval < 1 || !unit) {
      return null;
    }

    return { kind: "interval", interval, unit };
  }

  const keywordMatch = normalized.match(KEYWORD_ONLY_REGEX);
  if (keywordMatch) {
    const intervalUnit = REPEAT_KEYWORD_TO_UNIT[keywordMatch[1]];
    if (intervalUnit) {
      return { kind: "interval", interval: 1, unit: intervalUnit };
    }

    const weekday = WEEKDAY_KEYWORD_TO_INDEX[keywordMatch[1]];
    if (weekday !== undefined) {
      return { kind: "weekday", weekday };
    }

    const ordinalDay = parseOrdinalDay(keywordMatch[1]);
    if (ordinalDay !== null) {
      return { kind: "month-day", dayOfMonth: ordinalDay };
    }
  }
  return null;
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

function getNextWeekday(baseDate: Date, weekday: RepeatWeekday): Date {
  const currentWeekday = baseDate.getDay();
  const delta = (weekday - currentWeekday + 7) % 7 || 7;
  return addDays(baseDate, delta);
}

function getNextMonthDay(baseDate: Date, dayOfMonth: number): Date {
  const currentDay = baseDate.getDate();
  if (currentDay < dayOfMonth) {
    return buildMonthDayDate(baseDate.getFullYear(), baseDate.getMonth(), dayOfMonth);
  }

  const nextMonth = addMonthsClamped(new Date(baseDate.getFullYear(), baseDate.getMonth(), 1), 1);
  return buildMonthDayDate(nextMonth.getFullYear(), nextMonth.getMonth(), dayOfMonth);
}

function buildMonthDayDate(year: number, month: number, dayOfMonth: number): Date {
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(dayOfMonth, lastDayOfMonth));
}

function parseOrdinalDay(value: string): number | null {
  const match = value.match(/^([1-9]|[12][0-9]|3[01])(st|nd|rd|th)$/);
  if (!match) {
    return null;
  }

  const day = Number.parseInt(match[1], 10);
  return Number.isFinite(day) ? day : null;
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
