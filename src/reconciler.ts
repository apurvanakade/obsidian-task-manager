import { TFile } from "obsidian";
import {
  addNextActionTag,
  didSkipStartedState,
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
  const { file, content, completedLine, settings, readFile, writeFileContent, setTaskState, previousState, nextState } = context;
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
    const updatedLines = lines.map((line, idx) => {
      return idx === completedLine ? setTaskStatus(line, "completed") : line;
    });
    const updatedContent = updatedLines.join("\n");

    if (updatedContent !== content) {
      await writeFileContent(file, updatedContent);
    }
    // After rewriting to completed, recursively call to apply completion logic.
    const refreshedContent = await readFile(file);
    const refreshedState = extractTaskState(refreshedContent, settings.nextActionTag);
    await applyCompletionRules({ ...context, content: refreshedContent, previousState, nextState: refreshedState });
    return;
  }

  const nextTaskLine = findNextIncompleteTaskLine(lines, completedLine);
  const cleanedLines = stripNextActionTags(lines, settings.nextActionTag);
  let updatedContent = cleanedLines.join("\n");

  if (nextTaskLine !== null) {
    updatedContent = addNextActionTag(cleanedLines, nextTaskLine, settings.nextActionTag);
  }

  if (updatedContent !== content) {
    await writeFileContent(file, updatedContent);
  }

  const refreshedContent = await readFile(file);
  setTaskState(file.path, extractTaskState(refreshedContent, settings.nextActionTag));
}

export async function applyUncompletionRules(context: UncompletionContext): Promise<void> {
  const { file, content, uncompletedLine, settings, readFile, writeFileContent, setFileStatus, setTaskState } = context;
  const lines = content.split(/\r?\n/);
  const firstIncompleteTaskLine = findFirstIncompleteTaskLine(lines);

  // Only act if the uncompleted task is now the first open task in the file.
  if (firstIncompleteTaskLine !== uncompletedLine) {
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