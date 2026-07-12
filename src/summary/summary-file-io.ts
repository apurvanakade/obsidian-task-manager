/**
 * Purpose:
 * - shared file-scanning and summary-note I/O helpers reused across generated summary
 *   notes and other features that enumerate task/project files by configured folder.
 *
 * Responsibilities:
 * - folder-membership and excluded-summary-file checks
 * - resolves (or creates) the destination file for a generated summary note
 * - overwrites a summary file's content and stamps creation-date/creation-time frontmatter
 *
 * Dependencies:
 * - Obsidian vault/file-manager APIs, date-utils, and normalized plugin settings
 *
 * Side Effects:
 * - reads/creates/writes vault files
 */
import { App, TFile } from "obsidian";
import { getCurrentDateString, getCurrentTimeString } from "../date/date-utils";
import { ensureParentFoldersExist } from "../routing/task-routing";
import { TaskManagerSettings } from "../settings/settings-utils";

export function isInFolder(filePath: string, folderPath: string): boolean {
  return filePath.startsWith(`${folderPath}/`);
}

export function isExcludedSummaryFile(filePath: string, settings: TaskManagerSettings): boolean {
  return filePath === settings.tasksSummaryFile
    || filePath === settings.inboxFile;
}

export async function resolveSummaryFile(app: App, summaryFilePath: string): Promise<TFile> {
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

export async function overwriteSummaryFile(app: App, file: TFile, summaryContent: string): Promise<void> {
  await app.vault.modify(file, summaryContent);
  await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, string>) => {
    frontmatter["creation-date"] = getCurrentDateString();
    frontmatter["creation-time"] = getCurrentTimeString();
  });
}
