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
import { parseTaskLineStructured } from "./task-line-metadata";

const FRONTMATTER_BLOCK_REGEX = /^---\r?\n[\s\S]*?\r?\n---/;

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

const COMPLETED_SECTION_HEADER = "## Completed Tasks";

/**
 * Removes the task at taskLineIndex from its current position and appends it
 * to the "## Completed Tasks" section. Creates the section at end of file if absent.
 * No-ops if the task is already inside that section.
 */
export function moveTaskToCompletedSection(lines: string[], taskLineIndex: number): string[] {
  if (isLineInCompletedSection(lines, taskLineIndex)) {
    return lines;
  }

  const taskLine = lines[taskLineIndex];
  const result = [...lines];
  result.splice(taskLineIndex, 1);

  const sectionIdx = result.findIndex((l) => l.trim() === COMPLETED_SECTION_HEADER);

  if (sectionIdx !== -1) {
    // Insert after the last non-blank line in the section (before next header or EOF).
    let insertAt = sectionIdx + 1;
    for (let i = sectionIdx + 1; i < result.length; i++) {
      if (/^#{1,2}\s/.test(result[i])) break;
      if (result[i].trim() !== "") insertAt = i + 1;
    }
    result.splice(insertAt, 0, taskLine);
  } else {
    if (result.length > 0 && result[result.length - 1].trim() !== "") {
      result.push("");
    }
    result.push(COMPLETED_SECTION_HEADER);
    result.push(taskLine);
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
