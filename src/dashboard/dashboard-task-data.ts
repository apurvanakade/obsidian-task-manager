/**
 * Purpose:
 * - provide pure task-data parsing/filtering utilities for the date dashboard.
 *
 * Responsibilities:
 * - parses task lines for due/completion metadata
 * - filters tasks into Due and Completed sets for a target date note
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

const EMPTY_DUE_DATE_SORT_VALUE = "9999-99-99";
const MARKDOWN_EXTENSION_REGEX = /\.md$/i;
const DATE_FILE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TASK_LINE_REGEX = /^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$/;
const DUE_FIELD_REGEX = /\[due::\s*([^\]]+?)\s*\]/i;
const COMPLETION_DATE_FIELD_REGEX = /\[completion-date::\s*([^\]]+?)\s*\]/i;
const INLINE_FIELD_REGEX = /\s*\[[^\]]+::\s*[^\]]*\]/g;
const TAG_REGEX = /(^|\s)#[^\s#]+/g;
const MULTISPACE_REGEX = /\s+/g;

export type DashboardRow = {
  file: TFile;
  task: string;
  dueDate: string | null;
};

type ParsedDashboardTask = {
  text: string;
  status: "open" | "completed";
  dueDate: string | null;
  completedDate: string | null;
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
    const content = await app.vault.cachedRead(file);
    const lines = content.split(/\r?\n/);

    for (const line of lines) {
      const parsedTask = parseDashboardTaskLine(line);
      if (!parsedTask) {
        continue;
      }

      if (parsedTask.status === "open" && parsedTask.dueDate !== null && parsedTask.dueDate <= dateString) {
        dueTasks.push({ file, task: parsedTask.text, dueDate: parsedTask.dueDate });
      }

      if (parsedTask.completedDate === dateString) {
        completedTasks.push({ file, task: parsedTask.text, dueDate: null });
      }
    }
  }

  dueTasks.sort(compareDueRows);
  completedTasks.sort(compareRows);

  return { dueTasks, completedTasks };
}

function parseDashboardTaskLine(line: string): ParsedDashboardTask | null {
  const match = line.match(TASK_LINE_REGEX);
  if (!match) {
    return null;
  }

  const status = match[1].trim().toLowerCase() === "x" ? "completed" : "open";
  const taskBody = match[2].trim();
  const dueDate = readInlineFieldValue(taskBody, DUE_FIELD_REGEX);
  const completedDate = readInlineFieldValue(taskBody, COMPLETION_DATE_FIELD_REGEX);

  if (!dueDate && !completedDate) {
    return null;
  }

  return {
    text: cleanDashboardTaskText(taskBody),
    status,
    dueDate,
    completedDate,
  };
}

function readInlineFieldValue(taskBody: string, fieldRegex: RegExp): string | null {
  const match = taskBody.match(fieldRegex);
  return match ? match[1].trim() : null;
}

function cleanDashboardTaskText(taskBody: string): string {
  return taskBody
    .replace(INLINE_FIELD_REGEX, "")
    .replace(TAG_REGEX, "$1")
    .replace(MULTISPACE_REGEX, " ")
    .trim();
}

function compareRows(left: DashboardRow, right: DashboardRow): number {
  const pathCompare = left.file.path.localeCompare(right.file.path);
  if (pathCompare !== 0) {
    return pathCompare;
  }

  return left.task.localeCompare(right.task);
}

function compareDueRows(left: DashboardRow, right: DashboardRow): number {
  const leftDueDate = left.dueDate ?? EMPTY_DUE_DATE_SORT_VALUE;
  const rightDueDate = right.dueDate ?? EMPTY_DUE_DATE_SORT_VALUE;
  const dueDateCompare = leftDueDate.localeCompare(rightDueDate);
  if (dueDateCompare !== 0) {
    return dueDateCompare;
  }

  return compareRows(left, right);
}