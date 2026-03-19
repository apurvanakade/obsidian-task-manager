import { TFile } from "obsidian";
import {
  addNextActionTag,
  extractTaskState,
  findFirstIncompleteTaskLine,
  findPreviousIncompleteTaskLine,
  stripNextActionTags,
  TaskState
} from "./task-utils";
import { TaskManagerSettings } from "./settings-utils";
import { readStatusValue } from "./status-routing";

type ReconcilerContext = {
  file: TFile;
  settings: TaskManagerSettings;
  readFile: (file: TFile) => Promise<string>;
  writeFileContent: (file: TFile, content: string) => Promise<void>;
  setFileStatus: (file: TFile, status: string) => Promise<void>;
  setTaskState: (filePath: string, state: TaskState[]) => void;
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

type ProcessTasksContext = {
  settings: TaskManagerSettings;
  getMarkdownFiles: () => TFile[];
  reconcileOneFile: (file: TFile) => Promise<void>;
};

type RepeatRule = "day" | "week" | "month" | "year";

function isInProjectsFolder(filePath: string, projectsFolder: string): boolean {
  return filePath === projectsFolder || filePath.startsWith(`${projectsFolder}/`);
}

export async function applyCompletionRules(context: CompletionContext): Promise<void> {
  const { file, content, completedLine, settings, writeFileContent, setFileStatus, setTaskState } = context;
  const lines = content.split(/\r?\n/);
  const nextLines = [...lines];
  const sourceTaskLine = lines[completedLine];
  let completedLineIndex = completedLine;

  const repeatRule = getRepeatRule(sourceTaskLine);
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

  let updatedContent = cleanedLines.join("\n");

  if (nextTaskLine !== null) {
    updatedContent = addNextActionTag(cleanedLines, nextTaskLine, settings.nextActionTag);
  }

  if (updatedContent !== content) {
    await writeFileContent(file, updatedContent);
  }

  await setFileStatus(file, newStatus);
  setTaskState(file.path, extractTaskState(updatedContent, settings.nextActionTag));
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
}

export async function applyDeletedTagRules(context: DeletedTagContext): Promise<void> {
  const { file, content, deletedTaggedTaskLine, settings, writeFileContent, setFileStatus, setTaskState } = context;
  const lines = content.split(/\r?\n/);
  const cleanedLines = stripNextActionTags(lines, settings.nextActionTag);
  const previousTaskLine = findPreviousIncompleteTaskLine(cleanedLines, deletedTaggedTaskLine);

  if (previousTaskLine === null) {
    await setFileStatus(file, "completed");
    setTaskState(file.path, extractTaskState(content, settings.nextActionTag));
    return;
  }

  const updatedContent = addNextActionTag(cleanedLines, previousTaskLine, settings.nextActionTag);
  if (updatedContent !== content) {
    await writeFileContent(file, updatedContent);
  }

  await setFileStatus(file, "todo");
  setTaskState(file.path, extractTaskState(updatedContent, settings.nextActionTag));
}

export async function reconcileFile(context: ReconcilerContext): Promise<void> {
  const { file, settings, readFile, writeFileContent, setFileStatus, setTaskState } = context;
  const content = await readFile(file);
  const currentStatus = readStatusValue(content, settings.statusField);
  const lines = content.split(/\r?\n/);
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
}

export async function processProjectsFolder(context: ProcessTasksContext): Promise<number> {
  const { settings } = context;
  const activeFolders = [
    settings.projectsFolder,
    settings.completedProjectsFolder,
    settings.waitingProjectsFolder,
    settings.scheduledProjectsFolder,
    settings.somedayMaybeProjectsFolder,
  ].filter(Boolean);

  const files = context.getMarkdownFiles().filter((file) =>
    activeFolders.some((folder) => isInProjectsFolder(file.path, folder))
  );

  for (const file of files) {
    await context.reconcileOneFile(file);
  }

  return files.length;
}

function getCompletionDateString(): string {
  return formatDate(new Date());
}

function getCompletionTimeString(): string {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const mins = String(now.getMinutes()).padStart(2, "0");
  const secs = String(now.getSeconds()).padStart(2, "0");
  return `${hours}:${mins}:${secs}`;
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

function getRepeatRule(line: string): RepeatRule | null {
  const match = line.match(/\[(?:repeat|repeats)::\s*every\s+(day|week|month|year)\s*\]/i);
  return match ? (match[1].toLowerCase() as RepeatRule) : null;
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

function getRepeatDueDate(repeatRule: RepeatRule): string {
  const now = new Date();

  switch (repeatRule) {
    case "day":
      return formatDate(addDays(now, 1));
    case "week":
      return formatDate(addDays(now, 7));
    case "month":
      return formatDate(addMonthsClamped(now, 1));
    case "year":
      return formatDate(addMonthsClamped(now, 12));
    default:
      return formatDate(now);
  }
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

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
