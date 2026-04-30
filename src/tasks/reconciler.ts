/**
 * Purpose:
 * - reconcile task-line transitions and apply task semantics.
 *
 * Responsibilities:
 * - detects completion/uncompletion/deletion effects from prior/current task state
 * - applies completion metadata updates and first-incomplete-task status updates
 * - inserts/updates recurring follow-up tasks based on repeat fields
 * - triggers due-date collection behavior for newly exposed first incomplete tasks
 *
 * Dependencies:
 * - task utilities, status helpers, and due-date modal callback integration
 *
 * Side Effects:
 * - returns updated content/state and can trigger modal-driven async due-date writes
 */
import { App, TFile } from "obsidian";
import { getCurrentDateString, getCurrentTimeString } from "../date/date-utils";
import { FilePriority, readFilePriority } from "./file-priority";
import {
  extractTaskState,
  findFirstIncompleteTaskLine,
  moveTaskToCompletedSection,
  TaskState
} from "./task-utils";
import { TaskManagerSettings } from "../settings/settings-utils";
import { readStatusValue } from "../routing/status-routing";
import { DueDateModal } from "./due-date-modal";
import { getRepeatDueDate, parseRepeatRule, RepeatRule } from "./repeat-rules";

type ReconcilerContext = {
  file: TFile;
  settings: TaskManagerSettings;
  readFile: (file: TFile) => Promise<string>;
  writeFileContent: (file: TFile, content: string) => Promise<void>;
  setFileStatus: (file: TFile, status: string) => Promise<void>;
  setFilePriority: (file: TFile, priority: FilePriority) => Promise<void>;
  setTaskState: (filePath: string, state: TaskState[]) => void;
  onTaskPropertiesChanged?: () => Promise<void>;
  app?: App;
};

type CompletionContext = ReconcilerContext & {
  content: string;
  completedLine: number;
  previousFirstIncompleteLine: number | null;
};

type UncompletionContext = ReconcilerContext & {
  content: string;
  uncompletedLine: number;
};

async function showDueDateModalForFirstIncompleteTask(
  file: TFile,
  taskLineIndex: number,
  updatedContent: string,
  context: ReconcilerContext
): Promise<void> {
  const { app, readFile, writeFileContent, setTaskState } = context;

  if (!app) {
    return;
  }

  const lines = updatedContent.split(/\r?\n/);
  const taskLine = lines[taskLineIndex];
  if (!taskLine) {
    return;
  }

  // Skip if task is repeating (it already has a due date assigned)
  const isRepeating = parseRepeatRule(taskLine) !== null;
  if (isRepeating) {
    return;
  }

  const modalContent = await readFile(file);
  const initialPriority = String(readFilePriority(modalContent)) as "1" | "2" | "3";
  const initialDueDateMatch = taskLine.match(/\[due::\s*([^\]]*?)\s*\]/i);
  const initialDueDate = initialDueDateMatch ? initialDueDateMatch[1].trim() : null;

  const modal = new DueDateModal({
    app,
    taskLine,
    initialPriority,
    initialDueDate,
    onSubmit: async (taskLine, dueDate, priority, repeat) => {
      // Validate date format
      if (!isValidDateFormat(dueDate)) {
        return;
      }

      const currentContent = await readFile(file);
      const updatedLines = currentContent.split(/\r?\n/);
      let taskFound = false;

      for (let i = 0; i < updatedLines.length; i++) {
        if (updatedLines[i] === taskLine) {
          // Check if task already has a due date
          if (updatedLines[i].includes("[due::")) {
            updatedLines[i] = updatedLines[i].replace(/\[due::\s*[^\]]*\]/g, `[due:: ${dueDate}]`);
          } else {
            updatedLines[i] = `${updatedLines[i].trimEnd()} [due:: ${dueDate}]`;
          }

          if (repeat !== null) {
            if (updatedLines[i].match(/\[(?:repeat|repeats)::\s*[^\]]*\]/i)) {
              updatedLines[i] = updatedLines[i].replace(/\[(?:repeat|repeats)::\s*[^\]]*\]/gi, `[repeat:: ${repeat}]`);
            } else {
              updatedLines[i] = `${updatedLines[i].trimEnd()} [repeat:: ${repeat}]`;
            }
          }

          taskFound = true;
          break;
        }
      }

        if (taskFound) {
          const nextContent = updatedLines.join("\n");
          await writeFileContent(file, nextContent);
          await context.setFilePriority(file, Number.parseInt(priority, 10) as FilePriority);
          setTaskState(file.path, extractTaskState(nextContent));
          await context.onTaskPropertiesChanged?.();
        }
      }
    });
  modal.open();
}

export async function applyCompletionRules(context: CompletionContext): Promise<void> {
  const { file, content, completedLine, previousFirstIncompleteLine, writeFileContent, setFileStatus, setTaskState } = context;
  const lines = content.split(/\r?\n/);
  const nextLines = [...lines];
  const sourceTaskLine = lines[completedLine];
  let completedLineIndex = completedLine;

  const repeatRule = parseRepeatRule(sourceTaskLine);
  if (repeatRule !== null) {
    const repeatedTaskLine = buildRepeatedTaskLine(sourceTaskLine, repeatRule);
    if (repeatedTaskLine !== null) {
      nextLines.splice(completedLine, 0, repeatedTaskLine);
      completedLineIndex += 1;
    }
  }

  // Stamp completion metadata on the completed task.
  nextLines[completedLineIndex] = addCompletionFields(nextLines[completedLineIndex]);

  let workingLines = nextLines;
  const nextTaskLine = findFirstIncompleteTaskLine(workingLines);
  const newStatus = nextTaskLine === null ? "completed" : "todo";

  // Move the stamped completed task into the "## Completed Tasks" section.
  // completedLineIndex may have shifted if a recurring task was inserted above it,
  // so search for the exact stamped line to get the current index.
  const stampedLine = workingLines[completedLineIndex];
  const actualCompletedLineIndex = workingLines.indexOf(stampedLine, completedLineIndex);
  if (actualCompletedLineIndex !== -1) {
    workingLines = moveTaskToCompletedSection(workingLines, actualCompletedLineIndex);
  }

  const updatedContent = workingLines.join("\n");

  if (updatedContent !== content) {
    await writeFileContent(file, updatedContent);
  }

  await setFileStatus(file, newStatus);
  setTaskState(file.path, extractTaskState(updatedContent));

  if (previousFirstIncompleteLine === completedLine && nextTaskLine !== null) {
    const nextTaskLineInFinal = findFirstIncompleteTaskLine(workingLines);
    if (nextTaskLineInFinal !== null) {
      await showDueDateModalForFirstIncompleteTask(file, nextTaskLineInFinal, updatedContent, context);
    }
  }
}

export async function applyUncompletionRules(context: UncompletionContext): Promise<void> {
  const { file, content, uncompletedLine, writeFileContent, setFileStatus, setTaskState } = context;
  const lines = content.split(/\r?\n/);
  // Reopened tasks must lose completion metadata.
  lines[uncompletedLine] = stripCompletionFields(lines[uncompletedLine]);
  const workingLines = lines;
  const firstIncompleteTaskLine = findFirstIncompleteTaskLine(workingLines);

  if (firstIncompleteTaskLine !== uncompletedLine) {
    const updatedContent = workingLines.join("\n");
    if (updatedContent !== content) {
      await writeFileContent(file, updatedContent);
    }

    await setFileStatus(file, "todo");
    setTaskState(file.path, extractTaskState(updatedContent));
    return;
  }

  const updatedContent = workingLines.join("\n");

  if (updatedContent !== content) {
    await writeFileContent(file, updatedContent);
  }

  await setFileStatus(file, "todo");
  setTaskState(file.path, extractTaskState(updatedContent));

  await showDueDateModalForFirstIncompleteTask(file, uncompletedLine, updatedContent, context);
}

export async function reconcileFile(context: ReconcilerContext): Promise<void> {
  const { file, settings, readFile, writeFileContent, setFileStatus, setTaskState } = context;
  const content = await readFile(file);
  const currentStatus = readStatusValue(content, settings.statusField);
  const lines = content
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^(\s*[-*+]\s+\[)( |x|X)(\]\s*.*)$/);
      if (!match) {
        return line;
      }

      // Open tasks should never keep completion metadata when reconciled.
      if (match[2].toLowerCase() === "x") {
        return line;
      }

      return stripCompletionFields(line);
    });
  const firstIncompleteTaskLine = findFirstIncompleteTaskLine(lines);
  const updatedContent = lines.join("\n");
  let nextStatus: string | null = "completed";

  if (firstIncompleteTaskLine !== null) {
    nextStatus = currentStatus !== null && currentStatus !== "completed" ? null : "todo";
  }

  if (updatedContent !== content) {
    await writeFileContent(file, updatedContent);
  }

  if (nextStatus !== null) {
    await setFileStatus(file, nextStatus);
  }
  setTaskState(file.path, extractTaskState(updatedContent));
}

export function getCompletionDateString(): string {
  return getCurrentDateString();
}

export function getCompletionTimeString(): string {
  return getCurrentTimeString();
}

function addCompletionFields(line: string): string {
  const cleaned = stripCompletionFields(line);
  return `${cleaned} [completion-date:: ${getCompletionDateString()}] [completion-time:: ${getCompletionTimeString()}]`;
}

function stripCompletionFields(line: string): string {
  return line
    .replace(/\s*\[completion-date::[^\]]*\]/g, "")
    .replace(/\s*\[completion-time::[^\]]*\]/g, "");
}

function buildRepeatedTaskLine(completedLine: string, repeatRule: RepeatRule): string | null {
  const cleaned = stripCompletionFields(completedLine);
  if (!cleaned.match(/^(\s*[-*+]\s+\[)[^\]](\]\s*)/)) {
    return null;
  }

  const openTask = cleaned.replace(/^(\s*[-*+]\s+\[)[^\]](\]\s*)/, "$1 $2");
  const taskBodyWithoutDue = openTask.replace(/\s*\[due::\s*[^\]]*\]/g, "").trimEnd();
  const dueDate = getRepeatDueDate(repeatRule);
  return `${taskBodyWithoutDue} [due:: ${dueDate}]`;
}

function isValidDateFormat(dateStr: string): boolean {
  const trimmed = dateStr.trim();
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(trimmed)) {
    return false;
  }

  const date = new Date(trimmed + "T00:00:00Z");
  return !isNaN(date.getTime());
}
