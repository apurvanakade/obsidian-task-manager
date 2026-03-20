/**
 * Purpose:
 * - provide pure helpers for parsing and transforming markdown task lines.
 *
 * Responsibilities:
 * - parses markdown task line status and next-action tag presence
 * - computes state transitions between previous/current snapshots
 * - finds reassignment targets for next-action movement
 * - adds/removes next-action tags in an idempotent way
 *
 * Dependencies:
 * - none outside language/runtime primitives
 *
 * Side Effects:
 * - none (pure functions over strings/arrays)
 */
const TASK_LINE_REGEX = /^(\s*[-*+]\s+\[( |x|X)\]\s+)(.*)$/;

export type TaskState = {
  line: number;
  status: "open" | "completed";
  hasNextAction: boolean;
};

type ResetTaskContentResult = {
  content: string;
  taskCount: number;
  changed: boolean;
};

export function extractTaskState(content: string, nextActionTag: string): TaskState[] {
  const lines = content.split(/\r?\n/);
  const taskState: TaskState[] = [];

  function getTaskStatus(checkboxChar: string): "open" | "completed" {
    const char = checkboxChar.toLowerCase();
    if (char === "x") return "completed";
    return "open";
  }

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(TASK_LINE_REGEX);
    if (!match) {
      continue;
    }

    taskState.push({
      line: index,
      status: getTaskStatus(match[2]),
      hasNextAction: lineHasTag(lines[index], nextActionTag)
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

export function findDeletedTaggedTask(previousState: TaskState[], nextState: TaskState[]): number | null {
  // This catches the case where the tagged task was removed and no replacement tag exists yet.
  const previousTaggedTask = previousState.find((task) => task.hasNextAction);
  if (!previousTaggedTask) {
    return null;
  }

  const hasCurrentTaggedTask = nextState.some((task) => task.hasNextAction);
  if (hasCurrentTaggedTask) {
    return null;
  }

  const sameLineStillExists = nextState.some((task) => task.line === previousTaggedTask.line);
  if (sameLineStillExists) {
    return null;
  }

  return previousTaggedTask.line;
}

export function findPreviousIncompleteTaskLine(lines: string[], referenceLine: number): number | null {
  for (let index = Math.min(referenceLine - 1, lines.length - 1); index >= 0; index -= 1) {
    const match = lines[index].match(TASK_LINE_REGEX);
    if (match && match[2].toLowerCase() !== "x") {
      return index;
    }
  }

  return findFirstIncompleteTaskLine(lines);
}

export function findFirstIncompleteTaskLine(lines: string[]): number | null {
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(TASK_LINE_REGEX);
    if (match && match[2].toLowerCase() !== "x") {
      return index;
    }
  }

  return null;
}

export function stripNextActionTags(lines: string[], nextActionTag: string): string[] {
  return lines.map((line) => {
    // Only strip from task lines so plain prose tags remain untouched.
    if (!lineHasTag(line, nextActionTag) || !line.match(TASK_LINE_REGEX)) {
      return line;
    }

    return line.replace(getTagReplaceRegex(nextActionTag), "");
  });
}

export function addNextActionTag(lines: string[], targetLine: number, nextActionTag: string): string {
  const nextLines = [...lines];
  const targetLineContent = nextLines[targetLine];
  if (!lineHasTag(targetLineContent, nextActionTag)) {
    nextLines[targetLine] = `${targetLineContent} ${nextActionTag}`;
  }

  return nextLines.join("\n");
}

export function resetTaskContent(content: string): ResetTaskContentResult {
  const lines = content.split(/\r?\n/);
  let changed = false;
  let taskCount = 0;

  const nextLines = lines.map((line) => {
    const match = line.match(TASK_LINE_REGEX);
    if (!match) {
      return line;
    }

    taskCount += 1;
    const openPrefix = match[1].replace(/\[( |x|X)\]/, "[ ]");
    const cleanedBody = stripResetTaskFields(match[3]);
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

function lineHasTag(line: string, nextActionTag: string): boolean {
  return getTagPresenceRegex(nextActionTag).test(line);
}

function getTagPresenceRegex(nextActionTag: string): RegExp {
  return new RegExp(`(^|\\s)${escapeRegExp(nextActionTag)}(?=$|\\s)`);
}

function getTagReplaceRegex(nextActionTag: string): RegExp {
  return new RegExp(`\\s+${escapeRegExp(nextActionTag)}(?=$|\\s)`, "g");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripResetTaskFields(taskBody: string): string {
  return taskBody
    .replace(/\s*\[(?:due|completion-date|completion-time|created)::\s*[^\]]*\]/gi, "")
    .replace(/\s{2,}/g, " ")
    .trimEnd();
}

