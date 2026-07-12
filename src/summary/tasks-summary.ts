/**
 * Purpose:
 * - generate a markdown Tasks Summary file from configured task sources.
 *
 * Responsibilities:
 * - scans Projects, Waiting, Someday-Maybe, and Inbox sources
 * - selects the actionable task(s) per file (first incomplete task, or one per context
 *   group when Enable Multiple Next Actions is on)
 * - renders grouped summary tables with due date, recurrence, and file-priority columns
 * - creates or overwrites the destination markdown file without merge prompts
 *
 * Dependencies:
 * - Obsidian vault/file APIs and normalized plugin settings
 *
 * Side Effects:
 * - reads markdown files and writes the summary file to the vault
 */
import { App, TAbstractFile, TFile } from "obsidian";
import { TaskManagerSettings } from "../settings/settings-utils";
import { readFilePriority } from "../tasks/file-priority";
import { cleanTaskText, getContexts, getRecurrenceLabel, parseTaskLine, readInlineFieldValue } from "../tasks/task-line-metadata";
import { findActionableTaskLines } from "../tasks/next-actions";
import { buildGroupedTaskTable, formatMonthDay } from "../tables/grouped-task-table";
import { isInFolder, overwriteSummaryFile, resolveSummaryFile } from "./summary-file-io";

const DUE_FIELD_REGEX = /\[due::\s*([^\]]+?)\s*\]/i;
type SummarySection = {
  title: string;
  rows: SummaryRow[];
};

type SummaryRow = {
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

export async function writeTasksSummary(
  app: App,
  settings: TaskManagerSettings,
  summaryFilePath: string,
): Promise<string> {
  const sections = await buildSummarySections(app, settings);
  const summaryContent = renderSummary(sections, settings.dashboardHideKeywords);
  const summaryFile = await resolveSummaryFile(app, summaryFilePath);
  await overwriteSummaryFile(app, summaryFile, summaryContent);
  return summaryFilePath;
}

async function buildSummarySections(app: App, settings: TaskManagerSettings): Promise<SummarySection[]> {
  const sectionSources = [
    { title: "Projects", collectRows: () => collectActionableRowsForFolder(app, settings.projectsFolder, settings) },
    { title: "Waiting", collectRows: () => collectActionableRowsForFolder(app, settings.waitingProjectsFolder, settings) },
    { title: "Someday-Maybe", collectRows: () => collectActionableRowsForFolder(app, settings.somedayMaybeProjectsFolder, settings) },
    { title: "Inbox", collectRows: () => collectActionableRowsForInbox(app, settings.inboxFile, settings) },
  ];

  const sections: SummarySection[] = [];
  for (const source of sectionSources) {
    sections.push({
      title: source.title,
      rows: await source.collectRows(),
    });
  }

  return sections;
}

async function collectActionableRowsForFolder(app: App, folderPath: string, settings: TaskManagerSettings): Promise<SummaryRow[]> {
  if (!folderPath) {
    return [];
  }

  const files = app.vault.getMarkdownFiles().filter((file) => isInFolder(file.path, folderPath));
  const rows: SummaryRow[] = [];

  for (const file of files) {
    rows.push(...await findActionableRows(app, file, settings));
  }

  return rows.sort(compareSummaryRows);
}

async function collectActionableRowsForInbox(app: App, inboxFilePath: string, settings: TaskManagerSettings): Promise<SummaryRow[]> {
  if (!inboxFilePath) {
    return [];
  }

  const inboxFile = app.vault.getAbstractFileByPath(inboxFilePath);
  if (!(inboxFile instanceof TFile)) {
    return [];
  }

  return findActionableRows(app, inboxFile, settings);
}

async function findActionableRows(app: App, file: TFile, settings: TaskManagerSettings): Promise<SummaryRow[]> {
  const content = await app.vault.read(file);
  const priority = readFilePriority(content);
  const lines = content.split(/\r?\n/);
  const actionableLineIndices = findActionableTaskLines(lines, settings.enableMultipleNextActions);

  const rows: SummaryRow[] = [];
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

function renderSummary(sections: SummarySection[], hideKeywords: string): string {
  const lines: string[] = ["# Tasks Summary", ""];

  for (const section of sections) {
    lines.push(`## ${section.title}`, "");
    appendSectionTable(lines, section.rows, hideKeywords);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

function compareSummaryRows(left: SummaryRow, right: SummaryRow): number {
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

function appendSectionTable(lines: string[], rows: SummaryRow[], hideKeywords: string): void {
  if (rows.length === 0) {
    lines.push("No tasks.", "");
    return;
  }

  const folderGroups = buildGroupedTaskTable(rows, hideKeywords);
  lines.push("| Folder | Filename | Task | Priority | Recurrence | Context | Due |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");

  for (const folderGroup of folderGroups) {
    let displayFolder = folderGroup.displayFolderName;
    for (const fileGroup of folderGroup.files) {
      for (const row of fileGroup.rows) {
        lines.push(
          `| ${escapePipes(displayFolder)} | ${buildFileLink(fileGroup.displayFileName, row.file.path)} | ${buildWeightedTaskText(row.task, row.priority)} | ${row.priority} | ${escapePipes(row.recurrence)} | ${escapePipes(row.contexts.join(", "))} | ${formatMonthDay(row.dueDate)} |`,
        );
        displayFolder = "";
      }
    }
  }

  lines.push("");
}

function buildFileLink(displayName: string, filePath: string): string {
  return `[${escapeLinkText(displayName)}](<${filePath}>)`;
}

function escapePipes(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function escapeLinkText(value: string): string {
  return value.replace(/([\\[\]])/g, "\\$1");
}

function buildWeightedTaskText(task: string, priority: number): string {
  const escapedTask = escapePipes(task);
  if (priority === 1) {
    return `**${escapedTask}**`;
  }

  if (priority === 2) {
    return `*${escapedTask}*`;
  }

  return escapedTask;
}
