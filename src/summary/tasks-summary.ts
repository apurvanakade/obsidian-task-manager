/**
 * Purpose:
 * - generate a markdown Tasks Summary file from configured task sources.
 *
 * Responsibilities:
 * - scans Projects, Waiting, Someday-Maybe, and Inbox sources
 * - selects the first next-action task per file
 * - renders grouped summary tables with due date and priority columns
 * - creates or overwrites the destination markdown file
 *
 * Dependencies:
 * - Obsidian vault/file APIs and normalized plugin settings
 *
 * Side Effects:
 * - reads markdown files and writes the summary file to the vault
 */
import { App, TAbstractFile, TFile } from "obsidian";
import { ensureParentFoldersExist } from "../routing/task-routing";
import { TaskManagerSettings } from "../settings/settings-utils";

const TASK_LINE_REGEX = /^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$/;
const DUE_FIELD_REGEX = /\[due::\s*([^\]]+?)\s*\]/i;
const PRIORITY_FIELD_REGEX = /\[priority::\s*([^\]]+?)\s*\]/i;
const REPEAT_FIELD_REGEX = /\[(?:repeat|repeats)::\s*[^\]]+?\]/i;
const INLINE_FIELD_REGEX = /\s*\[[^\]]+::\s*[^\]]*\]/g;
const TAG_REGEX = /(^|\s)#[^\s#]+/g;
const MULTISPACE_REGEX = /\s+/g;
const MARKDOWN_EXTENSION_REGEX = /\.md$/i;
const MONTH_DAY_REGEX = /^\d{4}-(\d{2})-(\d{2})$/;
const DEFAULT_PRIORITY = 3;

type SummarySection = {
  title: string;
  rows: SummaryRow[];
};

type SummaryRow = {
  file: TFile;
  task: string;
  dueDate: string | null;
  priority: number;
  isRecurring: boolean;
};

type ProjectSummaryBuckets = {
  recurring: SummaryRow[];
  dueThisWeek: SummaryRow[];
  scheduledLater: SummaryRow[];
  unscheduled: SummaryRow[];
};

export async function writeTasksSummary(
  app: App,
  settings: TaskManagerSettings,
  summaryFilePath: string,
): Promise<string> {
  const sections = await buildSummarySections(app, settings);
  const summaryContent = renderSummary(sections, settings.dashboardHideKeywords);
  await writeSummaryFile(app, summaryFilePath, summaryContent);
  return summaryFilePath;
}

async function buildSummarySections(app: App, settings: TaskManagerSettings): Promise<SummarySection[]> {
  return [
    {
      title: "Projects",
      rows: await collectNextActionRowsForFolder(app, settings.projectsFolder, settings.nextActionTag),
    },
    {
      title: "Waiting",
      rows: await collectNextActionRowsForFolder(app, settings.waitingProjectsFolder, settings.nextActionTag),
    },
    {
      title: "Someday-Maybe",
      rows: await collectNextActionRowsForFolder(app, settings.somedayMaybeProjectsFolder, settings.nextActionTag),
    },
    {
      title: "Inbox",
      rows: await collectNextActionRowsForInbox(app, settings.inboxFile, settings.nextActionTag),
    },
  ];
}

async function collectNextActionRowsForFolder(app: App, folderPath: string, nextActionTag: string): Promise<SummaryRow[]> {
  if (!folderPath) {
    return [];
  }

  const files = app.vault.getMarkdownFiles().filter((file) => isInFolder(file.path, folderPath));
  const rows: SummaryRow[] = [];

  for (const file of files) {
    const row = await findNextActionRow(app, file, nextActionTag);
    if (row) {
      rows.push(row);
    }
  }

  return rows.sort(compareSummaryRows);
}

async function collectNextActionRowsForInbox(app: App, inboxFilePath: string, nextActionTag: string): Promise<SummaryRow[]> {
  if (!inboxFilePath) {
    return [];
  }

  const inboxFile = app.vault.getAbstractFileByPath(inboxFilePath);
  if (!(inboxFile instanceof TFile)) {
    return [];
  }

  const row = await findNextActionRow(app, inboxFile, nextActionTag);
  return row ? [row] : [];
}

async function findNextActionRow(app: App, file: TFile, nextActionTag: string): Promise<SummaryRow | null> {
  const content = await app.vault.read(file);
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const parsed = parseNextActionTaskLine(line, nextActionTag);
    if (!parsed) {
      continue;
    }

    return {
      file,
      task: parsed.task,
      dueDate: parsed.dueDate,
      priority: parsed.priority,
      isRecurring: parsed.isRecurring,
    };
  }

  return null;
}

function parseNextActionTaskLine(line: string, nextActionTag: string): Omit<SummaryRow, "file"> | null {
  const match = line.match(TASK_LINE_REGEX);
  if (!match) {
    return null;
  }

  const status = match[1].trim().toLowerCase() === "x" ? "completed" : "open";
  if (status !== "open") {
    return null;
  }

  const taskBody = match[2].trim();
  if (!hasTag(taskBody, nextActionTag)) {
    return null;
  }

  return {
    task: cleanTaskText(taskBody),
    dueDate: readInlineFieldValue(taskBody, DUE_FIELD_REGEX),
    priority: parsePriorityValue(readInlineFieldValue(taskBody, PRIORITY_FIELD_REGEX)),
    isRecurring: REPEAT_FIELD_REGEX.test(taskBody),
  };
}

function renderSummary(sections: SummarySection[], hideKeywords: string): string {
  const lines: string[] = ["# Tasks Summary", ""];

  for (const section of sections) {
    lines.push(`## ${section.title}`, "");
    if (section.title === "Projects") {
      appendProjectSubsections(lines, section.rows, hideKeywords);
    } else {
      appendSectionTable(lines, section.rows, hideKeywords);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

async function writeSummaryFile(app: App, summaryFilePath: string, summaryContent: string): Promise<void> {
  await ensureParentFoldersExist(app, summaryFilePath);

  const existing = app.vault.getAbstractFileByPath(summaryFilePath);
  if (!existing) {
    const createdFile = await app.vault.create(summaryFilePath, summaryContent);
    await stampSummaryMetadata(app, createdFile);
    return;
  }

  if (existing instanceof TFile) {
    await app.vault.modify(existing, summaryContent);
    await stampSummaryMetadata(app, existing);
    return;
  }

  throw new Error(`Cannot write summary to '${summaryFilePath}' because a folder already exists at that path.`);
}

function compareSummaryRows(left: SummaryRow, right: SummaryRow): number {
  const folderCompare = (left.file.parent?.path ?? "").localeCompare(right.file.parent?.path ?? "");
  if (folderCompare !== 0) {
    return folderCompare;
  }

  return left.file.path.localeCompare(right.file.path);
}

function appendProjectSubsections(lines: string[], rows: SummaryRow[], hideKeywords: string): void {
  const buckets = splitProjectRows(rows);
  appendNamedSubsection(lines, "Recurring Tasks", buckets.recurring, hideKeywords);
  appendNamedSubsection(lines, "Tasks Due This Week", buckets.dueThisWeek, hideKeywords);
  appendNamedSubsection(lines, "Tasks Scheduled But Not Due This Week", buckets.scheduledLater, hideKeywords);
  appendNamedSubsection(lines, "Unscheduled Tasks", buckets.unscheduled, hideKeywords);
}

function appendNamedSubsection(lines: string[], title: string, rows: SummaryRow[], hideKeywords: string): void {
  lines.push(`### ${title}`, "");
  appendSectionTable(lines, rows, hideKeywords);
}

function appendSectionTable(lines: string[], rows: SummaryRow[], hideKeywords: string): void {
  if (rows.length === 0) {
    lines.push("No tasks.", "");
    return;
  }

  lines.push("| Folder | Filename | Task | Priority | Due |");
  lines.push("| --- | --- | --- | --- | --- |");

  let previousFolder = "";
  for (const row of rows) {
    const folderName = getDisplayFolderName(row.file.parent?.path ?? "", hideKeywords);
    const displayFolder = folderName === previousFolder ? "" : folderName;
    previousFolder = folderName;

    lines.push(
      `| ${escapePipes(displayFolder)} | ${buildFileLink(row.file, hideKeywords)} | ${buildWeightedTaskText(row.task, row.priority)} | ${row.priority} | ${formatMonthDay(row.dueDate)} |`,
    );
  }

  lines.push("");
}

function splitProjectRows(rows: SummaryRow[]): ProjectSummaryBuckets {
  const endOfWeek = getEndOfWeek(new Date());
  const buckets: ProjectSummaryBuckets = {
    recurring: [],
    dueThisWeek: [],
    scheduledLater: [],
    unscheduled: [],
  };

  for (const row of rows) {
    if (row.isRecurring) {
      buckets.recurring.push(row);
      continue;
    }

    if (!row.dueDate) {
      buckets.unscheduled.push(row);
      continue;
    }

    const dueDate = parseIsoDate(row.dueDate);
    if (dueDate !== null && dueDate <= endOfWeek) {
      buckets.dueThisWeek.push(row);
    } else {
      buckets.scheduledLater.push(row);
    }
  }

  return buckets;
}

function isInFolder(filePath: string, folderPath: string): boolean {
  return filePath.startsWith(`${folderPath}/`);
}

function hasTag(taskBody: string, tag: string): boolean {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\s)${escapedTag}(?=$|\\s)`).test(taskBody);
}

function readInlineFieldValue(taskBody: string, fieldRegex: RegExp): string | null {
  const match = taskBody.match(fieldRegex);
  return match ? match[1].trim() : null;
}

function parsePriorityValue(value: string | null): number {
  if (!value) {
    return DEFAULT_PRIORITY;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 3) {
    return DEFAULT_PRIORITY;
  }

  return parsed;
}

function cleanTaskText(taskBody: string): string {
  return taskBody
    .replace(INLINE_FIELD_REGEX, "")
    .replace(TAG_REGEX, "$1")
    .replace(MULTISPACE_REGEX, " ")
    .trim();
}

function buildFileLink(file: TFile, hideKeywords: string): string {
  const displayName = getDisplayFileName(file.name, hideKeywords);
  return `[${escapeLinkText(displayName)}](<${file.path}>)`;
}

function getDisplayFileName(fileName: string, hideKeywords: string): string {
  return applyHideKeywords(fileName.replace(MARKDOWN_EXTENSION_REGEX, ""), hideKeywords);
}

function getDisplayFolderName(folderPath: string, hideKeywords: string): string {
  const lastSegment = folderPath.split("/").pop() ?? folderPath;
  return applyHideKeywords(lastSegment || "/", hideKeywords);
}

function applyHideKeywords(name: string, hideKeywords: string): string {
  const keywords = hideKeywords
    .split(",")
    .map((keyword) => keyword.trim())
    .filter((keyword) => keyword.length > 0);

  if (keywords.length === 0) {
    return name;
  }

  let result = name;
  for (const keyword of keywords) {
    const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(escapedKeyword, "gi"), "");
  }

  result = result.replace(/\s+/g, " ").trim();
  return result || name;
}

function formatMonthDay(dateString: string | null): string {
  if (!dateString) {
    return "";
  }

  const match = dateString.match(MONTH_DAY_REGEX);
  return match ? `${match[1]}-${match[2]}` : dateString;
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

function getEndOfWeek(baseDate: Date): Date {
  const endOfWeek = new Date(baseDate);
  const daysUntilSunday = (7 - endOfWeek.getDay()) % 7;
  endOfWeek.setHours(23, 59, 59, 999);
  endOfWeek.setDate(endOfWeek.getDate() + daysUntilSunday);
  return endOfWeek;
}

function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getCurrentDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getCurrentTimeString(): string {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}
