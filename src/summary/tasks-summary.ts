/**
 * Purpose:
 * - collect actionable task rows for the live Tasks Summary tab.
 *
 * Responsibilities:
 * - scans Projects and Waiting folders and the Inbox file (Someday-Maybe is
 *   deliberately excluded — that review lives in the Projects Summary tab instead)
 * - selects the first incomplete task per file for Projects/Waiting, but *every* open
 *   task for Inbox (so any capture can be selected for the inbox-to-project flow — see
 *   inbox-actions.ts)
 * - groups results into Projects/Waiting/Inbox sections, each sorted by
 *   file priority ascending, then due date, then file path
 * - each row carries the exact raw task line text (rawLine), used by inbox-actions.ts
 *   to find-and-remove the original line after it's bundled into a project
 *
 * Dependencies:
 * - Obsidian vault APIs and normalized plugin settings
 *
 * Side Effects:
 * - reads markdown files from the vault (no writes — rendering lives in tasks-summary-view.ts)
 */
import { App, TFile } from "obsidian";
import { TaskManagerSettings } from "../settings/settings-utils";
import { readFilePriority } from "../tasks/file-priority";
import { cleanTaskText, getRecurrenceLabel, parseTaskLine, readInlineFieldValue } from "../tasks/task-line-metadata";
import { findActionableTaskLines } from "../tasks/next-actions";
import { isInFolder } from "./summary-file-io";

const DUE_FIELD_REGEX = /\[due::\s*([^\]]+?)\s*\]/i;

export type TaskSummarySection = {
  title: string;
  rows: TaskSummaryRow[];
};

export type TaskSummaryRow = {
  file: TFile;
  task: string;
  dueDate: string | null;
  priority: number;
  recurrence: string;
  /** The exact, unmodified task line text — used to find-and-remove the original line. */
  rawLine: string;
};

type ParsedActionableTaskLine = {
  task: string;
  dueDate: string | null;
  recurrence: string;
};

export async function collectTaskSummarySections(app: App, settings: TaskManagerSettings): Promise<TaskSummarySection[]> {
  const sectionSources = [
    { title: "Projects", collectRows: () => collectActionableRowsForFolder(app, settings.projectsFolder) },
    { title: "Waiting", collectRows: () => collectActionableRowsForFolder(app, settings.waitingProjectsFolder) },
    { title: "Inbox", collectRows: () => collectAllOpenRowsForInbox(app, settings.inboxFile) },
  ];

  const sections: TaskSummarySection[] = [];
  for (const source of sectionSources) {
    sections.push({
      title: source.title,
      rows: await source.collectRows(),
    });
  }

  return sections;
}

async function collectActionableRowsForFolder(app: App, folderPath: string): Promise<TaskSummaryRow[]> {
  if (!folderPath) {
    return [];
  }

  const files = app.vault.getMarkdownFiles().filter((file) => isInFolder(file.path, folderPath));
  const rows: TaskSummaryRow[] = [];

  for (const file of files) {
    rows.push(...await findActionableRows(app, file));
  }

  return rows.sort(compareSummaryRows);
}

/**
 * Every open task in the Inbox file, not just the first — the Inbox is a flat capture
 * list, not a project with a single actionable next action, and the inbox-to-project
 * flow needs every capture selectable.
 */
async function collectAllOpenRowsForInbox(app: App, inboxFilePath: string): Promise<TaskSummaryRow[]> {
  if (!inboxFilePath) {
    return [];
  }

  const inboxFile = app.vault.getAbstractFileByPath(inboxFilePath);
  if (!(inboxFile instanceof TFile)) {
    return [];
  }

  const content = await app.vault.read(inboxFile);
  const priority = readFilePriority(content);
  const lines = content.split(/\r?\n/);

  const rows: TaskSummaryRow[] = [];
  for (const line of lines) {
    const parsed = parseActionableTaskLine(line);
    if (!parsed) {
      continue;
    }

    rows.push({
      file: inboxFile,
      task: parsed.task,
      dueDate: parsed.dueDate,
      priority,
      recurrence: parsed.recurrence,
      rawLine: line,
    });
  }

  return rows;
}

async function findActionableRows(app: App, file: TFile): Promise<TaskSummaryRow[]> {
  const content = await app.vault.read(file);
  const priority = readFilePriority(content);
  const lines = content.split(/\r?\n/);
  const actionableLineIndices = findActionableTaskLines(lines);

  const rows: TaskSummaryRow[] = [];
  for (const index of actionableLineIndices) {
    const parsed = parseActionableTaskLine(lines[index]);
    if (!parsed) {
      continue;
    }

    rows.push({
      file,
      task: parsed.task,
      dueDate: parsed.dueDate,
      priority,
      recurrence: parsed.recurrence,
      rawLine: lines[index],
    });
  }

  return rows;
}

function parseActionableTaskLine(line: string): ParsedActionableTaskLine | null {
  const parsedTask = parseTaskLine(line);
  if (!parsedTask || parsedTask.status !== "open") {
    return null;
  }

  return {
    task: cleanTaskText(parsedTask.taskBody),
    dueDate: readInlineFieldValue(parsedTask.taskBody, DUE_FIELD_REGEX),
    recurrence: getRecurrenceLabel(parsedTask.taskBody),
  };
}

function compareSummaryRows(left: TaskSummaryRow, right: TaskSummaryRow): number {
  const priorityCompare = left.priority - right.priority;
  if (priorityCompare !== 0) {
    return priorityCompare;
  }

  const leftDueDate = left.dueDate ?? "9999-99-99";
  const rightDueDate = right.dueDate ?? "9999-99-99";
  const dueDateCompare = leftDueDate.localeCompare(rightDueDate);
  if (dueDateCompare !== 0) {
    return dueDateCompare;
  }

  return left.file.path.localeCompare(right.file.path);
}
