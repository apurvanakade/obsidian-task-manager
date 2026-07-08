/**
 * Purpose:
 * - generate a markdown Tasks Summary file from configured task sources.
 *
 * Responsibilities:
 * - scans Projects, Waiting, Someday-Maybe, and Inbox sources
 * - selects the first incomplete task per file
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
import { getCurrentDateString, getCurrentTimeString } from "../date/date-utils";
import { ensureParentFoldersExist } from "../routing/task-routing";
import { TaskManagerSettings } from "../settings/settings-utils";
import { readFilePriority } from "../tasks/file-priority";
import { cleanTaskText, getRecurrenceLabel, parseTaskLine, readInlineFieldValue } from "../tasks/task-line-metadata";
import { buildGroupedTaskTable, formatMonthDay } from "../tables/grouped-task-table";

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
};

type ParsedFirstIncompleteRow = {
  task: string;
  dueDate: string | null;
  recurrence: string;
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
    { title: "Projects", collectRows: () => collectFirstIncompleteRowsForFolder(app, settings.projectsFolder) },
    { title: "Waiting", collectRows: () => collectFirstIncompleteRowsForFolder(app, settings.waitingProjectsFolder) },
    { title: "Someday-Maybe", collectRows: () => collectFirstIncompleteRowsForFolder(app, settings.somedayMaybeProjectsFolder) },
    { title: "Inbox", collectRows: () => collectFirstIncompleteRowsForInbox(app, settings.inboxFile) },
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

async function collectFirstIncompleteRowsForFolder(app: App, folderPath: string): Promise<SummaryRow[]> {
  if (!folderPath) {
    return [];
  }

  const files = app.vault.getMarkdownFiles().filter((file) => isInFolder(file.path, folderPath));
  const rows: SummaryRow[] = [];

  for (const file of files) {
    const row = await findFirstIncompleteRow(app, file);
    if (row) {
      rows.push(row);
    }
  }

  return rows.sort(compareSummaryRows);
}

async function collectFirstIncompleteRowsForInbox(app: App, inboxFilePath: string): Promise<SummaryRow[]> {
  if (!inboxFilePath) {
    return [];
  }

  const inboxFile = app.vault.getAbstractFileByPath(inboxFilePath);
  if (!(inboxFile instanceof TFile)) {
    return [];
  }

  const row = await findFirstIncompleteRow(app, inboxFile);
  return row ? [row] : [];
}

async function findFirstIncompleteRow(app: App, file: TFile): Promise<SummaryRow | null> {
  const content = await app.vault.read(file);
  const priority = readFilePriority(content);
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const parsed = parseFirstIncompleteTaskLine(line);
    if (!parsed) {
      continue;
    }

    return {
      file,
      task: parsed.task,
      dueDate: parsed.dueDate,
      priority,
      recurrence: parsed.recurrence,
    };
  }

  return null;
}

function parseFirstIncompleteTaskLine(line: string): ParsedFirstIncompleteRow | null {
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

function renderSummary(sections: SummarySection[], hideKeywords: string): string {
  const lines: string[] = ["# Tasks Summary", ""];

  for (const section of sections) {
    lines.push(`## ${section.title}`, "");
    appendSectionTable(lines, section.rows, hideKeywords);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

async function resolveSummaryFile(app: App, summaryFilePath: string): Promise<TFile> {
  await ensureParentFoldersExist(app, summaryFilePath);

  const existing = app.vault.getAbstractFileByPath(summaryFilePath);
  if (!existing) {
    return await app.vault.create(summaryFilePath, "");
  }

  if (existing instanceof TFile) {
    return existing;
  }

  throw new Error(`Cannot write summary to '${summaryFilePath}' because a folder already exists at that path.`);
}

async function overwriteSummaryFile(app: App, file: TFile, summaryContent: string): Promise<void> {
  await app.vault.modify(file, summaryContent);
  await stampSummaryMetadata(app, file);
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
  lines.push("| Folder | Filename | Task | Priority | Recurrence | Due |");
  lines.push("| --- | --- | --- | --- | --- | --- |");

  for (const folderGroup of folderGroups) {
    let displayFolder = folderGroup.displayFolderName;
    for (const fileGroup of folderGroup.files) {
      for (const row of fileGroup.rows) {
        lines.push(
          `| ${escapePipes(displayFolder)} | ${buildFileLink(fileGroup.displayFileName, row.file.path)} | ${buildWeightedTaskText(row.task, row.priority)} | ${row.priority} | ${escapePipes(row.recurrence)} | ${formatMonthDay(row.dueDate)} |`,
        );
        displayFolder = "";
      }
    }
  }

  lines.push("");
}

function isInFolder(filePath: string, folderPath: string): boolean {
  return filePath.startsWith(`${folderPath}/`);
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

async function stampSummaryMetadata(app: App, file: TFile): Promise<void> {
  await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, string>) => {
    frontmatter["creation-date"] = getCurrentDateString();
    frontmatter["creation-time"] = getCurrentTimeString();
  });
}
