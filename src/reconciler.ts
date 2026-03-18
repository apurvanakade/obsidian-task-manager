import { TFile } from "obsidian";
import {
  addNextActionTag,
  extractTaskState,
  findFirstIncompleteTaskLine,
  findNextIncompleteTaskLine,
  findPreviousIncompleteTaskLine,
  setTaskStatus,
  stripNextActionTags,
  TaskState
} from "./task-utils";
import { TaskManagerSettings } from "./settings-utils";

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
  previousState: TaskState[];
  nextState: TaskState[];
};

type DeletedTagContext = ReconcilerContext & {
  content: string;
  deletedTaggedTaskLine: number;
};

type UncompletionContext = ReconcilerContext & {
  content: string;
  uncompletedLine: number;
};

type InitializeContext = {
  settings: TaskManagerSettings;
  getMarkdownFiles: () => TFile[];
  reconcileOneFile: (file: TFile) => Promise<void>;
};

function isInProjectsFolder(filePath: string, projectsFolder: string): boolean {
  return filePath === projectsFolder || filePath.startsWith(`${projectsFolder}/`);
}

export async function applyCompletionRules(context: CompletionContext): Promise<void> {
  const { file, content, completedLine, settings, readFile, writeFileContent, setFileStatus, setTaskState, previousState, nextState } = context;
  const lines = content.split(/\r?\n/);

  // Get the actual task status before and after to determine if we should cycle through started.
  const currentTask = nextState.find((t) => t.line === completedLine);
  const previousTask = previousState.find((t) => t.line === completedLine);

  // If task was open (or not in cache) and is now completed, it's a direct click on an open task.
  // In that case, redirect to started state to enforce the cycle [ ] → [/] → [x].
  if (currentTask?.status === "completed" && (!previousTask || previousTask.status === "open")) {
    const updatedLines = lines.map((line, idx) => {
      return idx === completedLine ? setTaskStatus(line, "started") : line;
    });
    const updatedContent = updatedLines.join("\n");

    if (updatedContent !== content) {
      await writeFileContent(file, updatedContent);
    }
    return;
  }

  // If task was started and is now open, Obsidian toggled [/] back to [ ]. Complete it instead.
  if (previousTask?.status === "started" && currentTask?.status === "open") {
    // Convert [/] to [x] and apply completion rules in one shot, no re-read needed.
    const completionLines = lines.map((line, idx) => {
      return idx === completedLine ? setTaskStatus(line, "completed") : line;
    });

    const startedNextTaskLine = findFirstIncompleteTaskLine(completionLines);
    // Stamp completion date and time.
    completionLines[completedLine] = addCompletionFields(completionLines[completedLine]);
    const cleanedLines = stripNextActionTags(completionLines, settings.nextActionTag);
    const newStatus = startedNextTaskLine === null ? "completed" : "todo";

    let updatedContent = startedNextTaskLine !== null
      ? addNextActionTag(cleanedLines, startedNextTaskLine, settings.nextActionTag)
      : cleanedLines.join("\n");

    if (updatedContent !== content) {
      await writeFileContent(file, updatedContent);
    }

    await setFileStatus(file, newStatus);
    return;
  }

  const nextTaskLine = findFirstIncompleteTaskLine(lines);
  const cleanedLines = stripNextActionTags(lines, settings.nextActionTag);
  // Stamp completion metadata on the completed task.
  cleanedLines[completedLine] = addCompletionFields(cleanedLines[completedLine]);
  const newStatus = nextTaskLine === null ? "completed" : "todo";

  let updatedContent = cleanedLines.join("\n");

  if (nextTaskLine !== null) {
    updatedContent = addNextActionTag(cleanedLines, nextTaskLine, settings.nextActionTag);
  }

  if (updatedContent !== content) {
    await writeFileContent(file, updatedContent);
  }

  await setFileStatus(file, newStatus);

  const refreshedContent = await readFile(file);
  setTaskState(file.path, extractTaskState(refreshedContent, settings.nextActionTag));
}

export async function applyUncompletionRules(context: UncompletionContext): Promise<void> {
  const { file, content, uncompletedLine, settings, readFile, writeFileContent, setFileStatus, setTaskState } = context;
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
    const refreshedContent = await readFile(file);
    setTaskState(file.path, extractTaskState(refreshedContent, settings.nextActionTag));
    return;
  }

  const cleanedLines = stripNextActionTags(lines, settings.nextActionTag);
  const updatedContent = addNextActionTag(cleanedLines, uncompletedLine, settings.nextActionTag);

  if (updatedContent !== content) {
    await writeFileContent(file, updatedContent);
  }

  await setFileStatus(file, "todo");
  const refreshedContent = await readFile(file);
  setTaskState(file.path, extractTaskState(refreshedContent, settings.nextActionTag));
}

export async function applyDeletedTagRules(context: DeletedTagContext): Promise<void> {
  const { file, content, deletedTaggedTaskLine, settings, readFile, writeFileContent, setFileStatus, setTaskState } = context;
  const lines = content.split(/\r?\n/);
  const cleanedLines = stripNextActionTags(lines, settings.nextActionTag);
  const previousTaskLine = findPreviousIncompleteTaskLine(cleanedLines, deletedTaggedTaskLine);

  if (previousTaskLine === null) {
    await setFileStatus(file, "completed");
    const refreshedContent = await readFile(file);
    setTaskState(file.path, extractTaskState(refreshedContent, settings.nextActionTag));
    return;
  }

  const updatedContent = addNextActionTag(cleanedLines, previousTaskLine, settings.nextActionTag);
  if (updatedContent !== content) {
    await writeFileContent(file, updatedContent);
  }

  await setFileStatus(file, "todo");
  const refreshedContent = await readFile(file);
  setTaskState(file.path, extractTaskState(refreshedContent, settings.nextActionTag));
}

export async function reconcileFile(context: ReconcilerContext): Promise<void> {
  const { file, settings, readFile, writeFileContent, setFileStatus, setTaskState } = context;
  const content = await readFile(file);
  const lines = content.split(/\r?\n/);
  const cleanedLines = stripNextActionTags(lines, settings.nextActionTag);
  const firstIncompleteTaskLine = findFirstIncompleteTaskLine(cleanedLines);
  let updatedContent = cleanedLines.join("\n");
  let nextStatus = "completed";

  if (firstIncompleteTaskLine !== null) {
    updatedContent = addNextActionTag(cleanedLines, firstIncompleteTaskLine, settings.nextActionTag);
    nextStatus = "todo";
  }

  if (updatedContent !== content) {
    await writeFileContent(file, updatedContent);
  }

  await setFileStatus(file, nextStatus);
  const refreshedContent = await readFile(file);
  setTaskState(file.path, extractTaskState(refreshedContent, settings.nextActionTag));
}

export async function initializeProjectsFolder(context: InitializeContext): Promise<number> {
  const files = context.getMarkdownFiles().filter((file) => isInProjectsFolder(file.path, context.settings.projectsFolder));
  for (const file of files) {
    await context.reconcileOneFile(file);
  }

  return files.length;
}

function getCompletionDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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