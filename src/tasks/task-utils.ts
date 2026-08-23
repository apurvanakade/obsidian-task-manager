/**
 * Purpose:
 * - provide pure helpers for parsing and transforming markdown task lines.
 *
 * Responsibilities:
 * - parses markdown task line status and line positions
 * - computes state transitions between previous/current snapshots
 * - finds the first incomplete task in a file
 * - resets task metadata fields for the Reset Tasks command
 *
 * Dependencies:
 * - none outside language/runtime primitives
 *
 * Side Effects:
 * - none (pure functions over strings/arrays)
 */
import { cleanTaskText, parseTaskLine, parseTaskLineStructured, readInlineFieldValue } from "./task-line-metadata";

const FRONTMATTER_BLOCK_REGEX = /^---\r?\n[\s\S]*?\r?\n---/;
export const DUE_FIELD_REGEX = /\[due::\s*([^\]]+?)\s*\]/i;

export type TaskState = {
  line: number;
  status: "open" | "completed";
};

type ResetTaskContentResult = {
  content: string;
  taskCount: number;
  changed: boolean;
};

export function extractTaskState(content: string): TaskState[] {
  const lines = content.split(/\r?\n/);
  const taskState: TaskState[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const structured = parseTaskLineStructured(lines[index]);
    if (!structured) {
      continue;
    }

    taskState.push({
      line: index,
      status: structured.status,
    });
  }

  return taskState;
}

export function findNewlyCompletedTask(previousState: TaskState[], nextState: TaskState[]): number | null {
  const previousByLine = new Map(previousState.map((task) => [task.line, task.status]));

  for (const task of nextState) {
    const wasStatus = previousByLine.get(task.line);
    if (wasStatus === "open" && task.status === "completed") {
      return task.line;
    }
  }

  return null;
}

export function findNewlyUncompletedTask(previousState: TaskState[], nextState: TaskState[]): number | null {
  const previousByLine = new Map(previousState.map((task) => [task.line, task.status]));

  for (const task of nextState) {
    const wasStatus = previousByLine.get(task.line);
    if (wasStatus === "completed" && task.status === "open") {
      return task.line;
    }
  }

  return null;
}

export function findFirstIncompleteTaskLine(lines: string[]): number | null {
  for (let index = 0; index < lines.length; index += 1) {
    const structured = parseTaskLineStructured(lines[index]);
    if (structured && structured.status === "open") {
      return index;
    }
  }

  return null;
}

/**
 * Reads the `[due:: ...]` value off a file's first incomplete task line, if any. Used
 * to derive a Scheduled project's promotion date from its first task's due date instead
 * of a separate frontmatter field, so there's a single source of truth for "when."
 */
export function getFirstTaskDueDate(content: string): string | null {
  const lines = content.split(/\r?\n/);
  const firstIncompleteIndex = findFirstIncompleteTaskLine(lines);
  if (firstIncompleteIndex === null) {
    return null;
  }

  const parsed = parseTaskLine(lines[firstIncompleteIndex]);
  if (!parsed) {
    return null;
  }

  return readInlineFieldValue(parsed.taskBody, DUE_FIELD_REGEX);
}

export const COMPLETED_SECTION_HEADER = "## Completed Tasks";
const LEADING_WHITESPACE_REGEX = /^\s*/;
const HEADING_REGEX = /^#{1,6}\s/;

/**
 * Finds the exclusive end index of the trailing "note block" attached to the task at
 * taskLineIndex: a run of lines indented deeper than the task line itself, that are not
 * themselves checkbox lines or headings. Blank lines are allowed *within* the block (so
 * multi-paragraph notes survive), but trailing blank lines are trimmed from the boundary.
 * Returns taskLineIndex + 1 when there is no note block, matching prior single-line behavior.
 */
export function findNoteBlockEnd(lines: string[], taskLineIndex: number): number {
  const taskIndent = getLeadingWhitespaceLength(lines[taskLineIndex] ?? "");
  let end = taskLineIndex + 1;
  let cursor = taskLineIndex + 1;

  while (cursor < lines.length) {
    const line = lines[cursor];

    if (line.trim() === "") {
      cursor += 1;
      continue;
    }

    if (HEADING_REGEX.test(line) || parseTaskLineStructured(line) !== null) {
      break;
    }

    if (getLeadingWhitespaceLength(line) <= taskIndent) {
      break;
    }

    cursor += 1;
    end = cursor;
  }

  return end;
}

function getLeadingWhitespaceLength(line: string): number {
  return line.match(LEADING_WHITESPACE_REGEX)?.[0].length ?? 0;
}

/**
 * Removes the task at taskLineIndex, along with its trailing note block (see
 * findNoteBlockEnd), from its current position and appends the whole block to the
 * "## Completed Tasks" section. Creates the section at end of file if absent.
 * No-ops if the task is already inside that section.
 */
export function moveTaskToCompletedSection(lines: string[], taskLineIndex: number): string[] {
  if (isLineInCompletedSection(lines, taskLineIndex)) {
    return lines;
  }

  const blockEnd = findNoteBlockEnd(lines, taskLineIndex);
  const taskBlock = lines.slice(taskLineIndex, blockEnd);
  const result = [...lines];
  result.splice(taskLineIndex, taskBlock.length);

  const sectionIdx = result.findIndex((l) => l.trim() === COMPLETED_SECTION_HEADER);

  if (sectionIdx !== -1) {
    // Insert after the last non-blank line in the section (before next header or EOF).
    let insertAt = sectionIdx + 1;
    for (let i = sectionIdx + 1; i < result.length; i++) {
      if (/^#{1,2}\s/.test(result[i])) break;
      if (result[i].trim() !== "") insertAt = i + 1;
    }
    result.splice(insertAt, 0, ...taskBlock);
  } else {
    if (result.length > 0 && result[result.length - 1].trim() !== "") {
      result.push("");
    }
    result.push(COMPLETED_SECTION_HEADER);
    result.push(...taskBlock);
  }

  return result;
}

function isLineInCompletedSection(lines: string[], lineIndex: number): boolean {
  let inSection = false;
  for (let i = 0; i < lineIndex; i++) {
    if (lines[i].trim() === COMPLETED_SECTION_HEADER) {
      inSection = true;
    } else if (inSection && /^#{1,2}\s/.test(lines[i])) {
      inSection = false;
    }
  }
  return inSection;
}

export function resetTaskContent(content: string): ResetTaskContentResult {
  const lines = content.split(/\r?\n/);
  let changed = false;
  let taskCount = 0;

  const nextLines = lines.map((line) => {
    const structured = parseTaskLineStructured(line);
    if (!structured) {
      return line;
    }

    taskCount += 1;
    const openPrefix = `${structured.prefix} ${structured.bracketSuffix}`;
    const cleanedBody = stripResetTaskFields(structured.body);
    const nextLine = `${openPrefix}${cleanedBody}`.trimEnd();
    if (nextLine !== line) {
      changed = true;
    }

    return nextLine;
  });

  return {
    content: nextLines.join("\n"),
    taskCount,
    changed,
  };
}

/**
 * Finds a task line in freshly-read content, given the line index it sat at when it was
 * captured plus its text at that moment.
 *
 * The captured index is only a hint. The Due Date Modal, in particular, is opened without
 * being awaited, so the rest of the modify pass keeps running while it sits open —
 * stampDerivedFrontmatter() alone adds or deletes next-due/next-action frontmatter lines
 * (and the waiting-since/priority stamps can too), which shifts every task line's index.
 * The line sitting at the captured index by the time the modal submits may therefore be a
 * *different* open task, which is how a due date used to land on the wrong one. Match on
 * identity first; use the index only to disambiguate between identical candidates.
 */
export function locateTaskLine(lines: string[], capturedIndex: number, taskLine: string): number | null {
  const exactIndex = findNearestIndex(lines, capturedIndex, (line) => line === taskLine);
  if (exactIndex !== null) {
    return exactIndex;
  }

  // The line's inline fields may have been rewritten since it was captured (e.g. a
  // reconcile pass stripping completion metadata, or a due date written by something
  // else), so fall back to matching its field-stripped text — still identity, just a
  // looser form of it. Completed lines are excluded: if the task was checked off in the
  // meantime, it is no longer the line the caller meant.
  const targetText = getComparableTaskText(taskLine);
  if (targetText.length === 0) {
    return null;
  }

  return findNearestIndex(lines, capturedIndex, (line) => {
    const parsed = parseTaskLineStructured(line);
    return parsed?.status === "open" && cleanTaskText(parsed.body) === targetText;
  });
}

/** Index of the match closest to `anchor`, so duplicate task lines resolve predictably. */
function findNearestIndex(
  lines: string[],
  anchor: number,
  predicate: (line: string) => boolean,
): number | null {
  let bestIndex: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  lines.forEach((line, index) => {
    if (!predicate(line)) {
      return;
    }

    const distance = Math.abs(index - anchor);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  });

  return bestIndex;
}

/** A task line's text with inline fields and tags stripped, for identity comparison. */
function getComparableTaskText(line: string): string {
  const structured = parseTaskLineStructured(line);
  return structured === null ? "" : cleanTaskText(structured.body);
}

/**
 * Normalizes content for merge-dedup comparison: strips the frontmatter block
 * (which often differs trivially, e.g. creation timestamps) and collapses whitespace,
 * so trivial formatting differences don't defeat containment checks.
 */
export function normalizeForComparison(content: string): string {
  return content
    .replace(FRONTMATTER_BLOCK_REGEX, "")
    .trim()
    .replace(/\s+/g, " ");
}

function stripResetTaskFields(taskBody: string): string {
  return taskBody
    .replace(/\s*\[(?:due|completion-date|completion-time|created)::\s*[^\]]*\]/gi, "")
    .replace(/\s{2,}/g, " ")
    .trimEnd();
}
