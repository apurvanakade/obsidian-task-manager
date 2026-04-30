/**
 * Purpose:
 * - provide shared grouped-table modeling and display formatting for task tables.
 *
 * Responsibilities:
 * - groups task rows by folder and file in a stable structure
 * - applies shared folder/filename hide-keyword cleanup
 * - formats due dates for shared table displays
 *
 * Dependencies:
 * - Obsidian TFile type only
 *
 * Side Effects:
 * - none (pure formatting/model helpers)
 */
import { TFile } from "obsidian";

const MARKDOWN_EXTENSION_REGEX = /\.md$/i;
const MONTH_DAY_REGEX = /^\d{4}-(\d{2})-(\d{2})$/;

export type GroupedTaskTableRow = {
  file: TFile;
  task: string;
  priority: number;
  dueDate: string | null;
};

export type TaskFileGroup<TRow extends GroupedTaskTableRow> = {
  file: TFile;
  displayFileName: string;
  rows: TRow[];
};

export type TaskFolderGroup<TRow extends GroupedTaskTableRow> = {
  folderPath: string;
  displayFolderName: string;
  rowCount: number;
  files: TaskFileGroup<TRow>[];
};

export function buildGroupedTaskTable<TRow extends GroupedTaskTableRow>(
  rows: TRow[],
  hideKeywords: string,
): TaskFolderGroup<TRow>[] {
  const folderMap = new Map<string, Map<string, TRow[]>>();

  for (const row of rows) {
    const folderPath = row.file.parent?.path ?? "";
    const filePath = row.file.path;
    if (!folderMap.has(folderPath)) {
      folderMap.set(folderPath, new Map());
    }

    const fileMap = folderMap.get(folderPath)!;
    if (!fileMap.has(filePath)) {
      fileMap.set(filePath, []);
    }

    fileMap.get(filePath)!.push(row);
  }

  return [...folderMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([folderPath, fileMap]) => {
      const files = [...fileMap.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([, fileRows]) => ({
          file: fileRows[0].file,
          displayFileName: getDisplayFileName(fileRows[0].file.name, hideKeywords),
          rows: fileRows,
        }));

      return {
        folderPath,
        displayFolderName: getDisplayFolderName(folderPath, hideKeywords),
        rowCount: files.reduce((sum, fileGroup) => sum + fileGroup.rows.length, 0),
        files,
      };
    });
}

export function formatMonthDay(dateString: string | null): string {
  if (!dateString) {
    return "";
  }

  const match = dateString.match(MONTH_DAY_REGEX);
  return match ? `${match[1]}-${match[2]}` : dateString;
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
