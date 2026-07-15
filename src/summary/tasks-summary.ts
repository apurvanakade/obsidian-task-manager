/**
 * Purpose:
 * - collect actionable task rows for the live Tasks Summary tab.
 *
 * Responsibilities:
 * - scans Projects, Waiting, Someday-Maybe folders and the Inbox file
 * - selects the actionable task(s) per file (first incomplete task, or one row per
 *   context group when Enable Multiple Next Actions is on)
 * - groups results into Projects/Waiting/Someday-Maybe/Inbox sections, each sorted by
 *   file priority ascending, then due date, then file path
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
import { cleanTaskText, getContexts, getRecurrenceLabel, parseTaskLine, readInlineFieldValue } from "../tasks/task-line-metadata";
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
  contexts: string[];
};

type ParsedActionableTaskLine = {
  task: string;
  dueDate: string | null;
  recurrence: string;
  contexts: string[];
};

export async function collectTaskSummarySections(app: App, settings: TaskManagerSettings): Promise<TaskSummarySection[]> {
  const sectionSources = [
    { title: "Projects", collectRows: () => collectActionableRowsForFolder(app, settings.projectsFolder, settings) },
    { title: "Waiting", collectRows: () => collectActionableRowsForFolder(app, settings.waitingProjectsFolder, settings) },
    { title: "Someday-Maybe", collectRows: () => collectActionableRowsForFolder(app, settings.somedayMaybeProjectsFolder, settings) },
    { title: "Inbox", collectRows: () => collectActionableRowsForInbox(app, settings.inboxFile, settings) },
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

async function collectActionableRowsForFolder(app: App, folderPath: string, settings: TaskManagerSettings): Promise<TaskSummaryRow[]> {
  if (!folderPath) {
    return [];
  }

  const files = app.vault.getMarkdownFiles().filter((file) => isInFolder(file.path, folderPath));
  const rows: TaskSummaryRow[] = [];

  for (const file of files) {
    rows.push(...await findActionableRows(app, file, settings));
  }

  return rows.sort(compareSummaryRows);
}

async function collectActionableRowsForInbox(app: App, inboxFilePath: string, settings: TaskManagerSettings): Promise<TaskSummaryRow[]> {
  if (!inboxFilePath) {
    return [];
  }

  const inboxFile = app.vault.getAbstractFileByPath(inboxFilePath);
  if (!(inboxFile instanceof TFile)) {
    return [];
  }

  return findActionableRows(app, inboxFile, settings);
}

async function findActionableRows(app: App, file: TFile, settings: TaskManagerSettings): Promise<TaskSummaryRow[]> {
  const content = await app.vault.read(file);
  const priority = readFilePriority(content);
  const lines = content.split(/\r?\n/);
  const actionableLineIndices = findActionableTaskLines(lines, settings.enableMultipleNextActions);

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
      contexts: parsed.contexts,
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
    contexts: getContexts(parsedTask.taskBody),
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
