/**
 * Purpose:
 * - table-driven tests for the pure repeat-rule parser and date math.
 *
 * Run with `npm test` (tsx). No test framework — plain node:assert/strict, since this is
 * the only test file in the repo and the pure functions under test have no Obsidian
 * dependency.
 */
import { strict as assert } from "node:assert";
import { getNextRepeatDate, parseRepeatRule, RepeatRule } from "../src/tasks/repeat-rules";

let passed = 0;
let failed = 0;

function toLine(repeatValue: string): string {
  return `- [ ] x [repeat:: ${repeatValue}]`;
}

function checkParses(label: string, repeatValue: string): RepeatRule {
  const rule = parseRepeatRule(toLine(repeatValue));
  try {
    assert.notEqual(rule, null, `expected "${repeatValue}" to parse`);
    passed += 1;
  } catch (error) {
    failed += 1;
    console.error(`FAIL [${label}]:`, (error as Error).message);
  }
  return rule as RepeatRule;
}

function checkRejects(label: string, repeatValue: string): void {
  const rule = parseRepeatRule(toLine(repeatValue));
  try {
    assert.equal(rule, null, `expected "${repeatValue}" to be rejected, got ${JSON.stringify(rule)}`);
    passed += 1;
  } catch (error) {
    failed += 1;
    console.error(`FAIL [${label}]:`, (error as Error).message);
  }
}

function checkNextDate(
  label: string,
  rule: RepeatRule,
  options: { previousDueDate: string | null; now: string },
  expected: string | null,
): void {
  const actual = getNextRepeatDate(rule, {
    previousDueDate: options.previousDueDate,
    now: new Date(`${options.now}T00:00:00`),
  });
  try {
    assert.equal(actual, expected, `expected next date "${expected}", got "${actual}"`);
    passed += 1;
  } catch (error) {
    failed += 1;
    console.error(`FAIL [${label}]:`, (error as Error).message);
  }
}

// --- Parse table -----------------------------------------------------------------------

// Legacy forms, still supported.
checkParses("legacy daily", "daily");
checkParses("legacy week", "week");
checkParses("legacy 2 weeks", "2 weeks");
checkParses("legacy Monday", "Monday");
checkParses("legacy 5th (bug fix)", "5th");

// Prefixes.
checkParses("ev shorthand", "ev fri");
checkParses("every! completion anchor", "every! 3 days");
checkParses("ev! shorthand completion anchor", "ev! week");
checkParses("after N days", "after 3 days");
checkRejects("after non-interval", "after mon, fri");
checkRejects("bare every", "every");
checkRejects("bare every!", "every!");
checkRejects("bare ev", "ev");
checkRejects("bare after", "after");

// Interval variants.
checkParses("other month", "other month");
checkParses("other week", "other week");
checkParses("quarterly", "quarterly");
checkParses("2 quarters", "2 quarters");
checkParses("weekday keyword", "weekday");
checkParses("workday keyword", "workday");
checkParses("3 workdays", "3 workdays");

// Sets.
checkParses("weekday set", "mon, wed, fri");
checkParses("month-day set", "2, 15, 27");
checkRejects("mixed set", "2, weeks");
checkRejects("bare number", "5");

// Last day / last workday.
checkParses("last day", "last day");
checkParses("last workday", "last workday");

// Nth weekday.
checkParses("nth weekday", "1st wed");
checkParses("last weekday of month", "last friday");
checkParses("yearly nth weekday short", "3rd thu jul");
checkParses("yearly nth weekday long", "3rd thursday of july");
checkRejects("nth weekday garbage", "1st bananas");

// Yearly dates.
checkParses("month day", "jan 27");
checkParses("day month", "27 jan");
checkParses("month day ordinal", "january 27th");
checkParses("leap day", "feb 29");
checkRejects("invalid month day", "feb 30");

// Bounds.
checkParses("until iso bound", "daily until 2026-12-31");
checkParses("ending iso bound", "mon ending 2026-09-01");
checkRejects("natural language bound", "daily until aug 3");

// --- Date computation table -------------------------------------------------------------

const dailyDueAnchored = checkParses("setup: daily due-anchored", "daily");
checkNextDate(
  "on-time completion, due-anchored daily",
  dailyDueAnchored,
  { previousDueDate: "2026-08-03", now: "2026-08-03" },
  "2026-08-04",
);
checkNextDate(
  "overdue completion never yields a past date",
  dailyDueAnchored,
  { previousDueDate: "2026-07-01", now: "2026-08-03" },
  "2026-08-04",
);

const every3DaysCompletion = checkParses("setup: every! 3 days", "every! 3 days");
checkNextDate(
  "completion-anchored ignores previous due",
  every3DaysCompletion,
  { previousDueDate: "2026-01-01", now: "2026-08-03" },
  "2026-08-06",
);

const weeklyDueAnchored = checkParses("setup: weekly due-anchored", "week");
checkNextDate(
  "early completion preserves cadence",
  weeklyDueAnchored,
  { previousDueDate: "2026-08-10", now: "2026-08-05" },
  "2026-08-17",
);

const monthlyDueAnchored = checkParses("setup: monthly due-anchored", "month");
checkNextDate(
  "Jan 31 monthly clamp, single step",
  monthlyDueAnchored,
  { previousDueDate: "2026-01-31", now: "2026-02-01" },
  "2026-02-28",
);
checkNextDate(
  "Jan 31 monthly clamp, multi-step catch-up computed from anchor",
  monthlyDueAnchored,
  { previousDueDate: "2026-01-31", now: "2026-04-15" },
  "2026-04-30",
);

const noPreviousDue = checkParses("setup: daily no previous due", "daily");
checkNextDate(
  "missing previous due falls back to today",
  noPreviousDue,
  { previousDueDate: null, now: "2026-08-03" },
  "2026-08-04",
);

const weekdaySet = checkParses("setup: mon,fri set", "mon, fri");
checkNextDate(
  "weekday set wraparound",
  weekdaySet,
  { previousDueDate: null, now: "2026-08-05" }, // Wednesday
  "2026-08-07", // Friday
);

const fifthWeekday = checkParses("setup: 5th monday", "5th mon");
checkNextDate(
  "nth-weekday skips months with no 5th occurrence",
  fifthWeekday,
  // September and October 2026 each have only 4 Mondays; the next 5th Monday is Nov 30.
  { previousDueDate: null, now: "2026-09-01" },
  "2026-11-30",
);

const leapYearly = checkParses("setup: feb 29 yearly", "feb 29");
checkNextDate(
  "yearly date clamps to Feb 28 in the next (non-leap) year rather than waiting for a leap year",
  leapYearly,
  { previousDueDate: null, now: "2026-08-03" },
  "2027-02-28",
);

const untilBound = checkParses("setup: daily until bound", "daily until 2026-08-05");
checkNextDate(
  "until bound inclusive: next date equals bound",
  untilBound,
  { previousDueDate: "2026-08-04", now: "2026-08-04" },
  "2026-08-05",
);
checkNextDate(
  "until bound exceeded: no clone",
  untilBound,
  { previousDueDate: "2026-08-05", now: "2026-08-05" },
  null,
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
