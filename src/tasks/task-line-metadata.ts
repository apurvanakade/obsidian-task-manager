/**
 * Purpose:
 * - centralize shared parsing helpers for markdown task-line metadata.
 *
 * Responsibilities:
 * - parse markdown checkbox task lines into open/completed states
 * - read inline field values from task bodies
 * - detect recurring fields
 * - normalize task text for dashboard/summary display
 *
 * Dependencies:
 * - ./repeat-rules (repeat-field extraction — repeat-rules.ts is the sole owner of that
 *   grammar/regex; both modules are pure so this stays a one-way, acyclic dependency)
 *
 * Side Effects:
 * - none (pure parsing helpers)
 */
import { getRepeatFieldValue, REPEAT_FIELD_PRESENT_REGEX } from "./repeat-rules";

// Canonical task-line grammar. This is the single source of truth for what counts as a
// checkbox task line across the plugin (extraction, first-incomplete lookup, reset,
// reconciliation, and repeat-task rebuilding all derive from this one parser).
const TASK_LINE_STRUCTURE_REGEX = /^(\s*[-*+]\s+\[)( |x|X)(\]\s+)(.*)$/;
const INLINE_FIELD_REGEX = /\s*\[[^\]]+::\s*[^\]]*\]/g;
const TAG_REGEX = /(^|\s)#[^\s#]+/g;
const MULTISPACE_REGEX = /\s+/g;

export type ParsedTaskLine = {
  status: "open" | "completed";
  taskBody: string;
};

export type TaskLineStructure = {
  /** Everything from the start of the line through the opening "[" of the checkbox. */
  prefix: string;
  checkboxChar: string;
  /** The closing "]" plus the whitespace separating it from the task body. */
  bracketSuffix: string;
  body: string;
  status: "open" | "completed";
};

export function parseTaskLineStructured(line: string): TaskLineStructure | null {
  const match = line.match(TASK_LINE_STRUCTURE_REGEX);
  if (!match) {
    return null;
  }

  const checkboxChar = match[2];
  return {
    prefix: match[1],
    checkboxChar,
    bracketSuffix: match[3],
    body: match[4],
    status: checkboxChar.toLowerCase() === "x" ? "completed" : "open",
  };
}

export function parseTaskLine(line: string): ParsedTaskLine | null {
  const structured = parseTaskLineStructured(line);
  if (!structured) {
    return null;
  }

  return {
    status: structured.status,
    taskBody: structured.body.trim(),
  };
}

export function isRecurringTask(taskBody: string): boolean {
  return REPEAT_FIELD_PRESENT_REGEX.test(taskBody);
}

/** Raw (unstripped) repeat-field value for display — e.g. "every 2 weeks" or "5th". */
export function getRecurrenceLabel(taskBody: string): string {
  return getRepeatFieldValue(taskBody) ?? "none";
}

export function readInlineFieldValue(taskBody: string, fieldRegex: RegExp): string | null {
  const match = taskBody.match(fieldRegex);
  return match ? match[1].trim() : null;
}

export function cleanTaskText(taskBody: string): string {
  return taskBody
    .replace(INLINE_FIELD_REGEX, "")
    .replace(TAG_REGEX, "$1")
    .replace(MULTISPACE_REGEX, " ")
    .trim();
}
