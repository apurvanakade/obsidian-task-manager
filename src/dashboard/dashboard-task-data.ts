/**
 * Purpose:
 * - provide pure task-data parsing/filtering utilities for the date dashboard.
 *
 * Responsibilities:
 * - parses task lines for due/completion metadata
 * - reads file-level priority from frontmatter
 * - filters tasks into Due and Completed sets for a target date note
 * - collects open tasks from the inbox file for the Inbox section
 * - normalizes task display text and sorting behavior
 * - exposes date-note filename parsing helper
 *
 * Dependencies:
 * - Obsidian vault read APIs for markdown file enumeration and reads
 *
 * Side Effects:
 * - reads markdown file content from the vault
 */
import { App, TFile } from "obsidian";
import { readFilePriority } from "../tasks/file-priority";
import { cleanTaskText, isRecurringTask, parseTaskLine, readInlineFieldValue } from "../tasks/task-line-metadata";

const EMPTY_DUE_DATE_SORT_VALUE = "9999-99-99";
const MARKDOWN_EXTENSION_REGEX = /\.md$/i;
const DATE_FILE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DUE_FIELD_REGEX = /\[due::\s*([^\]]+?)\s*\]/i;
const COMPLETION_DATE_FIELD_REGEX = /\[completion-date::\s*([^\]]+?)\s*\]/i;

export type DashboardRow = {
  file: TFile;
  task: string;
  dueDate: string | null;
  priority: number;
  isRecurring: boolean;
};

type ParsedDashboardTask = {
  text: string;
  status: "open" | "completed";
  dueDate: string | null;
  completedDate: string | null;
  isRecurring: boolean;
};

export function getDateStringFromFileName(fileName: string): string | null {
  const baseName = fileName.replace(MARKDOWN_EXTENSION_REGEX, "");
  return DATE_FILE_REGEX.test(baseName) ? baseName : null;
}

export async function collectTasksForDate(
  app: App,
  taskFolderRoots: string[],
  dateString: string,
): Promise<{ dueTasks: DashboardRow[]; completedTasks: DashboardRow[] }> {
  const dueTasks: DashboardRow[] = [];
  const completedTasks: DashboardRow[] = [];
  const files = app.vault.getMarkdownFiles().filter((file) =>
    taskFolderRoots.some((root) => file.path.startsWith(`${root}/`)),
  );

  for (const file of files) {
    const content = await app.vault.read(file);
    const priority = readFilePriority(content);
    const lines = content.split(/\r?\n/);

    for (const line of lines) {
      const parsedTask = parseDashboardTaskLine(line);
      if (!parsedTask) {
        continue;
      }

      if (parsedTask.status === "open" && parsedTask.dueDate !== null && parsedTask.dueDate <= dateString) {
        dueTasks.push({
          file,
          task: parsedTask.text,
          dueDate: parsedTask.dueDate,
          priority,
          isRecurring: parsedTask.isRecurring,
        });
      }

      if (parsedTask.completedDate === dateString) {
        completedTasks.push({
          file,
          task: parsedTask.text,
          dueDate: null,
          priority,
          isRecurring: parsedTask.isRecurring,
        });
      }
    }
  }

  dueTasks.sort(compareDueRows);
  completedTasks.sort(compareRows);

  return { dueTasks, completedTasks };
}

/**
 * Collects all open tasks from the configured inbox file (not date-based).
 * Used for the Inbox section in the dashboard.
 */
export async function collectInboxTasks(
  app: App,
  inboxFile: string,
): Promise<DashboardRow[]> {
  if (!inboxFile) return [];
  const file = app.vault.getAbstractFileByPath(inboxFile);
  if (!file || !(file instanceof TFile)) return [];
  const content = await app.vault.read(file);
  const priority = readFilePriority(content);
  const lines = content.split(/\r?\n/);
  const inboxTasks: DashboardRow[] = [];
  for (const line of lines) {
    const parsedTask = parseTaskLine(line);
    if (!parsedTask || parsedTask.status !== "open") {
      continue;
    }

    inboxTasks.push({
      file,
      task: cleanTaskText(parsedTask.taskBody),
      dueDate: null,
      priority,
      isRecurring: false,
    });
  }
  inboxTasks.sort(compareRows);
  return inboxTasks;
}

function parseDashboardTaskLine(line: string): ParsedDashboardTask | null {
  const parsedTask = parseTaskLine(line);
  if (!parsedTask) {
    return null;
  }

  const { status, taskBody } = parsedTask;
  const dueDate = readInlineFieldValue(taskBody, DUE_FIELD_REGEX);
  const completedDate = readInlineFieldValue(taskBody, COMPLETION_DATE_FIELD_REGEX);

  if (!dueDate && !completedDate) {
    return null;
  }

  return {
    text: cleanTaskText(taskBody),
    status,
    dueDate,
    completedDate,
    isRecurring: isRecurringTask(taskBody),
  };
}

function compareRows(left: DashboardRow, right: DashboardRow): number {
  const priorityCompare = left.priority - right.priority;
  if (priorityCompare !== 0) {
    return priorityCompare;
  }

  const pathCompare = left.file.path.localeCompare(right.file.path);
  if (pathCompare !== 0) {
    return pathCompare;
  }

  return left.task.localeCompare(right.task);
}

function compareDueRows(left: DashboardRow, right: DashboardRow): number {
  const priorityCompare = left.priority - right.priority;
  if (priorityCompare !== 0) {
    return priorityCompare;
  }

  const leftDueDate = left.dueDate ?? EMPTY_DUE_DATE_SORT_VALUE;
  const rightDueDate = right.dueDate ?? EMPTY_DUE_DATE_SORT_VALUE;
  const dueDateCompare = leftDueDate.localeCompare(rightDueDate);
  if (dueDateCompare !== 0) {
    return dueDateCompare;
  }

  return compareRows(left, right);
}
