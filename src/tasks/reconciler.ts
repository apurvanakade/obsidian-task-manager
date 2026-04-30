/**
 * Purpose:
 * - reconcile task-line transitions and apply task semantics.
 *
 * Responsibilities:
 * - detects completion/uncompletion/deletion effects from prior/current task state
 * - applies completion metadata updates and next-action tag reassignment
 * - inserts/updates recurring follow-up tasks based on repeat fields
 * - triggers due-date collection behavior for newly assigned next-action tasks
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
  addNextActionTag,
  extractTaskState,
  findFirstIncompleteTaskLine,
  findPreviousIncompleteTaskLine,
  moveTaskToCompletedSection,
  stripNextActionTags,
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
  app?: App;
};

type CompletionContext = ReconcilerContext & {
  content: string;
  completedLine: number;
};

type DeletedTagContext = ReconcilerContext & {
  content: string;
  deletedTaggedTaskLine: number;
};

type UncompletionContext = ReconcilerContext & {
  content: string;
  uncompletedLine: number;
};

async function showDueDateModalForNextAction(
  file: TFile,
  taskLineIndex: number,
  previousContent: string,
  updatedContent: string,
  context: ReconcilerContext
): Promise<void> {
  const { app, settings, readFile, writeFileContent, setTaskState } = context;

  if (!app) {
    return;
  }

  const lines = updatedContent.split(/\r?\n/);
  const taskLine = lines[taskLineIndex];
  if (!taskLine) {
    return;
  }

  // Only prompt when the assignment is genuinely new for this task line.
  const previousLines = previousContent.split(/\r?\n/);
  if (previousLines.includes(taskLine)) {
    return;
  }
  
  // Skip if task is repeating (it already has a due date assigned)
  const isRepeating = parseRepeatRule(taskLine) !== null;
  if (isRepeating) {
    return;
  }

  // Skip if task already has a due date
  if (taskLine.includes("[due::")) {
    return;
  }

  const modalContent = await readFile(file);
  const initialPriority = String(readFilePriority(modalContent)) as "1" | "2" | "3";

  const modal = new DueDateModal({
    app,
    taskLine,
    initialPriority,
    onSubmit: async (taskLine, dueDate, priority) => {
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

          taskFound = true;
          break;
        }
      }

      if (taskFound) {
        const nextContent = updatedLines.join("\n");
        await writeFileContent(file, nextContent);
        await context.setFilePriority(file, Number.parseInt(priority, 10) as FilePriority);
        setTaskState(file.path, extractTaskState(updatedLines.join("\n"), settings.nextActionTag));
      }
    }
  });
  modal.open();
}

export async function applyCompletionRules(context: CompletionContext): Promise<void> {
  const { file, content, completedLine, settings, writeFileContent, setFileStatus, setTaskState } = context;
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

  const cleanedLines = stripNextActionTags(nextLines, settings.nextActionTag);
  const nextTaskLine = findFirstIncompleteTaskLine(cleanedLines);
  const newStatus = nextTaskLine === null ? "completed" : "todo";

  let workingLines = cleanedLines;

  if (nextTaskLine !== null) {
    workingLines = addNextActionTag(cleanedLines, nextTaskLine, settings.nextActionTag).split(/\r?\n/);
  }

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
  setTaskState(file.path, extractTaskState(updatedContent, settings.nextActionTag));

  // Show due date modal if next-action was assigned.
  // Re-find the next task index in the final content since moveTaskToCompletedSection
  // may have shifted line positions.
  if (nextTaskLine !== null) {
    const nextTaskLineInFinal = findFirstIncompleteTaskLine(workingLines);
    if (nextTaskLineInFinal !== null) {
      await showDueDateModalForNextAction(file, nextTaskLineInFinal, content, updatedContent, context);
    }
  }
}

export async function applyUncompletionRules(context: UncompletionContext): Promise<void> {
  const { file, content, uncompletedLine, settings, writeFileContent, setFileStatus, setTaskState } = context;
  const lines = content.split(/\r?\n/);
  // Reopened tasks must lose completion metadata.
  lines[uncompletedLine] = stripCompletionFields(lines[uncompletedLine]);
  const firstIncompleteTaskLine = findFirstIncompleteTaskLine(lines);

  if (firstIncompleteTaskLine !== uncompletedLine) {
    const updatedContent = lines.join("\n");
    if (updatedContent !== content) {
      await writeFileContent(file, updatedContent);
    }

    await setFileStatus(file, "todo");
    setTaskState(file.path, extractTaskState(updatedContent, settings.nextActionTag));
    return;
  }

  const cleanedLines = stripNextActionTags(lines, settings.nextActionTag);
  const updatedContent = addNextActionTag(cleanedLines, uncompletedLine, settings.nextActionTag);

  if (updatedContent !== content) {
    await writeFileContent(file, updatedContent);
  }

  await setFileStatus(file, "todo");
  setTaskState(file.path, extractTaskState(updatedContent, settings.nextActionTag));

  // Show due date modal if next-action was assigned to this task
  await showDueDateModalForNextAction(file, uncompletedLine, content, updatedContent, context);
}

export async function applyDeletedTagRules(context: DeletedTagContext): Promise<void> {
  const { file, content, deletedTaggedTaskLine, settings, writeFileContent, setFileStatus, setTaskState } = context;
  const lines = content.split(/\r?\n/);
  const cleanedLines = stripNextActionTags(lines, settings.nextActionTag);
  const previousTaskLine = findPreviousIncompleteTaskLine(cleanedLines, deletedTaggedTaskLine);

  if (previousTaskLine === null) {
    const updatedContent = lines.join("\n");
    if (updatedContent !== content) {
      await writeFileContent(file, updatedContent);
    }
    await setFileStatus(file, "completed");
    setTaskState(file.path, extractTaskState(updatedContent, settings.nextActionTag));
    return;
  }

  const updatedContent = addNextActionTag(cleanedLines, previousTaskLine, settings.nextActionTag);
  if (updatedContent !== content) {
    await writeFileContent(file, updatedContent);
  }

  await setFileStatus(file, "todo");
  setTaskState(file.path, extractTaskState(updatedContent, settings.nextActionTag));

  // Show due date modal if next-action was assigned to this task
  await showDueDateModalForNextAction(file, previousTaskLine, content, updatedContent, context);
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
  const cleanedLines = stripNextActionTags(lines, settings.nextActionTag);
  const firstIncompleteTaskLine = findFirstIncompleteTaskLine(cleanedLines);
  let updatedContent = cleanedLines.join("\n");
  let nextStatus: string | null = "completed";

  if (firstIncompleteTaskLine !== null) {
    updatedContent = addNextActionTag(cleanedLines, firstIncompleteTaskLine, settings.nextActionTag);
    nextStatus = currentStatus !== null && currentStatus !== "completed" ? null : "todo";
  }

  if (updatedContent !== content) {
    await writeFileContent(file, updatedContent);
  }

  if (nextStatus !== null) {
    await setFileStatus(file, nextStatus);
  }
  setTaskState(file.path, extractTaskState(updatedContent, settings.nextActionTag));

  // Show due date modal if next-action was assigned
  if (firstIncompleteTaskLine !== null) {
    await showDueDateModalForNextAction(file, firstIncompleteTaskLine, content, updatedContent, context);
  }
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
