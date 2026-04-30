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
 * - none outside language/runtime primitives
 *
 * Side Effects:
 * - none (pure parsing helpers)
 */
const TASK_LINE_REGEX = /^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$/;
const REPEAT_FIELD_REGEX = /\[(?:repeat|repeats)::\s*[^\]]+?\]/i;
const INLINE_FIELD_REGEX = /\s*\[[^\]]+::\s*[^\]]*\]/g;
const TAG_REGEX = /(^|\s)#[^\s#]+/g;
const MULTISPACE_REGEX = /\s+/g;

export type ParsedTaskLine = {
  status: "open" | "completed";
  taskBody: string;
};

export function parseTaskLine(line: string): ParsedTaskLine | null {
  const match = line.match(TASK_LINE_REGEX);
  if (!match) {
    return null;
  }

  return {
    status: match[1].trim().toLowerCase() === "x" ? "completed" : "open",
    taskBody: match[2].trim(),
  };
}

export function isRecurringTask(taskBody: string): boolean {
  return REPEAT_FIELD_REGEX.test(taskBody);
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
